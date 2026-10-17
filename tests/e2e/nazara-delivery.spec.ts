import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, passWaqfData } from "./helpers";

/**
 * Scenario 6 of the owner's order (15 Oct 2026): the periodic nazir report (N01) and the delivery record, generated
 * from the platform's data, with every missing item shown as a gap rather than a number. Synthetic data only.
 *  - N01 request by the nazir of the demo waqf A; its nazara file is accepted through the file's own decision;
 *  - the term is set with an explicit cadence (N01 has no documented cadence); cycle 1 opens;
 *  - the first draft shows the gaps (no appointment decision, no ledger entries for the period) and cannot be sent
 *    for review; once the appointment is recorded and the period's entries exist, the regenerated draft carries them;
 *  - independent review by a reviewer who did not prepare it (the system administrator, who prepared it, is shown that
 *    his own approval would be recorded as a direct self-approval), making it available, client approval;
 *  - the delivery record is drafted from the recorded facts (versions, who delivered, who received and approved),
 *    approved, and released as a PDF when the cycle closes; the request stays open.
 * Desktop only (shared demo records). The nazara file's intake checklist is marked received by SQL to keep the test
 * on this scenario (the checklist and acceptance gates themselves are covered in nazara.spec.ts).
 */

const shots = "/tmp/claude-0/shots";
const ex = expect.configure({ timeout: 25_000 });
mkdirSync(shots, { recursive: true });

const envLine = (k: string) => readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${k}=`))!.slice(k.length + 1).trim();
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: envLine("DATABASE_OWNER_URL") });
  await db.connect();
  try { return (await db.query(q, params)).rows as T[]; } finally { await db.end(); }
}

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-nzd-${key}-${demo().users[key].id}.json`;
  if (existsSync(file)) {
    const ctx = await browser.newContext({ storageState: file });
    const page = await ctx.newPage();
    if ((await page.request.get("/api/files/00000000-0000-4000-8000-000000000000")).status() !== 401) { pages.set(key, page); return page; }
    await ctx.close();
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  pages.set(key, page);
  return page;
}
const go = (page: Page, url: string) => {
  const [path, hash] = url.split("#");
  return page.goto(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}${hash ? `#${hash}` : ""}`);
};
const status = async (id: string) => (await sql<{ status: string }>("select status from service_requests where id = $1", [id]))[0].status;
async function nextStep(page: Page, reqId: string, label: RegExp) {
  await go(page, `/admin/requests/${reqId}`);
  const btn = page.getByTestId("next-step");
  await ex(btn).toContainText(label);
  await btn.click();
  const msg = page.getByTestId("execution-panel").locator('[role="status"], [role="alert"]').first();
  await ex(msg).toBeVisible();
  expect(await msg.getAttribute("role"), await msg.innerText()).toBe("status");
}
async function act(page: Page, name: string | RegExp) {
  const btn = page.getByRole("button", { name, exact: typeof name === "string" }).first();
  await btn.click();
  await page.waitForTimeout(800);
}
async function tickAll(page: Page, reqId: string, seq: number) {
  for (let i = 0; i < 12; i++) {
    await go(page, `/admin/requests/${reqId}#service`);
    const list = page.getByTestId(`cycle-${seq}-checklist`);
    await ex(list.getByRole("button").first()).toBeVisible();
    const btn = list.getByRole("button", { name: /^أنجزت:/ }).first();
    if (!(await btn.count())) return;
    const q = "select count(*)::int as n from service_cycles c, jsonb_array_elements(c.checklist) x where c.request_id = $1 and c.seq = $2 and (x->>'done')::boolean";
    const before = (await sql<{ n: number }>(q, [reqId, seq]))[0].n;
    await btn.click();
    await ex.poll(async () => (await sql<{ n: number }>(q, [reqId, seq]))[0].n).toBe(before + 1);
  }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000 + 3 * 3_600_000));
const sections = async (outputId: string) => JSON.stringify((await sql<{ sections: unknown; gaps: unknown }>(
  "select v.sections, v.gaps from output_versions v join outputs o on o.id = v.output_id and v.version = o.current_version where o.id = $1", [outputId]))[0]);
const pdf = Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF");

test.describe.serial("nazir periodic report and delivery record", () => {
  test.setTimeout(480_000);
  const U = () => demo().users;
  const A = () => demo().waqfs.A;
  const ledgerTag = "اختبار آلي — تقرير الناظر الدوري";
  const benTag = "مستفيد اختباري (اختبار آلي — تقرير الناظر)";
  let reqId = "";
  let engId = "";

  test.afterAll(async () => {
    await sql("delete from ledger_entries where description = $1", [ledgerTag]);
    await sql("delete from beneficiaries where display_name = $1", [benTag]);
    if (reqId) await sql("update service_requests set status = 'cancelled', assigned_to_user_id = null where id = $1 and status not in ('closed','cancelled','rejected')", [reqId]);
    // the synthetic nazara file is closed so other specs start from a waqf without an open file
    if (engId) await sql("update nazara_engagements set status = 'rejected', decision = 'rejected', decision_reason = 'إقفال ملف اختبار آلي' where id = $1", [engId]);
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("N01: report from real data with its gaps, independent review, client approval, delivery record released on closing", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    await sql("delete from ledger_entries where description = $1", [ledgerTag]);
    await sql("delete from beneficiaries where display_name = $1", [benTag]);
    await sql("update service_requests set status = 'cancelled' where waqf_id = $1 and service_id = (select id from services where code = 'N01') and status not in ('closed','cancelled','rejected')", [A()]);
    await sql("update nazara_engagements set status = 'rejected' where waqf_id = $1 and status not in ('rejected','ended')", [A()]);

    // 1) the nazir requests N01 (intake with the deed)
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=N01&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(client);
    await client.getByRole("radio", { name: "الواقف يريد تعيين «وقفك»" }).check();
    await client.getByRole("checkbox", { name: "اختيار الواقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByTestId("table-assets").getByRole("button", { name: /أضف صفًا/ }).click();
    await client.locator("#q-assets-0-type").selectOption({ index: 1 });
    await client.locator("#q-assets-0-description").fill("أصل تجريبي (اختبار آلي)");
    for (const [label, v] of [[/حساب بنكي باسمه/, "نعم"], [/قوائم أو بيانات مالية/, "لا"], [/دعاوى أو مطالبات/, "لا"]] as const)
      await client.getByRole("group", { name: label }).getByRole("radio", { name: v }).check();
    for (let i = 0; i < 20 && !(await client.getByTestId("slot-svc_waqf_deed").isVisible()); i++) {
      const nb = client.getByRole("button", { name: "التالي" });
      if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
      await client.waitForTimeout(400);
    }
    const slot = client.getByTestId("slot-svc_waqf_deed");
    await slot.getByTestId("document-file-input").setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: pdf });
    await ex(slot.getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    for (let i = 0; i < 20 && !(await confirm.isVisible()); i++) {
      const nb = client.getByRole("button", { name: "التالي" });
      if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
      await client.waitForTimeout(400);
    }
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });
    const [eng] = await sql<{ id: string }>("select entity_id as id from request_links where request_id = $1 and entity_type = 'nazara_engagement'", [reqId]);
    engId = eng.id;

    // 2) triage and verification; the file's acceptance accepts the request; then execution starts
    const admin = await as(browser, "admin");
    await nextStep(admin, reqId, /ابدأ الفرز/);
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByTestId("docslot-svc_waqf_deed").getByRole("button", { name: "تحققت منه" }).click();
    await ex(admin.getByTestId("docslot-svc_waqf_deed")).toContainText("متحقق منه");
    await act(admin, "تحققت من البيانات والمستندات");
    await ex.poll(async () => (await sql<{ v: boolean }>("select intake_verified_at is not null as v from service_requests where id = $1", [reqId]))[0].v).toBe(true);
    await sql(`update nazara_engagements set status = 'under_review',
      checklist = (select jsonb_agg(x || '{"status":"received"}'::jsonb) from jsonb_array_elements(checklist) x) where id = $1`, [engId]);
    await go(admin, `/admin/nazara/${engId}`);
    const accept = admin.locator("details", { has: admin.locator("summary", { hasText: "اعتماد قبول النظارة" }) }).first();
    await accept.locator("summary").first().click();
    await admin.getByRole("button", { name: "اعتمد القبول" }).click();
    await ex(admin.getByText("مقبولة، بانتظار المباشرة").first()).toBeVisible();
    await ex.poll(async () => (await sql<{ v: boolean }>("select accepted_at is not null as v from service_requests where id = $1", [reqId]))[0].v).toBe(true);
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => status(reqId)).toBe("in_progress");

    // 3) N01 has no documented cadence: the contract's is chosen explicitly
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.getByTestId("continuous-panel")).toContainText("الدورية غير محددة");
    const startOn = addDays(-100);
    await admin.locator('input[name="startOn"]').fill(startOn);
    await admin.locator('input[name="endOn"]').fill(addDays(265));
    await admin.locator('select[name="cadence"]').selectOption("quarterly");
    await ex(admin.locator('select[name="clientAcceptance"]')).toBeDisabled(); // fixed for N01: always required
    await ex(admin.locator('select[name="clientAcceptance"]')).toHaveValue("required");
    await admin.getByRole("button", { name: "فعّل مدة الخدمة وجدول التسليمات" }).click();
    await ex.poll(async () => (await sql("select 1 from service_terms where request_id = $1 and cadence = 'quarterly' and client_acceptance = 'required'", [reqId])).length).toBe(1);
    // N01's onboarding output (the file study and recommendation) comes before the periodic cycles
    await nextStep(admin, reqId, /أنشئ مسودة «تقرير دراسة/);
    const [{ id: studyId }] = await sql<{ id: string }>("select id from outputs where request_id = $1 and output_key = 'N01.main'", [reqId]);
    await go(admin, `/admin/requests/${reqId}/outputs/${studyId}`);
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("دراسة المختص لملف الوقف (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);
    const ops = await as(browser, "ops");
    await nextStep(ops, reqId, /اعتمد «تقرير دراسة/);
    for (let i = 0; i < 6; i++) {
      await go(admin, `/admin/requests/${reqId}`);
      if (!/أنجزت مرحلة/.test(await admin.getByTestId("next-step").innerText())) break;
      await nextStep(admin, reqId, /أنجزت مرحلة/);
    }
    await nextStep(admin, reqId, /افتح دورة «الفترة 1/);
    const [cy] = await sql<{ from: string; to: string }>("select to_char(period_start,'YYYY-MM-DD') as from, to_char(period_end,'YYYY-MM-DD') as to from service_cycles where request_id = $1 and seq = 1", [reqId]);
    expect(cy.from).toBe(startOn);

    // 4) first draft: what is missing is a gap, not a number
    await nextStep(admin, reqId, /أعدّ مسودة/);
    const [{ id: reportId }] = await sql<{ id: string }>("select id from outputs where request_id = $1 and output_key = 'N01.cycle@c1'", [reqId]);
    const first = await sections(reportId);
    expect(first).toContain("قرار تعيين «وقفك» ناظرًا غير مسجل في ملف النظارة");
    expect(first).toContain("لا قيود مالية مسجلة للفترة");
    expect(first).toContain(`${cy.from}`);
    await go(admin, `/admin/requests/${reqId}/outputs/${reportId}`);
    await ex(admin.getByTestId("output-gaps")).toContainText("قرار تعيين «وقفك» ناظرًا غير مسجل");
    await ex(admin.getByTestId("output-gaps")).toContainText("لا قيود مالية مسجلة للفترة");
    await ex(admin.getByTestId("section-nazir")).toContainText("غير مسجل");
    await ex(admin.getByTestId("section-distributions")).toBeVisible(); // stated even when empty, never omitted
    await ex(admin.getByText(/لا يُعد تقديمًا لتقرير رسمي/).first()).toBeVisible();
    await admin.screenshot({ path: `${shots}/nazara-report-gaps.png`, fullPage: true });
    // it cannot be sent for review with these gaps: not offered, with the reasons (the server check is in output-quality.spec)
    await ex(admin.getByTestId("submit-blocked")).toContainText("قرار تعيين «وقفك» ناظرًا غير مسجل");
    await ex(admin.getByRole("button", { name: "أرسلها للمراجعة والاعتماد" })).toBeDisabled();
    expect((await sql<{ status: string }>("select status from outputs where id = $1", [reportId]))[0].status).toBe("draft");

    // 5) the missing data is recorded where it belongs: the appointment in the nazara file, entries in the ledger
    await go(admin, `/admin/nazara/${engId}`);
    await admin.getByLabel("رقم القرار").fill("TEST-NZ-RPT-1");
    await admin.getByLabel("تاريخه").fill(startOn);
    await admin.getByLabel("جهة القرار").selectOption("competent_authority");
    await admin.getByLabel("الصلاحيات").fill("إدارة شؤون الوقف وحماية أصوله وتمثيله وفق شرط الواقف (اختبار).");
    await admin.getByLabel("الأتعاب").fill("وفق شرط الواقف (اختبار)");
    await admin.getByLabel("المسؤوليات").fill("تنفيذ شرط الواقف والتزامات الناظر النظامية (اختبار).");
    await admin.getByRole("button", { name: "احفظ قرار التعيين" }).click();
    await ex(admin.getByText("حُفظ قرار التعيين.")).toBeVisible();
    const entryOn = addDays(-90);
    await sql(`insert into ledger_entries (waqf_id, entry_date, account_code, description, debit, credit) values
      ($1, $2, '1100', $3, 7300, 0), ($1, $2, '4100', $3, 0, 7300)`, [A(), entryOn, ledgerTag]);
    await go(admin, `/admin/requests/${reqId}/outputs/${reportId}`);
    await admin.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex.poll(async () => (await sections(reportId)).includes("TEST-NZ-RPT-1")).toBe(true);
    const second = await sections(reportId);
    expect(second).not.toContain("قرار تعيين «وقفك» ناظرًا غير مسجل");
    expect(second).not.toContain("لا قيود مالية مسجلة للفترة");
    expect(second).toMatch(/7[,٬]?300/);
    // the specialist writes the analyses (the platform does not write them)
    await go(admin, `/admin/requests/${reqId}/outputs/${reportId}`);
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("نص المختص للفترة مستند إلى البيانات المعروضة (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(3);
    // the cycle's own inputs: the waqf has no beneficiaries register, so the step is blocked and says so
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("blockers")).toContainText("لا مستفيدين مسجلين");
    await sql("insert into beneficiaries (waqf_id, display_name) values ($1, $2)", [A(), benTag]);
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);

    // 6) independent review: another reviewer approves (the preparer's own approval is covered in preview-approvals.spec)
    await go(admin, `/admin/requests/${reqId}/outputs/${reportId}`);
    await ex(admin.getByText("أنت ممن أعدّوا هذا المخرج؛ يُسجَّل اعتمادك اعتمادًا ذاتيًا", { exact: false })).toBeVisible(); // direct approver: allowed and recorded
    expect((await sql<{ status: string }>("select status from outputs where id = $1", [reportId]))[0].status).toBe("in_review");
    await go(ops, `/admin/requests/${reqId}/outputs/${reportId}`);
    await ops.getByRole("button", { name: "اعتمد المخرج" }).click();
    await ex.poll(async () => (await sql<{ status: string; by: string }>("select status, approved_by as by from outputs where id = $1", [reportId]))[0]).toEqual({ status: "approved", by: U().ops.id });

    // 7) made available in the platform; the client approves; approval is not closing
    await nextStep(admin, reqId, /أتح تسليم/);
    await go(client, `/app/requests/${reqId}#deliveries`);
    const d1 = client.getByTestId("delivery-1");
    await ex(d1).toContainText("بانتظار قرارك");
    const view = await client.request.get(await d1.getByRole("link", { name: "معاينة الملف" }).first().getAttribute("href") as string);
    expect(view.headers()["content-type"]).toContain("application/pdf");
    await d1.getByRole("button", { name: "اعتماد التسليم" }).click();
    await ex.poll(async () => (await sql<{ d: string }>("select client_decision as d from service_cycles where request_id = $1 and seq = 1", [reqId]))[0].d).toBe("approved");
    expect(await status(reqId)).toBe("in_progress");

    // 8) the delivery record: drafted from what was recorded, approved, released with the closing
    await nextStep(admin, reqId, /أعدّ محضر تسليم/);
    const [{ id: recordId }] = await sql<{ id: string }>("select id from outputs where request_id = $1 and output_key = 'N01.record@c1'", [reqId]);
    const rec = await sections(recordId);
    const [{ name: nazirName }] = await sql<{ name: string }>("select full_name as name from users where id = $1", [U().nazir.id]);
    expect(rec).toContain(nazirName);
    expect(rec).toContain(`اعتمده ${nazirName} في`); // client approval: who, when, which version
    expect(rec).toContain("(النسخة 3)");
    expect(rec).toContain("اعتمده مدير العمليات (تجريبي)"); // the internal review, recorded apart
    expect(rec).toContain(cy.from);
    expect(rec).toContain("لا يُعد دليلًا على صحة المخرج من الناحية النظامية");
    await go(admin, `/admin/requests/${reqId}/outputs/${recordId}`);
    await ex(admin.getByTestId("section-delivery_record")).toContainText("المستلم وصفته");
    await ex(admin.getByTestId("section-delivery_record")).toContainText("المراجعة الداخلية");
    await admin.screenshot({ path: `${shots}/nazara-delivery-record.png`, fullPage: true });
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("لا تحفظات (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);
    await nextStep(admin, reqId, /أرسل محضر التسليم للمراجعة/);
    await nextStep(admin, reqId, /اعتمد محضر التسليم/);
    await tickAll(admin, reqId, 1);
    await nextStep(admin, reqId, /أقفل دورة/);
    expect((await sql<{ status: string }>("select status from service_cycles where request_id = $1 and seq = 1", [reqId]))[0].status).toBe("closed");
    expect(await status(reqId)).toBe("in_progress");
    const [recFile] = await sql<{ released: boolean; doc: string | null }>(
      "select d.released_at is not null as released, d.document_id as doc from deliverables d join outputs o on o.id = d.output_id where o.id = $1 order by d.version desc limit 1", [recordId]);
    expect(recFile.released).toBe(true);
    expect(recFile.doc).toBeTruthy();
    await go(client, `/app/requests/${reqId}#deliveries`);
    await ex(client.getByTestId("delivery-1")).toContainText("محضر تسليم — الفترة 1");
    // 9) another client cannot open these files
    const outsider = await as(browser, "waqif");
    expect((await outsider.request.get(`/api/files/${recFile.doc}`)).status()).toBeGreaterThanOrEqual(403);
    expect((await sql("select 1 from audit_logs where action = 'outputs.approve' and entity_id = $1", [reportId])).length).toBe(1);
  });
});
