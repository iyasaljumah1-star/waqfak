import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, passWaqfData } from "./helpers";

/**
 * Unified request workspace (phase 4), synthetic data only:
 *  1. a financial service (F05) end to end by an authorized manager: structured form + bank statement → document
 *     verification → acceptance → start → draft from the waqf's ledger for the requested year → reviewer returns it →
 *     staff correct an answer (recorded, draft flagged stale) → regenerate keeping the specialist text → self-approval
 *     under policy → stage completed, then reopened with a reason → quality → pulled back from the client for a
 *     correction → new review round → client approval → closed;
 *  2. an invoice: unsent invoices stay invisible to the client; a failed sending is recorded and retried;
 *  3. the assigned employee is absent (suspended): the manager executes without reassigning;
 *  4. isolation: the client reads no revisions; an unassigned employee cannot open the request.
 *  5. a waqf-management service (N02, subscription) shows its own stages.
 * Desktop only (shared demo records).
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
async function asUser<T = Record<string, unknown>>(userId: string, q: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: envLine("DATABASE_URL") });
  await db.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.user_id', $1, true)", [userId]);
    const r = (await db.query(q, params)).rows as T[];
    await db.query("rollback");
    return r;
  } finally { await db.end(); }
}

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-ws-${key}-${demo().users[key].id}.json`;
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
const go = (page: Page, url: string) => page.goto(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);
const status = async (id: string) => (await sql<{ status: string }>("select status from service_requests where id = $1", [id]))[0].status;
const pdf = { name: "statement.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF") };

async function nextStep(page: Page, reqId: string, label: RegExp) {
  await go(page, `/admin/requests/${reqId}`);
  const btn = page.getByTestId("next-step");
  await ex(btn).toContainText(label);
  await btn.click();
  const msg = page.getByTestId("execution-panel").locator('[role="status"], [role="alert"]').first();
  await ex(msg).toBeVisible();
  expect(await msg.getAttribute("role"), await msg.innerText()).toBe("status");
}
async function advance(page: Page, until: () => Promise<boolean>) {
  for (let i = 0; i < 20 && !(await until()); i++) {
    const nb = page.getByRole("button", { name: "التالي" });
    if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
    await page.waitForTimeout(400);
  }
}

test.describe.serial("unified request workspace", () => {
  test.setTimeout(400_000);
  const U = () => demo().users;
  const A = () => demo().waqfs.A;
  let reqId = "";
  let outputId = "";

  test.beforeAll(async () => {
    await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [U().nazir.id]);
  });
  test.afterAll(async () => {
    await sql("update notification_templates set key = 'request.awaiting_client' where key = 'request.awaiting_client__off'");
    await sql("update users set status = 'active' where id = $1", [U().emp2.id]);
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("financial service end to end with return, correction, stale draft, stage reopen and pull-back", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    // 1) the client's structured form with the required bank statement
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=F05&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(client);
    await client.getByLabel(/السنة المالية المعنية/).fill("2026");
    // F05 v2: structured questions instead of a free-text description
    await client.getByLabel(/عدد الحسابات البنكية للوقف/).fill("1");
    await client.getByRole("checkbox", { name: "إيجارات" }).check();
    await client.getByRole("group", { name: /هل صُرف للمستحقين/ }).getByRole("radio", { name: "لا" }).check();
    await client.getByRole("group", { name: /هل تتوفر مستندات المصروفات/ }).getByRole("radio", { name: "نعم" }).check();
    await advance(client, () => client.getByTestId("slot-bank").isVisible());
    await client.getByTestId("slot-bank").getByTestId("document-file-input").setInputFiles(pdf);
    await ex(client.getByTestId("slot-bank").getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(client, () => confirm.isVisible());
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });

    // 2) the manager runs it from the workspace without assigning anyone
    const admin = await as(browser, "admin");
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("request-summary")).toContainText("غير مسند — ينفّذ المدير المخوّل مباشرة");
    await ex(admin.getByTestId("section-nav")).toContainText("المراسلات والنواقص");
    await nextStep(admin, reqId, /ابدأ الفرز/);
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("next-step-link")).toHaveText("راجع المستندات");
    await admin.getByTestId("docslot-bank").getByRole("button", { name: "تحققت منه" }).click();
    await ex(admin.getByTestId("docslot-bank")).toContainText("متحقق منه");
    await nextStep(admin, reqId, /سجّل التحقق/);
    await nextStep(admin, reqId, /اقبل الطلب/);
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => status(reqId)).toBe("in_progress");

    // 3) early draft from the ledger of the year the client asked for
    await nextStep(admin, reqId, /أنشئ مسودة/);
    [{ id: outputId }] = await sql<{ id: string }>("select id from outputs where request_id = $1", [reqId]);
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(admin.getByTestId("section-finance")).toContainText("2026-01-01");
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("ملاحظة المختص المالي (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);

    // 4) a reviewer returns it: the panel and the communications show what must be fixed and by whom
    const ops = await as(browser, "ops");
    await go(ops, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ops.getByLabel("ما يلزم تعديله").fill("أضف بيان المصروفات بالتفصيل (اختبار آلي).");
    await ops.getByRole("button", { name: "أعده للتعديل" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from outputs where id = $1", [outputId]))[0].status).toBe("returned");
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("blockers")).toContainText("أعاده المراجع");
    await ex(admin.getByTestId("comms-review")).toContainText("مفتوح لدى الفريق");
    await ex(admin.getByTestId("review-decisions")).toContainText("أضف بيان المصروفات");

    // 5) the team corrects an answer (reason + source): recorded with before/after; the draft becomes stale
    // (on the unified request page: the edit sits beside the field; the original value, reason and editor are kept)
    await go(admin, `/admin/requests/${reqId}#intake`);
    await admin.getByTestId("fa-bankAccounts-edit").click();
    const ed = admin.getByTestId("edit-bankAccounts");
    await ed.locator("#q-bankAccounts").fill("2");
    await ed.getByLabel("سبب التعديل ومصدره").fill("أكده الناظر هاتفيًا، ومطابق لكشف الحساب المرفق.");
    await ed.getByRole("button", { name: "احفظ التعديل" }).click();
    await ex.poll(async () => (await sql("select 1 from request_revisions where request_id = $1 and kind = 'intake_edit'", [reqId])).length).toBe(1);
    const [rev] = await sql<{ before: Record<string, string>; after: Record<string, string>; impact: { kind: string }[] }>("select before, after, impact from request_revisions where request_id = $1", [reqId]);
    expect(String(rev.before.bankAccounts)).toBe("1");
    expect(String(rev.after.bankAccounts)).toBe("2");
    expect(rev.impact.some((x) => x.kind === "output")).toBe(true);
    await ex(admin.getByTestId("field-bankAccounts").getByTestId("field-state")).toHaveAttribute("data-state", "needs_review");
    // the output page lists exactly what changed since the draft (the draft text itself is not rewritten)
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(admin.getByTestId("data-change").filter({ hasText: "عدد الحسابات البنكية للوقف" })).toContainText("1 ← 2");
    // regenerate from the corrected data; the specialist's text is kept
    await nextStep(admin, reqId, /أعد توليد المسودة من البيانات المصححة/);
    const [v] = await sql<{ origin: string; sections: unknown; data_snapshot: Record<string, string> }>("select origin, sections, data_snapshot from output_versions where output_id = $1 order by version desc limit 1", [outputId]);
    expect(v.origin).toBe("regenerated");
    expect(JSON.stringify(v.sections)).toContain("ملاحظة المختص المالي");
    expect(v.data_snapshot["answer:bankAccounts"]).toBe("2");
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);
    await nextStep(admin, reqId, /اعتمد «/); // self_allowed: authorized manager, recorded

    // 6) a work stage is completed, then reopened with a reason (recorded), then completed again
    await nextStep(admin, reqId, /أنجزت مرحلة «الدراسة والتحليل»/);
    await go(admin, `/admin/requests/${reqId}`);
    await admin.locator("details[data-testid=rollback] summary").click();
    await admin.locator("#rb-target").selectOption("stage:analysis");
    await admin.locator("#rb-reason").fill("نقص في تحليل المصروفات يحتاج إعادة دراسة.");
    await ex(admin.getByTestId("impact-list").first()).toBeVisible();
    await admin.getByRole("button", { name: "ارجع إلى هذه النقطة" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from request_stages where request_id = $1 and stage_key = 'analysis'", [reqId]))[0].status).toBe("active");
    await nextStep(admin, reqId, /أنجزت مرحلة «الدراسة والتحليل»/);

    // 7) quality → to the client → pulled back for a correction (client informed, nothing erased) → new round
    await nextStep(admin, reqId, /أرسل لمراجعة الجودة/);
    await nextStep(admin, reqId, /اعتماد ذاتي/);
    await ex.poll(() => status(reqId)).toBe("awaiting_client_approval");
    await go(admin, `/admin/requests/${reqId}`);
    await admin.locator("details[data-testid=rollback] summary").click();
    await admin.locator("#rb-target").selectOption("execution");
    await admin.locator("#rb-reason").fill("خطأ في رقم إجمالي المصروفات يلزم تصحيحه قبل اعتماد العميل.");
    await admin.getByRole("button", { name: "ارجع إلى هذه النقطة" }).click();
    await ex.poll(() => status(reqId)).toBe("in_progress");
    const [dl] = await sql<{ status: string }>("select status from deliverables where output_id = $1 order by created_at desc limit 1", [outputId]);
    expect(dl.status).toBe("revision_requested");
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("next-step-link")).toContainText("افتح مراجعة جديدة");
    await admin.getByTestId("output-F05.main").getByRole("button", { name: "افتح مراجعة جديدة" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from outputs where id = $1", [outputId]))[0].status).toBe("draft");
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);
    await nextStep(admin, reqId, /اعتمد «/);
    await nextStep(admin, reqId, /أرسل لمراجعة الجودة/);
    await nextStep(admin, reqId, /اعتماد ذاتي/);
    await go(client, `/app/requests/${reqId}`);
    await client.getByRole("button", { name: "أعتمد المخرجات" }).click();
    await ex.poll(() => status(reqId)).toBe("completed");
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByTestId("next-step").click();
    await ex.poll(() => status(reqId)).toBe("closed");
    const revs = await sql<{ kind: string; target: string }>("select kind, target from request_revisions where request_id = $1 order by at", [reqId]);
    expect(revs.map((r) => `${r.kind}:${r.target}`)).toEqual(["intake_edit:bankAccounts", "rollback:stage:analysis", "rollback:execution"]);
    await go(admin, `/admin/requests/${reqId}#history`);
    await ex(admin.getByTestId("revisions")).toContainText("نقص في تحليل المصروفات");
    await admin.screenshot({ path: `${shots}/workspace-closed-desktop.png`, fullPage: false });
  });

  test("invoices: unsent stays invisible to the client; a failed sending is recorded and retried", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    // a synthetic approved (unsent) proforma on the request above
    const [inv] = await sql<{ id: string }>(
      `insert into invoices (number, user_id, waqf_id, billed_to_name, request_id, subtotal, vat_rate, vat, total, status, kind, issued_on, einvoice_status, lines, approved_at, approved_by, created_by)
       values ('PRF-T' || floor(random()*1e9)::text, $1, $2, 'عميل تجريبي', $3, 100, 0, 0, 100, 'approved', 'proforma', current_date, 'not_applicable', '[{"description":"اختبار آلي","qty":1,"unit":100,"total":100}]'::jsonb, now(), $4, $4) returning id`,
      [U().nazir.id, A(), reqId, U().admin.id],
    );
    expect(await asUser(U().nazir.id, "select id from invoices where id = $1", [inv.id])).toHaveLength(0);
    const nazir = await as(browser, "nazir");
    expect((await nazir.request.get(`/app/billing/${inv.id}/pdf`)).status()).toBe(404);

    const admin = await as(browser, "admin");
    await sql("update notification_templates set key = 'request.awaiting_client__off' where key = 'request.awaiting_client'");
    await go(admin, `/admin/finance/${inv.id}`);
    await admin.getByRole("button", { name: "أرسل الفاتورة للعميل" }).click();
    await ex(admin.getByText(/تعذر الإرسال/)).toBeVisible();
    const [failed] = await sql<{ status: string; send_result: { ok: boolean; error: string } }>("select status, send_result from invoices where id = $1", [inv.id]);
    expect(failed.status).toBe("approved");
    expect(failed.send_result.ok).toBe(false);
    await sql("update notification_templates set key = 'request.awaiting_client' where key = 'request.awaiting_client__off'");
    await go(admin, `/admin/finance/${inv.id}`);
    await ex(admin.getByText(/فشلت محاولة الإرسال/)).toBeVisible();
    await admin.getByRole("button", { name: "أعد محاولة الإرسال" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from invoices where id = $1", [inv.id]))[0].status).toBe("issued");
    expect(await asUser(U().nazir.id, "select id from invoices where id = $1", [inv.id])).toHaveLength(1);
  });

  test("absent assignee: the manager executes without reassigning; isolation of revisions and drafts", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const [svc] = await sql<{ id: string }>("select id from services where code = 'C01'");
    const [r] = await sql<{ id: string }>(
      `insert into service_requests (number, service_id, waqf_id, requester_user_id, assigned_to_user_id, status, priority, intake, submitted_at, intake_form_version)
       values ('REQ-W' || floor(random()*1e9)::text, $1, $2, $3, $4, 'triage', 'normal', $5::jsonb, now(), 2) returning id`,
      [svc.id, A(), U().nazir.id, U().emp2.id, JSON.stringify({ formVersion: 2, answers: { capacity: "nazir", contactName: "ناظر تجريبي", contactPhone: "0555000001", preferredContact: "platform", priority: "normal", focus: ["governance"] }, docs: {} })],
    );
    await sql("update users set status = 'locked' where id = $1", [U().emp2.id]);
    const admin = await as(browser, "admin");
    await nextStep(admin, r.id, /سجّل التحقق/);
    await nextStep(admin, r.id, /اقبل الطلب/);
    await nextStep(admin, r.id, /ابدأ التنفيذ/);
    expect(await status(r.id)).toBe("in_progress");
    expect((await sql<{ assigned_to_user_id: string }>("select assigned_to_user_id from service_requests where id = $1", [r.id]))[0].assigned_to_user_id).toBe(U().emp2.id);
    await sql("update users set status = 'active' where id = $1", [U().emp2.id]);
    // leave no assignment behind (an assignment grants the employee access to the waqf's documents)
    await sql("update service_requests set status = 'cancelled', assigned_to_user_id = null where id = $1", [r.id]);

    // the client reads no revisions and no drafts; an unassigned employee cannot open the request
    const rid = reqId || (await sql<{ request_id: string }>("select request_id from request_revisions order by at desc limit 1"))[0].request_id;
    expect((await sql("select id from request_revisions where request_id = $1", [rid])).length).toBeGreaterThan(0);
    expect(await asUser(U().nazir.id, "select id from request_revisions where request_id = $1", [rid])).toHaveLength(0);
    expect(await asUser(U().nazir.id, "select id from outputs where request_id = $1", [rid])).toHaveLength(0);
    const emp = await as(browser, "emp1");
    await go(emp, `/admin/requests/${rid}`);
    await ex(emp.getByRole("heading", { name: "لم نجد ما طلبته" })).toBeVisible();
  });

  test("a waqf-management service runs its own stages", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const chair = await as(browser, "chair");
    await chair.goto(`/app/requests/new?service=N02&waqf=${demo().waqfs.C}`);
    await chair.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await chair.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    const r = { id: chair.url().match(/requests\/([0-9a-f-]{36})/)![1] };
    await chair.getByRole("radio", { name: "عضو مجلس النظارة" }).check();
    await chair.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(chair);
    await chair.getByLabel(/عدد أعضاء المجلس الحالي/).fill("5");
    const confirm = chair.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(chair, () => confirm.isVisible());
    await confirm.check();
    await chair.getByRole("button", { name: "أرسل الطلب" }).click();
    await chair.waitForURL(/\?created=1/, { timeout: 30_000 });
    const admin = await as(browser, "admin");
    await go(admin, `/admin/requests/${r.id}`);
    await ex(admin.getByTestId("exec-steps")).toContainText("نطاق العمل وعرض السعر"); // subscription: quote and contract
    await nextStep(admin, r.id, /ابدأ الفرز/);
    await go(admin, `/admin/requests/${r.id}`);
    await ex(admin.getByTestId("request-summary")).toContainText("التهيئة وبناء ملف الوقف");
    await ex(admin.getByTestId("exec-steps")).toContainText("مراحل العمل");
    await sql("update service_requests set status = 'cancelled' where id = $1", [r.id]);
  });
});
