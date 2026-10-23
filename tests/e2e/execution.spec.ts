import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, passWaqfData } from "./helpers";

/**
 * Execution engine (phase 3), synthetic data only:
 *  1. W01 will: structured form (tables) → «نفّذ الخطوة التالية» through triage/verify/accept → work started →
 *     «أنشئ مسودة الوصية» drafts the will text from the answers → specialist edits a clause → submit → independent
 *     approval by another reviewer with the advisor's signature → QA by a non-preparer → client approves → close;
 *  2. T03 deed: a mortgaged asset and missing documents block the draft with gaps naming the field/document and owner;
 *  3. intake documents: uploaded ≠ verified — verification is refused until each required document is verified;
 *     a rejected document raises a replacement item for the client;
 *  4. a staff member with no right on the request cannot run its next step (server-side check);
 *  5. the waqf file shows the operations center (required actions from records) with two-way request links.
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

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-exec-${key}-${demo().users[key].id}.json`;
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

/** Reloads the request page and runs the primary action; asserts the label and a success message. */
async function nextStep(page: Page, reqId: string, label: RegExp, terminal = false) {
  await go(page, `/admin/requests/${reqId}`);
  const btn = page.getByTestId("next-step");
  await ex(btn).toContainText(label);
  await btn.click();
  if (terminal) return void (await ex(page.getByTestId("execution-panel")).toContainText("الطلب منتهٍ"));
  const msg = page.getByTestId("execution-panel").locator('[role="status"], [role="alert"]').first();
  await ex(msg).toBeVisible();
  expect(await msg.getAttribute("role"), await msg.innerText()).toBe("status");
}

async function startIntake(page: Page, service: string, waqf: string, capacity: string) {
  await page.goto(`/app/requests/new?service=${service}&waqf=${waqf}`);
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
  const id = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
  await page.getByRole("radio", { name: capacity }).check();
  await page.getByRole("button", { name: "التالي" }).click();
  await passWaqfData(page);
  return id;
}
async function finishIntake(page: Page) {
  const confirm = page.getByLabel(/أقر بأن البيانات والمستندات/);
  for (let i = 0; i < 20 && !(await confirm.isVisible()); i++) {
    const nextBtn = page.getByRole("button", { name: "التالي" });
    if ((await nextBtn.count()) && (await nextBtn.isEnabled())) await nextBtn.click();
    await page.waitForTimeout(400); // the wizard saves the step before moving on
  }
  await confirm.check();
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await page.waitForURL(/\?created=1/, { timeout: 30_000 });
}
const yesNo = (p: Page, label: RegExp, v: "نعم" | "لا") => p.getByRole("group", { name: label }).getByRole("radio", { name: v }).check();
/** N01 v2: state and reasons (checkboxes), then the assets table and yes/no questions. */
async function fillN01(p: Page) {
  await p.getByRole("radio", { name: "الواقف يريد تعيين «وقفك»" }).check();
  await p.getByRole("checkbox", { name: "اختيار الواقف" }).check();
  await p.getByRole("button", { name: "التالي" }).click();
  await p.getByTestId("table-assets").getByRole("button", { name: /أضف صفًا/ }).click();
  await p.locator("#q-assets-0-type").selectOption({ index: 1 });
  await p.locator("#q-assets-0-description").fill("أصل تجريبي (اختبار آلي)");
  await yesNo(p, /حساب بنكي باسمه/, "نعم");
  await yesNo(p, /قوائم أو بيانات مالية/, "لا");
  await yesNo(p, /دعاوى أو مطالبات/, "لا");
}

test.describe.serial("execution engine: next step, drafted documents, verification, waqf center", () => {
  test.setTimeout(300_000);
  const U = () => demo().users;
  const W = () => demo().waqfs;
  let willReq = "";

  test.beforeAll(async () => {
    await sql("update service_requests set status = 'cancelled' where requester_user_id = any($1) and status = 'draft'", [[U().waqif.id, U().nazir.id]]);
  });
  test.afterAll(async () => {
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("W01: structured will form → next-step button → drafted will → independent approval → QA → client → closed", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const client = await as(browser, "waqif");
    willReq = await startIntake(client, "W01", W().B, "الواقف أو من يريد إنشاء الوقف");
    await client.getByRole("radio", { name: "وصية تتضمن وقفًا بعد الوفاة" }).check(); // W01 v3: the type first
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("رقم هوية الموصي").fill("1000000001");
    await client.getByRole("button", { name: "التالي" }).click();
    await yesNo(client, /هل لك وصية سابقة/, "لا");
    await client.getByRole("button", { name: "التالي" }).click();
    // bequests table: a waqf after death (share) and a charity (amount)
    await client.getByRole("button", { name: /أضف صفًا/ }).first().click();
    await client.locator("#q-bequests-0-kind").selectOption("waqf");
    await client.locator("#q-bequests-0-recipient").fill("الفقراء والمساكين في المدينة التجريبية");
    await client.locator("#q-bequests-0-relation").selectOption("entity");
    await client.locator("#q-bequests-0-basis").selectOption("share");
    await client.locator("#q-bequests-0-percent").fill("20");
    await client.getByTestId("table-bequests").getByRole("button", { name: "أضف صفًا" }).click();
    await client.locator("#q-bequests-1-kind").selectOption("charity");
    await client.locator("#q-bequests-1-recipient").fill("جمعية البر التجريبية");
    await client.locator("#q-bequests-1-relation").selectOption("entity");
    await client.locator("#q-bequests-1-basis").selectOption("amount");
    await client.locator("#q-bequests-1-amount").fill("50000");
    await client.getByLabel(/تقدير إجمالي التركة/).fill("1000000");
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("الاسم المقترح للوقف").fill("وقف الاختبار الآلي للوصية");
    await client.getByTestId("table-waqfMasarif").getByRole("button", { name: /أضف صفًا/ }).click();
    await client.locator("#q-waqfMasarif-0-beneficiary").fill("الفقراء والمساكين");
    await client.locator("#q-waqfMasarif-0-share").fill("100");
    await client.getByLabel("ناظر الوقف بعد الوفاة").fill("ناظر تجريبي");
    await client.getByRole("radio", { name: "الأصلح فالأصلح من الموقوف عليهم" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("الوصي (منفذ الوصية)").fill("منفذ تجريبي");
    await client.getByLabel("صفة الوصي").selectOption("heir");
    await client.getByRole("radio", { name: /عبر «ناجز»/ }).check();
    await finishIntake(client);
    const [{ intake }] = await sql<{ intake: { answers: Record<string, string> } }>("select intake from service_requests where id = $1", [willReq]);
    expect(JSON.parse(intake.answers.bequests)).toHaveLength(2);

    // an authorized manager runs the steps directly from the execution panel
    const admin = await as(browser, "admin");
    await go(admin, `/admin/requests/${willReq}`);
    await ex(admin.getByTestId("current-step")).toHaveText("استلام الطلب وبدء الفرز");
    await admin.screenshot({ path: `${shots}/exec-panel-start-desktop.png`, fullPage: false });
    await nextStep(admin, willReq, /ابدأ الفرز/);
    await nextStep(admin, willReq, /سجّل التحقق من البيانات والمستندات/);
    await nextStep(admin, willReq, /اقبل الطلب للخدمة/);
    // a paid service: the quote needs a human (prices, terms) → the panel points there instead of running anything
    await go(admin, `/admin/requests/${willReq}`);
    await ex(admin.getByTestId("next-step-link")).toHaveText("أعدّ عرض السعر");
    // started as an operations package (allowed by the workflow) → commercial steps are shown as skipped
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => status(willReq)).toBe("in_progress");

    // one click: «أنشئ مسودة الوصية» → the will text is drafted from the answers
    await nextStep(admin, willReq, /أنشئ مسودة «نص الوصية»/);
    const [o] = await sql<{ id: string }>("select id from outputs where request_id = $1", [willReq]);
    await go(admin, `/admin/requests/${willReq}/outputs/${o.id}`);
    const doc = admin.getByTestId("section-will_clauses");
    await ex(doc).toContainText("أوصي بنسبة 20٪ من تركتي وقفًا بعد وفاتي على الفقراء والمساكين في المدينة التجريبية.");
    await ex(doc).toContainText("أوصي بمبلغ 50,000 ريال سعودي صدقةً لـجمعية البر التجريبية.");
    await ex(doc).toContainText("يُسمّى «وقف الاختبار الآلي للوصية»");
    await ex(doc).toContainText("أُسند تنفيذ هذه الوصية إلى منفذ تجريبي، وهو من ورثتي");
    await ex(doc).not.toContainText(/\[يُستكمل: [^…]/);
    // the third: computed from the client's own estimate → «client's statement», never a tick; the ruling → specialist
    await ex(admin.getByTestId("check-third_arith")).toHaveAttribute("data-status", "client_attested");
    await ex(admin.getByTestId("check-third_arith")).toContainText("المجموع 25٪ من التركة");
    await ex(admin.getByTestId("check-third_legal")).toHaveAttribute("data-status", "specialist");
    await admin.screenshot({ path: `${shots}/will-draft-desktop.png`, fullPage: true });

    // the panel blocks on the specialist note and links to the editor
    await go(admin, `/admin/requests/${willReq}`);
    await ex(admin.getByTestId("blockers")).toContainText("يكتبه المختص");
    await ex(admin.getByTestId("next-step-link")).toHaveText("افتح المسودة وأكملها");
    // edit: specialist note + one clause (kept as a human edit)
    await go(admin, `/admin/requests/${willReq}/outputs/${o.id}`);
    await admin.locator('textarea[name^="spec:"]').first().fill("روجعت البنود: الوصايا دون الثلث، ولا وصية لوارث. (اختبار آلي)");
    await admin.locator('textarea[name="clause:will_clauses:executor"]').fill("أُسند تنفيذ هذه الوصية إلى منفذ تجريبي، وهو من ورثتي، ويعاونه في ذلك من يختاره. (تعديل بشري)");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);

    await nextStep(admin, willReq, /أرسل المسودة للمراجعة/);
    // independent policy: the preparer here is the system administrator — direct approval would be allowed and
    // recorded (no written policy requires a second person); a reviewer who did not prepare it approves instead
    await go(admin, `/admin/requests/${willReq}/outputs/${o.id}`);
    await ex(admin.getByText("أنت ممن أعدّوا هذا المخرج؛ يُسجَّل اعتمادك اعتمادًا ذاتيًا", { exact: false })).toBeVisible();
    // another reviewer approves with the advisor's signature (sharia output → in the editor)
    const ops = await as(browser, "ops");
    await go(ops, `/admin/requests/${willReq}`);
    await ex(ops.getByTestId("next-step-link")).toContainText("سجّل رأي المختص في 1 من الفحوص ثم اعتمد (يلزم توقيع المستشار)");
    await go(ops, `/admin/requests/${willReq}/outputs/${o.id}`);
    // approval waits for the specialist's finding on the ruling the platform cannot decide
    await ex(ops.getByTestId("approve-blocked")).toContainText("بانتظار رأي المختص");
    const third = ops.getByTestId("check-third_legal");
    await third.getByText("سجّل رأي المختص").click();
    await third.locator('select[name="status"]').selectOption("verified");
    await third.locator('textarea[name="note"]').fill("الوصايا دون الثلث ولا وصية لوارث (اختبار آلي).");
    await third.getByRole("button", { name: "سجّل الرأي" }).click();
    await ex(ops.getByText("سُجّل رأي المختص في الفحص.")).toBeVisible();
    await go(ops, `/admin/requests/${willReq}/outputs/${o.id}`);
    await ops.getByLabel("التوقيع: اسم المستشار وصفته").fill("مستشار تجريبي — مستشار شرعي");
    await ops.getByRole("button", { name: "اعتمد المخرج" }).click();
    await ex(ops.getByText(/معتمد — النسخة 2/)).toBeVisible();
    const [v2] = await sql<{ sections: unknown }>("select sections from output_versions where output_id = $1 and version = 2", [o.id]);
    expect(JSON.stringify(v2.sections)).toContain("(تعديل بشري)");

    // to quality review (the preparer), then QA by a non-preparer
    await nextStep(admin, willReq, /أرسل لمراجعة الجودة/);
    // the administrator delivered the work: his own quality review would be a recorded direct approval
    await go(admin, `/admin/requests/${willReq}`);
    await ex(admin.getByTestId("next-step")).toContainText("اعتماد ذاتي مسجّل");
    await nextStep(ops, willReq, /اعتمد الجودة وأرسل للعميل/);
    await ex.poll(() => status(willReq)).toBe("awaiting_client_approval");
    const [pdf] = await sql<{ document_id: string | null }>("select document_id from outputs where id = $1", [o.id]);
    expect(pdf.document_id).toBeTruthy();

    // the client approves; the team closes from the panel
    await go(client, `/app/requests/${willReq}`);
    await client.getByTestId("approval-ack").locator("input").check();
    await client.getByRole("button", { name: "أعتمد المخرجات" }).click();
    await ex.poll(() => status(willReq)).toBe("completed");
    await nextStep(admin, willReq, /أغلق الطلب/, true);
    await ex.poll(() => status(willReq)).toBe("closed");
    const audits = await sql<{ n: number }>("select count(*)::int n from audit_logs where action = 'requests.next_step' and entity_id = $1", [willReq]);
    expect(audits[0].n).toBeGreaterThanOrEqual(7);
  });

  test("a stale or repeated click does nothing; staff with no right cannot run the next step", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const client = await as(browser, "nazir");
    const id = await startIntake(client, "C01", W().A, "ناظر الوقف");
    await client.getByRole("checkbox", { name: "الحوكمة والنظارة" }).check();
    await finishIntake(client);
    const admin = await as(browser, "admin");
    await go(admin, `/admin/requests/${id}`);
    // two tabs on the same state: the second click is refused, the state moved once
    const tab2 = await admin.context().newPage();
    await go(tab2, `/admin/requests/${id}`);
    await admin.getByTestId("next-step").click();
    await ex(admin.getByTestId("execution-panel").getByRole("status")).toBeVisible();
    await tab2.getByTestId("next-step").click();
    await ex(tab2.getByTestId("execution-panel").getByRole("alert")).toContainText("تغيّرت حالة الطلب");
    await tab2.close();
    expect(await status(id)).toBe("triage");
    // an employee not assigned: the page is not found, and posting the action directly is refused server-side
    const emp = await as(browser, "emp1");
    await go(emp, `/admin/requests/${id}`);
    await ex(emp.getByRole("heading", { name: "لم نجد ما طلبته" })).toBeVisible();

    // the free service runs to its output through the panel; the manager completes the work stages
    await nextStep(admin, id, /سجّل التحقق/);
    await nextStep(admin, id, /اقبل الطلب/);
    await nextStep(admin, id, /ابدأ التنفيذ/);
    await ex.poll(() => status(id)).toBe("in_progress");
    await nextStep(admin, id, /أنشئ مسودة/);
    const [o] = await sql<{ id: string }>("select id from outputs where request_id = $1", [id]);
    await go(admin, `/admin/requests/${id}/outputs/${o.id}`);
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("نص المختص (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);
    await nextStep(admin, id, /أرسل المسودة للمراجعة/);
    await nextStep(admin, id, /اعتمد «/); // self_allowed: authorized manager, recorded as self-approval
    await nextStep(admin, id, /أنجزت مرحلة/);
    await nextStep(admin, id, /أرسل لمراجعة الجودة/);
    await nextStep(admin, id, /اعتماد ذاتي/);
    await ex.poll(() => status(id)).toBe("awaiting_client_approval");
  });

  test("T03 deed: drafted clauses; a mortgaged asset and missing documents block with gaps naming field and owner", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const [svc] = await sql<{ id: string }>("select id from services where code = 'T03'");
    const answers = {
      capacity: "waqif", contactName: "واقف تجريبي", waqifName: "واقف تجريبي", waqifId: "1000000003", waqfName: "وقف الاختبار الآلي", waqfKind: "general",
      assetType: "real_estate", assetDescription: "أرض تجريبية في حي الاختبار مساحتها 600 م²", ownershipDeedNo: "TEST-1", registeredToWaqif: "yes", mortgaged: "yes", share: "whole", appurtenances: "all",
      masarif: JSON.stringify([{ tier: "1", beneficiary: "أولاد الواقف", division: "equal" }, { tier: "2", beneficiary: "طلبة العلم", division: "na" }]),
      alternateMasraf: "الفقراء والمساكين", selfBenefit: "no", nazirType: "named", nazirName: "ناظر تجريبي", succession: "authority", investmentAllowed: "yes",
    };
    const [r] = await sql<{ id: string }>(
      `insert into service_requests (number, service_id, waqf_id, requester_user_id, status, priority, intake, submitted_at, intake_form_version)
       values ('REQ-X' || floor(random()*1e9)::text, $1, $2, $3, 'in_progress', 'normal', $4::jsonb, now(), 2) returning id`,
      [svc.id, W().B, U().waqif.id, JSON.stringify({ formVersion: 2, answers, docs: {} })],
    );
    const admin = await as(browser, "admin");
    await nextStep(admin, r.id, /أنشئ مسودة/);
    const [o] = await sql<{ id: string }>("select id from outputs where request_id = $1", [r.id]);
    const [v] = await sql<{ gaps: { key: string; severity: string; owner?: string; field?: string }[] }>("select gaps from output_versions where output_id = $1 and version = 1", [o.id]);
    expect(v.gaps.find((g) => g.key === "mortgaged")).toMatchObject({ severity: "blocking", owner: "client" });
    expect(v.gaps.find((g) => g.key === "doc:ownership")).toMatchObject({ severity: "blocking" });
    await go(admin, `/admin/requests/${r.id}/outputs/${o.id}`);
    await ex(admin.getByTestId("section-deed_clauses")).toContainText("على أولاد الواقف بالتساوي بينهم؛ فإن انقرضوا أو انقطعوا فعلى طلبة العلم");
    await ex(admin.getByTestId("output-gaps")).toContainText("الأصل مرهون ولم تُرفق موافقة المرتهن");
    // the PDF of the draft carries the draft status and the clauses
    const pdf = await admin.request.get(`/admin/requests/${r.id}/outputs/${o.id}/pdf?v=1`);
    expect(pdf.status()).toBe(200);
    await go(admin, `/admin/requests/${r.id}`);
    await ex(admin.getByTestId("current-step")).toContainText("إعداد مسودة");
    await ex(admin.getByTestId("blockers")).toContainText("موافقة المرتهن");
    await admin.screenshot({ path: `${shots}/deed-blocked-desktop.png`, fullPage: false });
    await sql("update service_requests set status = 'cancelled' where id = $1", [r.id]);
  });

  test("intake documents: uploaded is not verified; rejection raises a replacement item", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const client = await as(browser, "nazir");
    const id = await startIntake(client, "N01", W().A, "ناظر الوقف");
    await fillN01(client);
    for (let i = 0; i < 20 && !(await client.getByTestId("slot-svc_waqf_deed").isVisible()); i++) {
      const nextBtn = client.getByRole("button", { name: "التالي" });
      if ((await nextBtn.count()) && (await nextBtn.isEnabled())) await nextBtn.click();
      await client.waitForTimeout(400);
    }
    const slot = client.getByTestId("slot-svc_waqf_deed");
    await slot.getByTestId("document-file-input").setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF") });
    await ex(slot.getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    await finishIntake(client);

    const admin = await as(browser, "admin");
    await nextStep(admin, id, /ابدأ الفرز/);
    await go(admin, `/admin/requests/${id}`);
    await ex(admin.getByTestId("blockers")).toContainText("مستندات مرفوعة لم يُتحقق منها");
    await ex(admin.getByTestId("next-step-link")).toHaveText("راجع المستندات");
    // the old verify button is refused server-side too
    await admin.getByRole("button", { name: "تحققت من البيانات والمستندات" }).click();
    await ex(admin.getByText(/مرفوع لا يعني متحققًا منه/)).toBeVisible();
    // reject → a replacement item for the client
    const row = admin.getByTestId("docslot-svc_waqf_deed");
    await row.getByRole("button", { name: "ارفض واطلب استبداله" }).click();
    await row.getByLabel(/سبب الرفض/).fill("الصورة غير واضحة (اختبار آلي).");
    await row.getByRole("button", { name: "ارفض المستند" }).click();
    await ex.poll(async () => (await sql<{ title: string }>("select title from request_items where request_id = $1 and kind = 'document'", [id]))[0]?.title ?? "").toContain("استبدال مستند");
    await ex.poll(() => status(id)).toBe("awaiting_client");
    await sql("update service_requests set status = 'cancelled' where id = $1", [id]);
  });

  test("the waqf file is an operations center with two-way request links", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const nazir = await as(browser, "nazir");
    await go(nazir, `/app/w/${W().A}`);
    const c = nazir.getByTestId("waqf-center");
    await ex(c).toBeVisible();
    await ex(c).toContainText("المسؤول:");
    await nazir.screenshot({ path: `${shots}/waqf-center-desktop.png`, fullPage: false });
    const admin = await as(browser, "admin");
    await go(admin, `/admin/waqfs/${W().A}`);
    await ex(admin.getByTestId("waqf-center")).toBeVisible();
    // an open request on the waqf appears in the center and links to the staff request page
    const [open] = await sql<{ id: string }>("select id from service_requests where waqf_id = $1 and status not in ('draft','closed','cancelled','rejected') order by updated_at desc limit 1", [W().A]);
    if (open) await ex(admin.getByTestId(`center-req:${open.id}`).getByRole("link")).toHaveAttribute("href", `/admin/requests/${open.id}`);
  });
});
