import "dotenv/config";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * The two request paths, end to end on real records (the registered-waqf path — G09 on waqf C with its file's data — is
 * covered by field-workspace.spec):
 *  - a client with no registered waqf asks G09 for a waqf outside the platform: the service's own questions about the
 *    waqf (board, minutes, deed…), saved as a draft and resumed, kept in the request only (no waqf record);
 *  - completeness: what blocks sending, what work cannot start without (the request is sent anyway), what only helps;
 *  - the team sees the path and the client's data on the unified page; work cannot start while start-level items are
 *    missing; a completion request is answered on the field itself;
 *  - «no waqf yet» only where the service allows it (T05 asset by type); not offered for G09; N01 needs a registered waqf;
 *  - another client cannot open the request; registering the waqf later is a separate step, refused as a duplicate
 *    when the deed is already on record, and leaves the request as it was.
 */

const ex = expect;
let pool: pg.Pool | null = null;
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const c = await pool.connect();
  try {
    await c.query("select set_config('app.global_access', 'on', false)");
    return (await c.query(q, params)).rows as T[];
  } finally {
    await c.query("select set_config('app.global_access', 'off', false)").catch(() => undefined);
    c.release();
  }
}

async function as(browser: Browser, key: string, viewport: { width: number; height: number } | null): Promise<Page> {
  const ctx = await browser.newContext({ viewport: viewport ?? undefined, locale: "ar-SA", timezoneId: "Asia/Riyadh" });
  const page = await ctx.newPage();
  await loginAs(page, key);
  return page;
}
const next = (p: Page) => p.getByRole("button", { name: "التالي" }).click();
const group = (p: Page, name: RegExp) => p.getByRole("group", { name });
const act = (p: Page, name: string) => p.getByRole("button", { name, exact: true }).first().click();

test.describe.configure({ mode: "serial" });
test.setTimeout(240_000);

const created: string[] = [];
let reqId = "";
let reqNumber = "";

test.beforeAll(async () => {
  const u = demo().users.outsider.id;
  await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [u]);
});
test.afterAll(async () => {
  for (const w of created) {
    for (const t of ["waqf_memberships", "waqf_keys", "waqf_timeline_events", "obligation_instances"]) await sql(`delete from ${t} where waqf_id = $1`, [w]);
    await sql("delete from waqfs where id = $1", [w]);
  }
  await pool?.end();
  pool = null;
});

test("unregistered waqf: G09 asks the waqf's data the service needs, keeps it in the request, and resumes the draft", async ({ browser, viewport }) => {
  const page = await as(browser, "outsider", viewport);
  // N01 runs on the waqf's file in the platform: without a registered waqf it cannot be requested, and the page says why
  if (!(await sql("select 1 from waqf_memberships where user_id = $1 and status = 'active'", [demo().users.outsider.id])).length) {
    await page.goto("/app/requests/new?service=N01");
    await ex(page.getByText("هذه الخدمة تحتاج وقفًا مسجلًا في المنصة")).toBeVisible();
    await ex(page.getByRole("button", { name: "ابدأ نموذج الطلب" })).toHaveCount(0);
  }
  await page.goto("/app/requests/new?service=G09");
  const modes = page.getByTestId("waqf-mode");
  // G09 concerns an existing waqf: «no waqf yet» is not offered, and the page says why
  await ex(modes.getByRole("radio", { name: /لا يوجد لدي وقف قائم/ })).toHaveCount(0);
  await ex(page.getByTestId("waqf-mode-note")).toContainText("وقف قائم");
  await modes.getByRole("radio", { name: /وقف مسجل في منصة/ }).check();
  await ex(page.getByTestId("no-registered-waqf")).toBeVisible(); // the outsider has no registered waqf
  await modes.getByRole("radio", { name: /غير مسجل في منصة/ }).check();
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
  reqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];

  await page.getByRole("radio", { name: "عضو مجلس النظارة" }).check();
  await next(page);
  await ex(page.getByRole("heading", { name: "بيانات الوقف", exact: true })).toBeVisible();
  await ex(page.getByRole("heading", { name: "بيانات الوقف المسجلة" })).toHaveCount(0);
  await page.getByLabel(/اسم الوقف أو الاسم المتعارف عليه/).fill("وقف السلام الخيري (اختبار آلي)");
  await group(page, /^نوع الوقف/).getByRole("radio", { name: "خيري (عام)" }).check();
  await group(page, /^حالة الوقف/).getByRole("radio", { name: "موثّق بصك ولم يُسجَّل لدى الهيئة" }).check();
  await page.getByLabel(/^مقر الوقف/).selectOption("sa");
  await group(page, /هل لدى الوقف صك/).getByRole("radio", { name: "نعم" }).check();
  await ex(page.getByLabel(/رقم الصك أو الوثيقة/)).toBeVisible(); // shown because there is a deed; left for later
  await group(page, /من يتولى نظارة الوقف/).getByRole("radio", { name: "مجلس نظارة" }).check();
  await page.getByLabel(/عدد أعضاء المجلس/).fill("5");
  await group(page, /محاضر الاجتماعات والقرارات/).getByRole("radio", { name: "بعضها" }).check();
  await next(page);
  await ex(page.getByRole("heading", { name: "نطاق التقييم" })).toBeVisible();

  // saved on the server: reload, and opening the service again resumes the same draft
  const [d] = await sql<{ intake: { waqfMode: string; answers: Record<string, unknown> }; waqf_id: string | null }>("select intake, waqf_id from service_requests where id = $1", [reqId]);
  expect(d.waqf_id).toBeNull();
  expect(d.intake.waqfMode).toBe("unregistered");
  expect(d.intake.answers.uwName).toBe("وقف السلام الخيري (اختبار آلي)");
  expect(d.intake.answers.uwBoardSize).toBe("5");
  await page.goto("/app/requests/new?service=G09");
  await ex(page.getByText("لديك مسودة لهذه الخدمة")).toBeVisible();
  await page.getByTestId("waqf-mode").getByRole("radio", { name: /غير مسجل في منصة/ }).check();
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(new RegExp(`/app/requests/${reqId}/intake$`));
  await page.getByRole("button", { name: /\. بيانات الوقف$/ }).click();
  await ex(page.getByLabel(/اسم الوقف أو الاسم المتعارف عليه/)).toHaveValue("وقف السلام الخيري (اختبار آلي)");
  await page.getByRole("button", { name: /\. نطاق التقييم$/ }).click();

  await page.getByRole("checkbox", { name: "مجلس النظارة مجتمعًا" }).check();
  await page.getByLabel(/بداية الفترة محل الخدمة/).fill("2025-01-01");
  await page.getByLabel(/نهاية الفترة/).fill("2025-12-31");
  await next(page);
  await group(page, /هل للوقف خطة معتمدة/).getByRole("radio", { name: "لا" }).check();
  await page.getByRole("radio", { name: "لا تُقاس مؤشرات" }).check();
  await next(page);
  await page.getByRole("checkbox", { name: "الأهلية والقدرة والكفاءة" }).check();
  await page.getByRole("radio", { name: "أوزان متساوية" }).check();
  await page.getByRole("checkbox", { name: "مراجعة السجلات والمستندات" }).check();
  await next(page);
  await page.getByRole("checkbox", { name: "تقرير التقييم" }).check();
  for (let i = 0; i < 4 && !(await page.getByRole("button", { name: "أرسل الطلب" }).isVisible()); i++) await next(page);

  // completeness before sending: nothing blocks sending; the deed number and the deed are needed before work starts
  await ex(page.getByText("البيانات والمستندات المطلوبة مكتملة.")).toBeVisible();
  await ex(page.getByTestId("needs-start")).toContainText("رقم الصك أو الوثيقة");
  await ex(page.getByTestId("needs-start")).toContainText("صك الوقف أو وثيقته");
  const pct = Number((await page.getByTestId("needs-percent").innerText()).replace(/\D/g, ""));
  expect(pct).toBeGreaterThan(0);
  expect(pct).toBeLessThan(100);
  await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await page.waitForURL(/\?created=1/, { timeout: 30_000 });
  reqNumber = (await page.locator("header [dir=ltr].tabular").first().innerText()).trim();

  // the request is about a waqf outside the platform: no waqf record was created from it
  const [r] = await sql<{ status: string; waqf_id: string | null }>("select status, waqf_id from service_requests where id = $1", [reqId]);
  expect(r).toEqual({ status: "submitted", waqf_id: null });
  expect(await sql("select 1 from waqfs where name = $1", ["وقف السلام الخيري (اختبار آلي)"])).toHaveLength(0);
  await ex(page.getByTestId("client-waqf-mode")).toHaveAttribute("data-mode", "unregistered");
  await ex(page.getByTestId("client-start-needs")).toContainText("رقم الصك أو الوثيقة");
  await page.context().close();
});

test("the team sees the path and the client's data; work does not start before the start-level items", async ({ browser, viewport }, info) => {
  test.skip(info.project.name !== "desktop", "staff workflow once; the client pages are checked on both");
  const admin = await as(browser, "admin", viewport);
  await admin.goto(`/admin/requests/${reqId}#intake`);
  await ex(admin.getByTestId("summary-waqf-mode")).toHaveAttribute("data-mode", "unregistered");
  await ex(admin.getByTestId("ws-waqf-mode")).toContainText("قدّمها العميل ضمن هذا الطلب");
  const name = admin.getByTestId("field-uwName");
  await ex(name.getByTestId("field-value")).toHaveText("وقف السلام الخيري (اختبار آلي)");
  await ex(name.getByTestId("insights")).toContainText("وقف غير مسجل في المنصة");
  await ex(admin.getByTestId("field-uwDeedNo").getByTestId("insights")).toContainText("لازم قبل بدء التنفيذ");
  await ex(admin.getByTestId("ws-start-needs")).toContainText("صك الوقف أو وثيقته");

  // accept, then try to start: refused with what is missing
  await act(admin, "بدء الفرز");
  await ex(admin.getByRole("button", { name: "تحققت من البيانات والمستندات", exact: true })).toBeVisible();
  await act(admin, "تحققت من البيانات والمستندات");
  await ex(admin.getByRole("button", { name: "اقبل الطلب للخدمة", exact: true })).toBeVisible();
  await act(admin, "اقبل الطلب للخدمة");
  await ex(admin.getByRole("button", { name: "بدء التنفيذ", exact: true })).toBeVisible();
  await act(admin, "بدء التنفيذ");
  await ex(admin.getByText(/لا يبدأ التنفيذ قبل استكمال ما تحتاجه الخدمة/).first()).toBeVisible();
  expect((await sql<{ status: string }>("select status from service_requests where id = $1", [reqId]))[0].status).not.toBe("in_progress");

  // a completion request on the deed number
  await admin.goto(`/admin/requests/${reqId}#intake`);
  await admin.getByTestId("fa-uwDeedNo-complete").click();
  await admin.getByTestId("complete-uwDeedNo").getByRole("button", { name: "أرسل طلب الاستكمال" }).click();
  await ex.poll(async () => (await sql("select 1 from request_items where request_id = $1 and field_key = 'uwDeedNo' and status = 'open'", [reqId])).length).toBe(1);
  await admin.context().close();
});

test("the client answers on the field itself; another client cannot open the request", async ({ browser, viewport }, info) => {
  test.skip(info.project.name !== "desktop", "follows the staff step");
  const page = await as(browser, "outsider", viewport);
  await page.goto(`/app/requests/${reqId}`);
  const [item] = await sql<{ id: string }>("select id from request_items where request_id = $1 and field_key = 'uwDeedNo' and status = 'open'", [reqId]);
  const form = page.getByTestId(`answer-${item.id}`);
  await form.getByLabel("ردك").fill("4310 52 1 (اختبار آلي)");
  await form.getByRole("button", { name: "أرسل الرد" }).click();
  await ex.poll(async () => (await sql<{ intake: { answers: Record<string, unknown> } }>("select intake from service_requests where id = $1", [reqId]))[0].intake.answers.uwDeedNo, { timeout: 20_000 }).toBe("4310 52 1 (اختبار آلي)");
  expect((await sql<{ status: string }>("select status from request_field_states where request_id = $1 and field_key = 'uwDeedNo'", [reqId]))[0].status).toBe("needs_review");
  await page.reload();
  await ex(page.getByTestId("client-start-needs")).not.toContainText("رقم الصك أو الوثيقة");
  await ex(page.getByTestId("client-start-needs")).toContainText("صك الوقف أو وثيقته");
  await page.context().close();

  const other = await as(browser, "nazir", viewport);
  await other.goto(`/app/requests/${reqId}`);
  await ex(other.getByTestId("client-fields")).toHaveCount(0);
  await ex(other.getByText("وقف السلام الخيري (اختبار آلي)")).toHaveCount(0);
  await other.context().close();
});

test("registering the waqf later is a separate step: a duplicate deed is refused, the request stays as it was", async ({ browser, viewport }, info) => {
  test.skip(info.project.name !== "desktop", "creates a waqf record once");
  const page = await as(browser, "outsider", viewport);
  await page.goto(`/app/requests/${reqId}`);
  await page.getByTestId("register-from-request").getByRole("link", { name: "سجّل الوقف" }).click();
  await page.waitForURL(/\/app\/waqfs\/new\?fromRequest=/);
  await ex(page.getByTestId("register-from-request-note")).toContainText(reqNumber);
  await ex(page.getByLabel("اسم الوقف")).toHaveValue("وقف السلام الخيري (اختبار آلي)");
  await ex(page.getByLabel("نوع الوقف")).toHaveValue("public");
  await ex(page.getByLabel("صيغة النظارة")).toHaveValue("board");
  await page.getByLabel("القيمة التقديرية للأصول").selectOption("lt5");
  await page.getByLabel("صفتك في الوقف").selectOption("board_chair");
  // a deed already on record in the platform (another client's waqf): refused, without saying whose
  const [taken] = await sql<{ deed_no: string }>("select deed_no from waqfs where deed_no is not null and deed_no <> '' limit 1");
  test.skip(!taken, "no waqf with a deed number to compare against");
  await page.getByLabel("رقم الصك").fill(taken.deed_no);
  await page.getByRole("button", { name: /سجّل الوقف|افتح ملف الوقف|احفظ/ }).first().click();
  await ex(page.getByText(/لا يُنشأ ملف مكرر/)).toBeVisible();
  // a deed not on record: the file opens
  const deed = `E2E-UW-${Date.now()}`;
  await page.getByLabel("رقم الصك").fill(deed);
  await page.getByRole("button", { name: /سجّل الوقف|افتح ملف الوقف|احفظ/ }).first().click();
  await page.waitForURL(/\/app\/w\/[0-9a-f-]{36}/, { timeout: 30_000 });
  const wid = page.url().match(/\/app\/w\/([0-9a-f-]{36})/)![1];
  created.push(wid);
  const [w] = await sql<{ deed_no: string }>("select deed_no from waqfs where id = $1", [wid]);
  expect(w.deed_no).toBe(deed);
  // the request is not re-linked or changed silently; the step is recorded on it
  const [r] = await sql<{ waqf_id: string | null; intake: { waqfMode: string; answers: Record<string, unknown> } }>("select waqf_id, intake from service_requests where id = $1", [reqId]);
  expect(r.waqf_id).toBeNull();
  expect(r.intake.waqfMode).toBe("unregistered");
  expect(r.intake.answers.uwName).toBe("وقف السلام الخيري (اختبار آلي)");
  expect(await sql("select 1 from request_events where request_id = $1 and note like 'سجّل مقدم الطلب الوقف في المنصة%'", [reqId])).toHaveLength(1);
  await page.context().close();
});

test("no waqf yet: T05 is offered without a waqf and asks by asset type", async ({ browser, viewport }) => {
  const page = await as(browser, "outsider", viewport);
  await sql("update service_requests sr set status = 'cancelled' from services s where s.id = sr.service_id and s.code = 'T05' and sr.requester_user_id = $1 and sr.status = 'draft'", [demo().users.outsider.id]);
  await page.goto("/app/requests/new?service=T05");
  await page.getByTestId("waqf-mode").getByRole("radio", { name: /لا يوجد لدي وقف قائم/ }).check();
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
  const id = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
  await page.getByRole("radio", { name: "الواقف أو من يريد إنشاء الوقف" }).check();
  await next(page);
  await ex(page.getByRole("heading", { name: "الأصل المراد وقفه" })).toBeVisible();
  await page.getByRole("radio", { name: "أسهم أو وحدات صناديق أو محفظة" }).check();
  await ex(page.getByLabel(/^المدينة/)).toHaveCount(0); // real-estate questions do not apply
  await page.getByLabel(/نوع الأوراق المالية/).selectOption("listed");
  await page.getByLabel(/الشركة أو الصندوق أو مدير المحفظة/).fill("شركة تجريبية مدرجة (اختبار آلي)");
  await group(page, /^الملكية الحالية/).getByRole("radio", { name: "لا أعرف" }).check();
  await group(page, /صاحب الصفة في التصرف/).getByRole("radio", { name: "أنا", exact: true }).check();
  await page.getByRole("checkbox", { name: "لا يوجد" }).check();
  await next(page);
  await page.getByLabel(/الغرض من الوقف والأهداف/).fill("وقف ريع الأسهم على طلاب العلم (اختبار آلي)");
  await group(page, /^مدة الوقف/).getByRole("radio", { name: "مؤبد" }).check();
  await page.getByLabel(/الحجم المتوقع للوقف/).selectOption("small");
  await page.getByLabel(/نوع الموقوف عليهم/).selectOption("general");
  for (let i = 0; i < 4 && !(await page.getByRole("button", { name: "أرسل الطلب" }).isVisible()); i++) await next(page);
  // «لا أعرف» lets the request go, and is listed as needed before work starts
  await ex(page.getByTestId("needs-start")).toContainText("الملكية الحالية");
  await ex(page.getByTestId("needs-specialist")).toContainText("صاحب الصفة في التصرف");
  await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await page.waitForURL(/\?created=1/, { timeout: 30_000 });
  const [r] = await sql<{ waqf_id: string | null; intake: { waqfMode: string; answers: Record<string, unknown> } }>("select waqf_id, intake from service_requests where id = $1", [id]);
  expect(r.waqf_id).toBeNull();
  expect(r.intake.waqfMode).toBe("none");
  expect(r.intake.answers.securityKind).toBe("listed");
  expect(r.intake.answers.propertyCity).toBeUndefined();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.context().close();
});
