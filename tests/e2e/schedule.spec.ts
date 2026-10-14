import { execSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * Payment schedule and cadence (owner's order on the open items, 15 Oct 2026), synthetic data only:
 *  1. a quote with three installments due differently (on signing, on a set date, on a milestone) and a delivery
 *     cadence → shown to the client before acceptance → contract → the schedule tied to the executed contract;
 *  2. an installment falls due with no invoice: the finance team is alerted (in-app), no invoice is created; a
 *     changed due date is kept in the installment's history and the overdue alert follows;
 *  5. a continuous service with no documented cadence: nothing is scheduled until the contract's cadence is chosen,
 *     the server refuses a term without one, and the dashboard lists it;
 *  7. failure and permission cases: an employee without finance rights cannot change a due date; audit entries exist.
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
  const file = `/tmp/claude-0/e2e-sch-${key}-${demo().users[key].id}.json`;
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
async function advance(page: Page, until: () => Promise<boolean>) {
  for (let i = 0; i < 20 && !(await until()); i++) {
    const nb = page.getByRole("button", { name: "التالي" });
    if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
    await page.waitForTimeout(400);
  }
}
async function signWithOtp(page: Page, phone: string) {
  const norm = `+966${phone.replace(/\D/g, "").replace(/^0/, "")}`;
  await sql("delete from rate_limits where key = $1 or key like 'otp:ip:%'", [`otp:target:${norm}`]);
  await page.getByRole("button", { name: "أرسل رمز التوقيع" }).first().click();
  const code = (await page.getByTestId("demo-otp").innerText()).trim();
  await page.getByLabel("رمز التوقيع").fill(code);
  await page.getByLabel(/قرأت نص العقد كاملًا/).check();
  await page.getByRole("button", { name: "وقّع العقد" }).click();
  await page.waitForURL(/\?signed=1/);
}
const runDailyJob = () => execSync("npx tsx --conditions=react-server scripts/jobs/daily.ts", { stdio: "pipe", timeout: 240_000 }).toString();
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000 + 3 * 3_600_000));

const TEST_COMPANY = {
  nameAr: "شركة وقفك (بيانات اختبار)", legalForm: "شركة ذات مسؤولية محدودة", crNumber: "0000000000", nationalAddress: "عنوان اختبار — الرياض",
  signatoryName: "مفوّض اختبار", signatoryTitle: "المدير العام (اختبار)", iban: "SA0000000000000000000000", bankName: "بنك اختبار",
};

test.describe.serial("payment schedule and contract cadence", () => {
  test.setTimeout(480_000);
  const U = () => demo().users;
  const A = () => demo().waqfs.A;
  let reqId = "";
  let originalCompany = "";

  test.beforeAll(async () => {
    const [row] = await sql<{ value: unknown }>("select value from settings where key = 'company.profile'");
    originalCompany = JSON.stringify(row?.value ?? {});
    await sql("update settings set value = value || $1::jsonb where key = 'company.profile'", [JSON.stringify(TEST_COMPANY)]);
  });
  test.afterAll(async () => {
    await sql("update settings set value = $1::jsonb where key = 'company.profile'", [originalCompany]);
    if (reqId) await sql("update service_requests set assigned_to_user_id = null where id = $1", [reqId]);
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("three installments due differently: quote → client sees the schedule → contract → schedule tied to the contract; due alert without an invoice", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const today = addDays(0);
    const second = addDays(10);

    // the client's request (C06 has no documented cadence)
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=C06&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("عدد المستفيدين").fill("12");
    await client.getByLabel("الدورية").selectOption("semiannual");
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(client, () => confirm.isVisible());
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });

    const admin = await as(browser, "admin");
    await nextStep(admin, reqId, /ابدأ الفرز/);
    await nextStep(admin, reqId, /سجّل التحقق/);
    await nextStep(admin, reqId, /اقبل الطلب/);

    // 1) the quote: three installments with different due dates, and the agreed delivery cadence
    await go(admin, `/admin/requests/${reqId}#quote`);
    const ed = admin.getByTestId("quote-editor");
    await ed.getByLabel("سعر وحدة البند 1").fill("3000");
    await ed.getByLabel("وصف الدفعة 1").fill("عند توقيع العقد");
    await ed.getByLabel("نسبة الدفعة 1").fill("30");
    await ed.getByTestId("term-1").getByRole("checkbox", { name: "شرط للبدء" }).uncheck();
    await ed.getByRole("button", { name: "أضف دفعة" }).click();
    await ed.getByLabel("وصف الدفعة 2").fill("الدفعة الثانية");
    await ed.getByLabel("نسبة الدفعة 2").fill("40");
    await ed.getByLabel("استحقاق الدفعة 2").selectOption("on_date");
    await ed.getByLabel("تاريخ استحقاق الدفعة 2").fill(second);
    await ed.getByRole("button", { name: "أضف دفعة" }).click();
    await ed.getByLabel("وصف الدفعة 3").fill("عند اعتماد خطة التقارير");
    await ed.getByLabel("نسبة الدفعة 3").fill("30");
    await ed.getByLabel("استحقاق الدفعة 3").selectOption("on_milestone");
    await ed.getByLabel("مرحلة الدفعة 3").fill("اعتماد خطة التقارير السنوية");
    await ed.getByLabel("دورية التسليمات").selectOption("semiannual");
    await ex(ed.getByText(`في ${second}`)).toBeVisible(); // live preview with the due date
    await ed.getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex.poll(async () => (await sql("select 1 from quotes where request_id = $1 and status = 'draft'", [reqId])).length).toBe(1);
    const [q] = await sql<{ id: string; payment_terms: { due: string; dueOn?: string; milestone?: string }[]; delivery_schedule: { cadence: string } }>("select id, payment_terms, delivery_schedule from quotes where request_id = $1", [reqId]);
    expect(q.payment_terms.map((t) => t.due)).toEqual(["on_contract", "on_date", "on_milestone"]);
    expect(q.payment_terms[1].dueOn).toBe(second);
    expect(q.payment_terms[2].milestone).toBe("اعتماد خطة التقارير السنوية");
    expect(q.delivery_schedule.cadence).toBe("semiannual");
    expect((await sql("select 1 from audit_logs where action = 'quotes.create' and entity_id = $1 and after ? 'paymentTerms'", [q.id])).length).toBe(1);

    const ops = await as(browser, "ops");
    await go(ops, `/admin/requests/${reqId}#quote`);
    await ops.getByRole("button", { name: "اعتمد العرض" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await go(admin, `/admin/requests/${reqId}#quote`);
    await admin.getByRole("button", { name: "أرسل العرض للعميل" }).click();
    await ex.poll(() => status(reqId)).toBe("quote");

    // the client sees the schedule and the cadence before accepting
    await go(client, `/app/requests/${reqId}#quote`);
    const qs = client.getByTestId("quote-schedule").first();
    await ex(qs).toContainText("عند توقيع العقد");
    await ex(qs).toContainText(`في ${second}`);
    await ex(qs).toContainText("عند اعتماد خطة التقارير السنوية");
    await ex(client.getByTestId("quote-delivery").first()).toContainText("نصف سنوية");
    await client.getByRole("button", { name: "أقبل العرض" }).click();
    await ex.poll(() => status(reqId)).toBe("awaiting_contract");

    // the contract carries the schedule and the cadence
    await go(admin, `/admin/requests/${reqId}#contract`);
    const form = admin.getByTestId("contract-prepare");
    await form.getByLabel(/سند الصفة/).first().fill("صك النظارة رقم 000 (اختبار)");
    await form.getByRole("button", { name: "أعدّ مسودة العقد" }).click();
    await ex.poll(async () => (await sql("select 1 from contracts where request_id = $1", [reqId])).length).toBe(1);
    const [k] = await sql<{ body: string }>("select body from contracts where request_id = $1", [reqId]);
    expect(k.body).toContain(`في ${second}`);
    expect(k.body).toContain("عند اعتماد خطة التقارير السنوية");
    expect(k.body).toContain("دورية التسليمات: نصف سنوية");
    await go(ops, `/admin/requests/${reqId}#contract`);
    await ops.getByRole("button", { name: "اعتمد العقد" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await go(admin, `/admin/requests/${reqId}#contract`);
    await admin.getByRole("button", { name: "أرسل للتوقيع" }).click();
    await ex(admin.getByText("مرسل للتوقيع").first()).toBeVisible();
    expect(await sql("select 1 from payment_schedule where request_id = $1", [reqId])).toHaveLength(0); // no schedule before execution
    await go(client, `/app/requests/${reqId}#contract`);
    await signWithOtp(client, U().nazir.phone);
    await go(ops, `/admin/requests/${reqId}#contract`);
    await signWithOtp(ops, U().ops.phone);

    // the schedule of the executed contract: due dates from the contract; the milestone one awaits its date
    await ex.poll(async () => (await sql("select 1 from payment_schedule where request_id = $1", [reqId])).length).toBe(3);
    const rows = await sql<{ term_key: string; due_on: string | null; due_kind: string; contract_id: string | null; total: string }>(
      "select term_key, to_char(due_on, 'YYYY-MM-DD') as due_on, due_kind, contract_id, total from payment_schedule where request_id = $1 order by term_key", [reqId]);
    expect(rows.map((r) => [r.term_key, r.due_kind, r.due_on])).toEqual([["t1", "on_contract", today], ["t2", "on_date", second], ["t3", "on_milestone", null]]);
    expect(rows.every((r) => !!r.contract_id)).toBe(true);
    expect(rows.reduce((s, r) => s + Number(r.total), 0)).toBeCloseTo(3450, 2);
    await go(client, `/app/requests/${reqId}`);
    const cs = client.getByTestId("payment-schedule");
    await ex(cs).toContainText(second);
    await ex(cs).toContainText("لم تصدر فاتورة بعد");
    await go(admin, `/admin/requests/${reqId}#billing`);
    await ex(admin.getByTestId("section-commerce").getByTestId("payment-schedule")).toContainText("حلّ موعدها ولم تُرسل فاتورتها");
    await admin.screenshot({ path: `${shots}/schedule-request.png`, fullPage: true });

    // 2) the due date arrives with no invoice: finance is alerted, no invoice is created
    const before = await sql<{ n: number }>("select count(*)::int as n from notifications where type = 'billing.installment_due' and user_id = $1", [U().admin.id]);
    runDailyJob();
    const after = await sql<{ n: number }>("select count(*)::int as n from notifications where type = 'billing.installment_due' and user_id = $1", [U().admin.id]);
    expect(after[0].n).toBeGreaterThan(before[0].n);
    const [alerted] = await sql<{ alerts: string[] }>("select alerts from payment_schedule where request_id = $1 and term_key = 't1'", [reqId]);
    expect(alerted.alerts).toContain("due");
    expect(await sql("select 1 from invoices where request_id = $1", [reqId])).toHaveLength(0);
    runDailyJob(); // sent once only
    expect((await sql<{ n: number }>("select count(*)::int as n from notifications where type = 'billing.installment_due' and user_id = $1", [U().admin.id]))[0].n).toBe(after[0].n);
    await go(admin, "/admin/finance?tab=due");
    await ex(admin.getByTestId("due-installments")).toContainText("حلّ موعدها ولم تُرسل فاتورتها");
    await admin.screenshot({ path: `${shots}/schedule-finance.png`, fullPage: true });

    // the milestone is reached late: finance sets its date (kept in history); the overdue alert follows
    await go(admin, `/admin/requests/${reqId}#billing`);
    const row3 = admin.getByTestId("section-commerce").getByTestId("installment-عند اعتماد خطة التقارير");
    await row3.locator("summary", { hasText: "حدّد الموعد" }).click();
    await row3.locator('input[name="dueOn"]').fill(addDays(-2));
    await row3.locator('input[name="reason"]').fill("اعتُمدت خطة التقارير في اجتماع المجلس (اختبار آلي).");
    await row3.getByRole("button", { name: "احفظ الموعد" }).click();
    await ex.poll(async () => (await sql<{ due_on: string | null }>("select to_char(due_on, 'YYYY-MM-DD') as due_on from payment_schedule where request_id = $1 and term_key = 't3'", [reqId]))[0].due_on).toBe(addDays(-2));
    const [h] = await sql<{ history: { kind: string; to: string; by: string }[] }>("select history from payment_schedule where request_id = $1 and term_key = 't3'", [reqId]);
    expect(h.history.at(-1)).toMatchObject({ kind: "due_set", to: addDays(-2), by: U().admin.id });
    runDailyJob();
    const [od] = await sql<{ alerts: string[] }>("select alerts from payment_schedule where request_id = $1 and term_key = 't3'", [reqId]);
    expect(od.alerts).toContain("overdue:1");
    expect(await sql("select 1 from invoices where request_id = $1", [reqId])).toHaveLength(0);

    // 7) an employee without finance rights and not a manager cannot set due dates (server-side refusal)
    await sql("update service_requests set assigned_to_user_id = $1 where id = $2", [U().emp1.id, reqId]);
    const emp = await as(browser, "emp1");
    await go(emp, `/admin/requests/${reqId}#billing`);
    await ex(emp.getByTestId("section-commerce").getByTestId("payment-schedule")).toBeVisible();
    await ex(emp.getByTestId("section-commerce").getByTestId("payment-schedule").locator("summary", { hasText: /الموعد/ })).toHaveCount(0);
    await sql("update service_requests set assigned_to_user_id = null where id = $1", [reqId]);
    expect((await sql("select 1 from audit_logs where action = 'billing.schedule.due_set'")).length).toBeGreaterThan(0);

    // the term takes the cadence agreed in the quote
    await go(admin, `/admin/requests/${reqId}#contract`);
    await admin.getByRole("button", { name: "بدء التنفيذ بعد توقيع العقد" }).click();
    await ex.poll(() => status(reqId)).toBe("in_progress");
    await go(admin, `/admin/requests/${reqId}#service`);
    await ex(admin.locator('select[name="cadence"]')).toHaveValue("semiannual");
    await ex(admin.getByText("من العرض المقبول")).toBeVisible();
    await sql("update service_requests set status = 'cancelled' where id = $1", [reqId]);
  });

  test("no documented cadence: nothing is scheduled until the contract's cadence is set; the server refuses a term without one", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=N03&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    const id = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByRole("radio", { name: "ناظر فرد" }).check();
    await client.getByRole("checkbox", { name: "المالية" }).check();
    await client.getByLabel("دورية اللقاءات").selectOption("monthly");
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(client, () => confirm.isVisible());
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });
    const admin = await as(browser, "admin");
    await nextStep(admin, id, /ابدأ الفرز/);
    await nextStep(admin, id, /سجّل التحقق/);
    await nextStep(admin, id, /اقبل الطلب/);
    await go(admin, `/admin/requests/${id}`);
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => status(id)).toBe("in_progress");

    await go(admin, `/admin/requests/${id}#service`);
    await ex(admin.getByTestId("exec-steps")).toBeVisible();
    await ex(admin.getByTestId("continuous-panel")).toContainText("الدورية غير محددة");
    await ex(admin.locator('select[name="cadence"]')).toHaveValue("");
    // the dashboard lists it; no cycle, no date exists
    await go(admin, "/admin/continuous");
    await ex(admin.getByTestId("unset-cadence-services")).toContainText("N03");
    await ex(admin.getByText(/طلبات قائمة تنتظر تحديد الدورية/)).toBeVisible();
    expect(await sql("select 1 from service_cycles where request_id = $1", [id])).toHaveLength(0);
    expect(await sql("select 1 from service_terms where request_id = $1", [id])).toHaveLength(0);
    // the server refuses a term without a cadence (the browser's own check is bypassed on purpose)
    await go(admin, `/admin/requests/${id}#service`);
    await admin.locator('select[name="cadence"]').evaluate((el) => el.removeAttribute("required"));
    await admin.getByRole("button", { name: "فعّل مدة الخدمة وجدول التسليمات" }).click();
    await ex(admin.getByText(/حدّد دورية التسليم كما في العقد/)).toBeVisible();
    expect(await sql("select 1 from service_terms where request_id = $1", [id])).toHaveLength(0);
    // contractual dates instead of a period: two named deliveries
    await go(admin, `/admin/requests/${id}#service`);
    await admin.locator('input[name="startOn"]').fill(addDays(-30));
    await admin.locator('input[name="endOn"]').fill(addDays(330));
    await admin.locator('select[name="cadence"]').selectOption("custom");
    await admin.locator('textarea[name="customDates"]').fill(`${addDays(20)} | تقرير المساندة الأول\n${addDays(200)} | تقرير المساندة الثاني`);
    await admin.getByRole("button", { name: "فعّل مدة الخدمة وجدول التسليمات" }).click();
    await ex.poll(async () => (await sql("select 1 from service_terms where request_id = $1 and cadence = 'custom'", [id])).length).toBe(1);
    await nextStep(admin, id, /افتح دورة «تقرير المساندة الأول»/);
    const [c] = await sql<{ label: string; due_on: string }>("select label, to_char(due_on, 'YYYY-MM-DD') as due_on from service_cycles where request_id = $1", [id]);
    expect(c).toEqual({ label: "تقرير المساندة الأول", due_on: addDays(20) });
    await sql("update service_requests set status = 'cancelled' where id = $1", [id]);
  });
});
