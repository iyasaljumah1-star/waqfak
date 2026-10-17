import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, passWaqfData } from "./helpers";

/**
 * Continuous services (decision of 15 Oct 2026), synthetic data only:
 *  1. F08 quarterly financial-performance reports, end to end by an authorized manager: the term is set from the
 *     client's chosen cadence; cycle 1 is late; draft → returned for revision → corrected → approved → sent to the
 *     client (the request stays in progress) → checklist → cycle closed → cycle 2 opened on the same request;
 *     a cycle with no ledger entries shows its missing data and a non-blocking deficiency is raised to the client;
 *     suspension (no lateness while suspended, no cycle actions) and resumption; permissions (an assigned employee
 *     cannot terminate or skip; the client reads only sent cycles; an unassigned employee cannot open the request);
 *     termination with reason and reference → remaining periods skipped with reasons → the service ends with its term.
 *  2. N02 independent board member: no fabricated report — a follow-up cycle per meeting, closed only once the
 *     meeting is linked and the follow-up note written; the request stays open.
 * No invoice is created by any cycle. Desktop only (shared demo records).
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
  const file = `/tmp/claude-0/e2e-cs-${key}-${demo().users[key].id}.json`;
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
const cycles = (id: string) => sql<{ seq: number; status: string; label: string; output_key: string | null; due_on: string; delivered_on: string | null }>(
  "select seq, status, label, output_key, to_char(due_on, 'YYYY-MM-DD') as due_on, to_char(delivered_on, 'YYYY-MM-DD') as delivered_on from service_cycles where request_id = $1 order by seq", [id]);
const invoiceCount = async (id: string) => (await sql<{ n: string }>("select count(*)::text as n from invoices where request_id = $1", [id]))[0].n;

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
/** Ticks every open checklist item of a cycle (each click reloads the panel). */
async function tickAll(page: Page, reqId: string, seq: number) {
  for (let i = 0; i < 10; i++) {
    await go(page, `/admin/requests/${reqId}#service`);
    const list = page.getByTestId(`cycle-${seq}-checklist`);
    await ex(list.getByRole("button").first()).toBeVisible();
    const btn = list.getByRole("button", { name: /^أنجزت:/ }).first();
    if (!(await btn.count())) return;
    const before = (await sql<{ n: number }>("select count(*)::int as n from service_cycles c, jsonb_array_elements(c.checklist) x where c.request_id = $1 and c.seq = $2 and (x->>'done')::boolean", [reqId, seq]))[0].n;
    await btn.click();
    await ex.poll(async () => (await sql<{ n: number }>("select count(*)::int as n from service_cycles c, jsonb_array_elements(c.checklist) x where c.request_id = $1 and c.seq = $2 and (x->>'done')::boolean", [reqId, seq]))[0].n).toBe(before + 1);
  }
}

test.describe.serial("continuous services", () => {
  test.setTimeout(480_000);
  const U = () => demo().users;
  const A = () => demo().waqfs.A;
  const ledgerTag = "اختبار آلي — خدمة مستمرة";
  let reqId = "";

  test.afterAll(async () => {
    // Synthetic ledger rows of this spec only; no assignment is left behind (an assignment grants document access).
    await sql("delete from ledger_entries where description = $1", [ledgerTag]);
    if (reqId) await sql("update service_requests set assigned_to_user_id = null where id = $1", [reqId]);
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("F08: periodic cycles with review, return, approval, sending, closing; lateness, missing data, suspension, permissions, termination", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    // Synthetic, balanced entries for the first quarter (the demo ledger has none for July–September).
    await sql("delete from ledger_entries where description = $1", [ledgerTag]);
    await sql(`insert into ledger_entries (waqf_id, entry_date, account_code, description, debit, credit) values
      ($1, '2026-02-10', '1100', $2, 5000, 0), ($1, '2026-02-10', '4100', $2, 0, 5000)`, [A(), ledgerTag]);

    // 1) the client asks for quarterly reports
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=F08&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(client);
    await client.getByLabel("الدورية").selectOption("quarterly");
    await client.getByLabel("من يستلم التقرير؟").fill("الناظر (اختبار آلي)");
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(client, () => confirm.isVisible());
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });

    // 2) the manager starts it (operational agreement) and completes onboarding
    const admin = await as(browser, "admin");
    await nextStep(admin, reqId, /ابدأ الفرز/);
    await nextStep(admin, reqId, /سجّل التحقق/);
    await nextStep(admin, reqId, /اقبل الطلب/);
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => status(reqId)).toBe("in_progress");
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("exec-steps")).not.toContainText("مراجعة الجودة والإفراج");
    await ex(admin.getByTestId("next-step-link")).toHaveText("حدّد مدة الخدمة ودوريتها");

    // 3) no default cadence for F08 (no source sets one): nothing is scheduled until the contract's cadence is chosen
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.getByTestId("continuous-panel")).toContainText("الدورية غير محددة");
    await ex(admin.locator('select[name="cadence"]')).toHaveValue("");
    await ex(admin.getByText("طلب العميل في النموذج: ربع سنوية.")).toBeVisible(); // a hint, not applied
    expect(await cycles(reqId)).toHaveLength(0);
    await admin.locator('input[name="startOn"]').fill("2026-01-01");
    await admin.locator('input[name="endOn"]').fill("2026-12-31");
    await admin.locator('input[name="dueOffsetDays"]').fill("15");
    await admin.locator('select[name="cadence"]').selectOption("quarterly");
    await admin.getByRole("button", { name: "فعّل مدة الخدمة وجدول التسليمات" }).click();
    await ex.poll(async () => (await sql("select 1 from service_terms where request_id = $1 and cadence = 'quarterly' and cadence_source = 'set' and client_acceptance = 'required'", [reqId])).length).toBe(1);

    // 4) cycle 1 (January–March) is opened; it is already late (due 15 April)
    await nextStep(admin, reqId, /افتح دورة «الفترة 1/);
    expect((await cycles(reqId))[0]).toMatchObject({ seq: 1, status: "open", due_on: "2026-04-15" });
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.getByTestId("cycle-1")).toContainText("متوفر"); // ledger entries exist for the quarter
    await ex(admin.getByTestId("summary-cycles")).toContainText("1 متأخرة");
    await admin.screenshot({ path: `${shots}/continuous-cycle1-open.png`, fullPage: true });

    // 5) draft → reviewer returns it → specialist corrects → self-approval under the policy
    await nextStep(admin, reqId, /أعدّ مسودة/);
    const [{ id: outputId }] = await sql<{ id: string }>("select id from outputs where request_id = $1 and output_key = 'F08.cycle@c1'", [reqId]);
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(admin.getByTestId("section-finance")).toContainText("2026-01-01");
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("إيضاح المحاسب للربع الأول (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);
    const ops = await as(browser, "ops");
    await go(ops, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ops.getByLabel("ما يلزم تعديله").fill("أضف مقارنة بالربع السابق (اختبار آلي).");
    await ops.getByRole("button", { name: "أعده للتعديل" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from outputs where id = $1", [outputId]))[0].status).toBe("returned");
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("blockers")).toContainText("أعاده المراجع");
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("إيضاح المحاسب مع المقارنة بالربع السابق (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(3);
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);
    await nextStep(admin, reqId, /اعتمد تسليم/);
    // approved is not sent: the client sees nothing yet, and the request has not moved
    expect(await status(reqId)).toBe("in_progress");
    expect(await asUser(U().nazir.id, "select id from deliverables where request_id = $1 and released_at is not null", [reqId])).toHaveLength(0);
    expect(await asUser(U().nazir.id, "select id from service_cycles where request_id = $1", [reqId])).toHaveLength(0);

    // 6) made available to the client in the platform (in-app notice only); the request stays open
    await nextStep(admin, reqId, /أتح تسليم/);
    expect((await cycles(reqId))[0].status).toBe("sent");
    expect(await status(reqId)).toBe("in_progress");
    const [note1] = await sql<{ type: string }>("select type from notifications where user_id = $1 and type = 'delivery.available' order by created_at desc limit 1", [U().nazir.id]);
    expect(note1?.type).toBe("delivery.available");
    await go(client, `/app/requests/${reqId}#deliveries`);
    const d1 = client.getByTestId("delivery-1");
    await ex(client.getByTestId("client-continuous")).toContainText("2026-01-01 إلى 2026-12-31");
    await ex(d1).toContainText("لم تفتحه بعد");
    await ex(d1).toContainText("بانتظار قرارك");
    // «viewed» is recorded only when the client opens the file
    expect((await sql<{ viewed_at: Date | null }>("select viewed_at from service_cycles where request_id = $1 and seq = 1", [reqId]))[0].viewed_at).toBeNull();
    const view = await client.request.get(await d1.getByRole("link", { name: "معاينة الملف" }).first().getAttribute("href") as string);
    expect(view.status()).toBe(200);
    expect(view.headers()["content-type"]).toContain("application/pdf");
    expect((await sql<{ viewed_at: Date | null }>("select viewed_at from service_cycles where request_id = $1 and seq = 1", [reqId]))[0].viewed_at).not.toBeNull();

    // 7) silence is not approval: the cycle cannot close while the client has not decided
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("blockers")).toContainText("لا يُعد سكوته اعتمادًا");
    await tickAll(admin, reqId, 1);
    await go(admin, `/admin/requests/${reqId}#service`);
    await admin.getByTestId("cycle-1").getByRole("button", { name: /أقفل الدورة/ }).click();
    await ex(admin.getByTestId("cycle-1").getByRole("alert")).toContainText("لم يعتمد العميل التسليم بعد");

    // 8) the client asks for changes (notes required); the work goes back with every version kept
    await go(client, `/app/requests/${reqId}#deliveries`);
    await client.getByTestId("delivery-1").getByRole("button", { name: "طلب تعديل" }).click();
    await ex(client.getByTestId("delivery-1").locator("textarea:invalid")).toHaveCount(1); // the note is required
    await client.getByTestId("delivery-1").getByLabel("ما يلزم تعديله").fill("أضيفوا إيضاحًا عن مصروفات الصيانة (اختبار آلي).");
    await client.getByTestId("delivery-1").getByRole("button", { name: "طلب تعديل" }).click();
    await ex.poll(async () => (await sql<{ client_decision: string; status: string }>("select client_decision, status from service_cycles where request_id = $1 and seq = 1", [reqId]))[0]).toEqual({ client_decision: "revision_requested", status: "open" });
    expect(await status(reqId)).toBe("in_progress");
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("blockers")).toContainText("مصروفات الصيانة");
    await ex(admin.getByTestId("next-step-link")).toHaveText("افتح مراجعة جديدة للمخرج وعدّله");
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await admin.getByRole("button", { name: "افتح مراجعة جديدة" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from outputs where id = $1", [outputId]))[0].status).toBe("draft");
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("إيضاح المحاسب مع المقارنة ومصروفات الصيانة (اختبار آلي).");
    await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(4);
    await nextStep(admin, reqId, /أرسل المسودة للمراجعة/);
    await nextStep(admin, reqId, /اعتمد تسليم/);
    await nextStep(admin, reqId, /أتح تسليم/);
    const files = await sql<{ version: number; status: string; released: boolean }>("select version, status, released_at is not null as released from deliverables where request_id = $1 and cycle_id is not null order by version", [reqId]);
    expect(files).toEqual([{ version: 1, status: "revision_requested", released: true }, { version: 2, status: "submitted", released: true }]);

    // 9) the client approves the corrected version: who, when, which version
    await go(client, `/app/requests/${reqId}#deliveries`);
    await ex(client.getByTestId("delivery-1")).toContainText("الإصدار 2");
    await client.getByTestId("delivery-1").getByLabel("ملاحظة مع الاعتماد (اختيارية)").fill("مستلم (اختبار آلي).");
    await client.getByTestId("delivery-1").getByRole("button", { name: "اعتماد التسليم" }).click();
    await ex.poll(async () => (await sql<{ client_decision: string }>("select client_decision from service_cycles where request_id = $1 and seq = 1", [reqId]))[0].client_decision).toBe("approved");
    const [dec] = await sql<{ by: string; v: number; note: string }>("select client_decision_by as by, client_approved_version as v, client_decision_note as note from service_cycles where request_id = $1 and seq = 1", [reqId]);
    expect(dec).toEqual({ by: U().nazir.id, v: 4, note: "مستلم (اختبار آلي)." });
    expect(await status(reqId)).toBe("in_progress"); // approval does not close the request
    expect((await sql("select 1 from audit_logs where action = 'continuous.client_approve' and entity_id = (select id::text from service_cycles where request_id = $1 and seq = 1)", [reqId])).length).toBe(1);

    // 10) the cycle closes; the request stays open for the next one
    await nextStep(admin, reqId, /أقفل دورة/);
    expect((await cycles(reqId))[0].status).toBe("closed");
    expect(await status(reqId)).toBe("in_progress");
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.getByTestId("cycle-history")).toContainText("النسخة 4");

    // 11) the next cycle on the same request
    await nextStep(admin, reqId, /افتح دورة «الفترة 2/);
    expect((await cycles(reqId)).map((c) => [c.seq, c.status])).toEqual([[1, "closed"], [2, "open"]]);

    // 9) missing data: the third quarter has no ledger entries → shown, and a non-blocking deficiency is raised
    await go(admin, `/admin/requests/${reqId}#service`);
    await admin.getByRole("button", { name: /افتح دورة «الفترة 3/ }).click();
    await ex.poll(async () => (await cycles(reqId)).length).toBe(3);
    await go(admin, `/admin/requests/${reqId}#service`);
    const c3 = admin.getByTestId("cycle-3-inputs");
    await ex(c3).toContainText("ناقص");
    await ex(c3).toContainText("لا قيود بين 2026-07-01 و2026-09-30");
    await c3.getByRole("button", { name: "اطلب استكماله من العميل" }).click();
    await ex.poll(async () => (await sql("select 1 from request_items where request_id = $1 and title like $2", [reqId, "%الفترة 3%"])).length).toBe(1);
    expect(await status(reqId)).toBe("in_progress"); // non-blocking: the service goes on
    await admin.screenshot({ path: `${shots}/continuous-missing.png`, fullPage: true });

    // 10) permissions: an assigned employee works the cycles but cannot terminate, skip or move due dates
    await sql("update service_requests set assigned_to_user_id = $1 where id = $2", [U().emp1.id, reqId]);
    const emp = await as(browser, "emp1");
    await go(emp, `/admin/requests/${reqId}#service`);
    await ex(emp.getByTestId("continuous-panel")).toBeVisible();
    await ex(emp.getByRole("button", { name: "سجّل إنهاء العقد" })).toHaveCount(0);
    await ex(emp.getByRole("button", { name: "تجاوز الدورة" })).toHaveCount(0);
    await ex(emp.getByRole("button", { name: "اضبط اعتماد العميل" })).toHaveCount(0);
    await sql("update service_requests set assigned_to_user_id = null where id = $1", [reqId]);
    const emp2 = await as(browser, "emp2");
    await go(emp2, `/admin/requests/${reqId}`);
    await ex(emp2.getByRole("heading", { name: "لم نجد ما طلبته" })).toBeVisible();
    // the client reads only what was made available to them; another waqf's client reads nothing
    expect((await asUser<{ seq: number }>(U().nazir.id, "select seq from service_cycles where request_id = $1", [reqId])).map((r) => r.seq)).toEqual([1]);
    expect(await asUser(U().waqif.id, "select id from service_cycles where request_id = $1", [reqId])).toHaveLength(0);
    const [del1] = await sql<{ id: string; document_id: string }>("select id, document_id from deliverables where request_id = $1 and cycle_id is not null order by version limit 1", [reqId]);
    const outsider = await as(browser, "waqif");
    expect((await outsider.request.get(`/api/deliveries/${del1.id}`, { maxRedirects: 0 })).status()).toBe(404);
    expect((await outsider.request.get(`/api/files/${del1.document_id}`)).status()).toBeGreaterThanOrEqual(403);
    // a client of another waqf cannot decide on this delivery even with its id (server-side check)
    expect(await asUser(U().waqif.id, "select id from deliverables where request_id = $1", [reqId])).toHaveLength(0);

    // 11) suspension: the hold suspends the term; no lateness while suspended; cycle actions refused
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByRole("button", { name: "تعليق الطلب" }).click();
    const hold = admin.locator("form", { has: admin.locator('input[name="to"][value="on_hold"]') });
    await hold.locator('select[name="holdParty"]').selectOption("client");
    await hold.locator('textarea[name="note"]').fill("بطلب الناظر لحين اعتماد الميزانية (اختبار آلي).");
    await hold.getByRole("button", { name: "تعليق الطلب" }).click();
    await ex.poll(() => status(reqId)).toBe("on_hold");
    expect((await sql<{ status: string }>("select status from service_terms where request_id = $1", [reqId]))[0].status).toBe("suspended");
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.getByTestId("continuous-status")).toContainText("معلّقة");
    await ex(admin.getByTestId("summary-cycles")).toContainText("0 متأخرة");
    await ex(admin.getByRole("button", { name: /افتح دورة/ })).toHaveCount(0);
    await nextStep(admin, reqId, /استأنف الطلب/);
    expect((await sql<{ status: string }>("select status from service_terms where request_id = $1", [reqId]))[0].status).toBe("active");

    // 12) termination (recorded with reason and reference); remaining periods are skipped with reasons; the service ends
    await go(admin, `/admin/requests/${reqId}#service`);
    const term = admin.locator("form", { has: admin.getByRole("button", { name: "سجّل إنهاء العقد" }) });
    await term.locator('input[name="effectiveOn"]').fill("2026-10-14");
    await term.locator('select[name="initiatedBy"]').selectOption("client");
    await term.locator('textarea[name="reason"]').fill("قرر الناظر نقل التقارير إلى المراجع الداخلي (اختبار آلي).");
    await term.locator('input[name="reference"]').fill("خطاب الناظر رقم ت-1 (تجريبي)");
    await term.getByRole("button", { name: "سجّل إنهاء العقد" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from service_terms where request_id = $1", [reqId]))[0].status).toBe("terminated");
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.getByTestId("continuous-panel")).toContainText("فترات بلا دورة");
    // the open cycles 2 and 3 are skipped with reasons; period 4 (1–14 October) is opened and skipped
    for (const seq of [2, 3]) {
      await go(admin, `/admin/requests/${reqId}#service`);
      const panel = admin.getByTestId(`cycle-${seq}`);
      await panel.locator("summary", { hasText: "تغيير الموعد أو تجاوز الدورة" }).click();
      await panel.locator('textarea[name="reason"]').fill("أُنهي العقد قبل إعداد تسليم الفترة (اختبار آلي).");
      await panel.getByRole("button", { name: "تجاوز الدورة" }).click();
      await ex.poll(async () => (await cycles(reqId)).find((c) => c.seq === seq)?.status).toBe("skipped");
    }
    await go(admin, `/admin/requests/${reqId}#service`);
    await admin.getByRole("button", { name: /افتح دورة «الفترة 4/ }).click();
    await ex.poll(async () => (await cycles(reqId)).length).toBe(4);
    await go(admin, `/admin/requests/${reqId}#service`);
    const p4 = admin.getByTestId("cycle-4");
    await p4.locator("summary", { hasText: "تغيير الموعد أو تجاوز الدورة" }).click();
    await p4.locator('textarea[name="reason"]').fill("فترة جزئية قبل نفاذ الإنهاء بلا تقرير متفق عليه (اختبار آلي).");
    await p4.getByRole("button", { name: "تجاوز الدورة" }).click();
    await ex.poll(async () => (await cycles(reqId)).find((c) => c.seq === 4)?.status).toBe("skipped");
    await nextStep(admin, reqId, /أنهِ الخدمة/);
    expect(await status(reqId)).toBe("completed");
    // no cycle created an invoice; the history keeps every cycle
    expect(await invoiceCount(reqId)).toBe("0");
    expect((await cycles(reqId)).map((c) => c.status)).toEqual(["closed", "skipped", "skipped", "skipped"]);
    // closing unmounts the action area (terminal request), so the result is read from the database
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("next-step")).toContainText(/أغلق الطلب/);
    await admin.getByTestId("next-step").click();
    await ex.poll(() => status(reqId)).toBe("closed");
  });

  test("N02: follow-up per board meeting, with no fabricated report", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const chair = await as(browser, "chair");
    await chair.goto(`/app/requests/new?service=N02&waqf=${demo().waqfs.C}`);
    await chair.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await chair.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    const id = chair.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await chair.getByRole("radio", { name: "عضو مجلس النظارة" }).check();
    await chair.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(chair);
    await chair.getByLabel(/عدد أعضاء المجلس الحالي/).fill("5");
    await chair.getByLabel(/مدة العضوية المطلوبة/).fill("12");
    const confirm = chair.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(chair, () => confirm.isVisible());
    await confirm.check();
    await chair.getByRole("button", { name: "أرسل الطلب" }).click();
    await chair.waitForURL(/\?created=1/, { timeout: 30_000 });

    const admin = await as(browser, "admin");
    await nextStep(admin, id, /ابدأ الفرز/);
    await nextStep(admin, id, /سجّل التحقق/);
    await nextStep(admin, id, /اقبل الطلب/);
    await go(admin, `/admin/requests/${id}`);
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => status(id)).toBe("in_progress");
    await go(admin, `/admin/requests/${id}#service`);
    await ex(admin.locator('select[name="cadence"]')).toHaveValue("event");
    await admin.locator('input[name="startOn"]').fill("2026-06-01");
    await admin.locator('input[name="endOn"]').fill("2027-05-31");
    await admin.getByRole("button", { name: "فعّل مدة الخدمة وجدول التسليمات" }).click();
    await ex.poll(async () => (await sql("select 1 from service_terms where request_id = $1", [id])).length).toBe(1);

    // a cycle for a meeting: no output to draft, nothing to "send"
    await go(admin, `/admin/requests/${id}#service`);
    await admin.locator('input[name="label"]').fill("الاجتماع الدوري الثاني (اختبار آلي)");
    await admin.locator('input[name="eventOn"]').fill("2026-06-15");
    await admin.getByRole("button", { name: "افتح دورة للحدث" }).click();
    await ex.poll(async () => (await cycles(id)).length).toBe(1);
    const [c1] = await cycles(id);
    expect(c1.output_key).toBeNull();
    await go(admin, `/admin/requests/${id}#service`);
    const panel = admin.getByTestId("cycle-1");
    await ex(panel).toContainText("متابعة بلا مستند");
    await ex(panel.getByRole("button", { name: /أرسل التسليم/ })).toHaveCount(0);
    await tickAll(admin, id, 1);
    // closing without the meeting linked is refused
    await go(admin, `/admin/requests/${id}#service`);
    await admin.getByTestId("cycle-1").locator('textarea[name="note"]').fill("حضر العضو المستقل وسجل تحفظه على البند الثالث (اختبار آلي).");
    await admin.getByTestId("cycle-1").getByRole("button", { name: /أقفل الدورة/ }).click();
    await ex(admin.getByTestId("cycle-1").getByRole("alert")).toContainText("اجتماع المجلس المرتبط");
    expect((await cycles(id))[0].status).toBe("open");
    const [m] = await sql<{ id: string }>("select id from meetings where waqf_id = $1 order by scheduled_at desc limit 1", [demo().waqfs.C]);
    await go(admin, `/admin/requests/${id}#service`);
    await admin.getByTestId("cycle-1").locator('select[name="meetingId"]').selectOption(m.id);
    await admin.getByTestId("cycle-1").getByRole("button", { name: "اربط الاجتماع" }).click();
    await ex.poll(async () => (await sql("select 1 from service_cycles where request_id = $1 and meeting_id = $2", [id, m.id])).length).toBe(1);
    await go(admin, `/admin/requests/${id}#service`);
    await admin.getByTestId("cycle-1").locator('textarea[name="note"]').fill("حضر العضو المستقل وسجل تحفظه على البند الثالث (اختبار آلي).");
    await admin.getByTestId("cycle-1").getByRole("button", { name: /أقفل الدورة/ }).click();
    await ex.poll(async () => (await cycles(id))[0].status).toBe("closed");
    expect(await status(id)).toBe("in_progress");
    expect(await sql("select 1 from outputs where request_id = $1", [id])).toHaveLength(0);
    // the portfolio lists it
    await go(admin, "/admin/continuous");
    await ex(admin.getByTestId("continuous-portfolio")).toContainText("N02");
    await admin.screenshot({ path: `${shots}/continuous-portfolio.png`, fullPage: true });
    await sql("update service_requests set status = 'cancelled' where id = $1", [id]);
  });
});
