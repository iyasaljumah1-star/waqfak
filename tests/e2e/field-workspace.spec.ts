import "dotenv/config";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * Unified request page, end to end on real records:
 *  1. the board chair requests G09 (board and nazir performance evaluation) for waqf C — the waqf-file records are shown with
 *     source and date, not asked again; only the evaluation's own questions are asked;
 *  2. submission creates tasks only for waqf-file records that are missing or out of date;
 *  3. the team sees every answer with its origin, the analysis under it, and acts per field: approve (only that field),
 *     edit (original kept, reason, back to review), internal and client notes, a task, a completion request;
 *  4. the client answers the completion request → the field itself is updated and returns to review; the client sees
 *     the team's correction with its reason and earlier value, and never the internal note;
 *  5. permissions: the client has no field actions; an outsider cannot open either page; the database refuses a
 *     field decision written as the client.
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
test.afterAll(async () => { await pool?.end(); pool = null; });

async function as(browser: Browser, key: string, viewport: { width: number; height: number } | null): Promise<Page> {
  const ctx = await browser.newContext({ viewport: viewport ?? undefined, locale: "ar-SA", timezoneId: "Asia/Riyadh" });
  const page = await ctx.newPage();
  await loginAs(page, key);
  return page;
}

test.describe.configure({ mode: "serial" });

let reqId = "";
/** The request created by the first test (looked up again in a fresh worker, e.g. the mobile run). */
async function findReq() {
  if (reqId) return reqId;
  const [r] = await sql<{ id: string }>("select sr.id from service_requests sr join services s on s.id = sr.service_id where s.code = 'G09' and sr.waqf_id = $1 and sr.requester_user_id = $2 and sr.status not in ('draft','cancelled') order by sr.created_at desc limit 1", [demo().waqfs.C, demo().users.chair.id]);
  reqId = r?.id ?? "";
  return reqId;
}

test("the board chair requests G09 for waqf C: waqf records are shown with their source, only the evaluation is asked", async ({ browser, viewport }, info) => {
  test.skip(info.project.name !== "desktop", "the request is created once; the mobile run checks the pages below");
  const C = demo().waqfs.C;
  await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [demo().users.chair.id]);
  await sql("update service_requests sr set status = 'cancelled' from services s where s.id = sr.service_id and s.code = 'G09' and sr.waqf_id = $1 and sr.status not in ('closed','cancelled','rejected')", [C]);
  const page = await as(browser, "chair", viewport);
  await page.goto(`/app/requests/new?service=G09&waqf=${C}`);
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
  reqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];

  await page.getByRole("radio", { name: "عضو مجلس النظارة" }).check();
  await page.getByRole("button", { name: "التالي" }).click();

  // the waqf-file step: records with source, date and status — confirmed, not re-entered
  await ex(page.getByRole("heading", { name: "بيانات الوقف المسجلة" })).toBeVisible();
  const blocks = page.getByTestId("context-blocks").locator("section[data-status]");
  await ex(blocks.first()).toBeVisible();
  expect(await blocks.count()).toBeGreaterThanOrEqual(5);
  await ex(page.getByText("سجل مجلس النظارة في ملف الوقف").first()).toBeVisible();
  await page.getByRole("radio", { name: "نعم، صحيحة ومحدّثة" }).check();
  await page.getByRole("button", { name: "التالي" }).click();

  // the evaluation's own questions; no question about board members or meetings (they come from the file)
  await ex(page.getByRole("heading", { name: "نطاق التقييم" })).toBeVisible();
  await ex(page.getByLabel(/عدد أعضاء المجلس/)).toHaveCount(0);
  await page.getByRole("checkbox", { name: "مجلس النظارة مجتمعًا" }).check();
  await page.getByLabel(/بداية الفترة محل الخدمة/).fill("2025-01-01");
  await page.getByLabel(/نهاية الفترة/).fill("2025-12-31");
  await page.getByRole("button", { name: "التالي" }).click();

  await ex(page.getByRole("heading", { name: "الأهداف والمؤشرات" })).toBeVisible();
  await page.getByRole("group", { name: /هل للوقف خطة معتمدة/ }).getByRole("radio", { name: "لا" }).check();
  await page.getByRole("radio", { name: "لا تُقاس مؤشرات" }).check();
  await page.getByRole("button", { name: "التالي" }).click();

  await ex(page.getByRole("heading", { name: "معايير التقييم" })).toBeVisible();
  await page.getByRole("checkbox", { name: "الأهلية والقدرة والكفاءة" }).check();
  await page.getByRole("checkbox", { name: "رشد القرارات واستنادها إلى المعلومات" }).check();
  await page.getByRole("radio", { name: "أوزان متساوية" }).check();
  await page.getByRole("checkbox", { name: "مراجعة السجلات والمستندات" }).check();
  await page.getByRole("button", { name: "التالي" }).click();

  await ex(page.getByRole("heading", { name: "الملاحظات والمخرجات" })).toBeVisible();
  await page.getByRole("checkbox", { name: "تقرير التقييم" }).check();
  for (let i = 0; i < 4 && !(await page.getByRole("button", { name: "أرسل الطلب" }).isVisible()); i++) await page.getByRole("button", { name: "التالي" }).click();
  await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?created=1/);

  // stored answers: the evaluation only, no copy of the board records
  const [row] = await sql<{ intake: { answers: Record<string, unknown> } }>("select intake from service_requests where id = $1", [reqId]);
  expect(row.intake.answers.hasPlan).toBe("no");
  expect(row.intake.answers.dataReview).toBe("confirmed");
  expect(row.intake.answers.boardSize).toBeUndefined();

  // tasks only for missing or stale waqf-file records, each tied to its record
  const t = await sql<{ field_key: string; title: string }>("select field_key, title from tasks where request_id = $1 and field_key is not null", [reqId]);
  for (const x of t) {
    expect(x.field_key).toMatch(/^ctx:/);
    expect(x.title).toMatch(/^(استكمال|تحديث) «/);
  }
  await page.context().close();
});

test("the team works field by field on the unified request page", async ({ browser, viewport }, info) => {
  test.skip(info.project.name !== "desktop" || !reqId, "runs once on the request created above");
  const page = await as(browser, "ops", viewport);
  await page.goto(`/admin/requests/${reqId}#intake`);

  // header: phase, completeness; summary of the data
  await ex(page.getByTestId("summary-phase")).toBeVisible();
  await ex(page.getByTestId("summary-completeness")).toBeVisible();
  await ex(page.getByTestId("field-summary")).toBeVisible();

  // origin and analysis under the answer; the waqf-file blocks with their own state, gap tasks listed beside them
  const plan = page.getByTestId("field-hasPlan");
  await ex(plan.getByTestId("field-origin")).toHaveText("أدخله العميل");
  await ex(plan.getByTestId("insights")).toContainText("G04");
  const t = await sql<{ field_key: string }>("select field_key from tasks where request_id = $1 and field_key like 'ctx:%'", [reqId]);
  if (t.length) await ex(page.locator(`[id="f-${t[0].field_key}"]`).getByTestId("field-task").first()).toBeVisible();

  // approve one field: only that one is approved
  await page.getByTestId("fa-hasPlan-approve").click();
  await page.getByTestId("approve-hasPlan").getByRole("button", { name: "اعتمد الحقل" }).click();
  await ex(plan.getByTestId("field-state")).toHaveAttribute("data-state", "approved");
  await ex(page.getByTestId("field-kpisRecorded").getByTestId("field-state")).toHaveAttribute("data-state", "pending");
  const states = await sql<{ field_key: string; status: string }>("select field_key, status from request_field_states where request_id = $1", [reqId]);
  expect(states).toEqual([{ field_key: "hasPlan", status: "approved" }]);

  // edit another field: original kept with reason and editor, back to review, not approved by the edit
  const kpis = page.getByTestId("field-kpisRecorded");
  await page.getByTestId("fa-kpisRecorded-edit").click();
  const edit = page.getByTestId("edit-kpisRecorded");
  await edit.getByRole("radio", { name: "بعضها، دون تقرير منتظم" }).check();
  await edit.getByLabel("سبب التعديل ومصدره").fill("أفاد الناظر هاتفيًا بقياس مؤشري الإشغال والتحصيل (اختبار آلي)");
  await edit.getByRole("button", { name: "احفظ التعديل" }).click();
  await ex(kpis.getByTestId("field-origin")).toHaveText("صحّحه الفريق");
  await ex(kpis.getByTestId("field-state")).toHaveAttribute("data-state", "needs_review");
  await ex(kpis.getByTestId("insights")).toContainText("القيمة الأصلية: لا تُقاس مؤشرات");
  const [rev] = await sql<{ before: Record<string, unknown>; after: Record<string, unknown>; reason: string }>("select before, after, reason from request_revisions where request_id = $1 and target = 'kpisRecorded' order by at desc limit 1", [reqId]);
  expect(rev.before.kpisRecorded).toBe("none");
  expect(rev.after.kpisRecorded).toBe("partial");
  expect(rev.reason).toContain("اختبار آلي");
  const [aud] = await sql<{ before: unknown; after: unknown }>("select before, after from audit_logs where entity_id = $1 and action = 'requests.intake_edit' order by at desc limit 1", [reqId]);
  expect(JSON.stringify(aud?.before ?? {})).toContain("none");

  // internal note (team only) and a client note on the same field
  await page.getByTestId("fa-kpisRecorded-internal").click();
  await kpis.getByRole("textbox").first().fill("ملاحظة داخلية: نتحقق من تقرير الإشغال (اختبار آلي)");
  await kpis.getByRole("button", { name: /أرسل|احفظ|أضف/ }).first().click();
  await ex(kpis.getByTestId("field-note").filter({ hasText: "ملاحظة داخلية: نتحقق" })).toBeVisible();
  await page.getByTestId("fa-kpisRecorded-client").click();
  await kpis.getByRole("textbox").first().fill("صحّحنا الإجابة وفق اتصالكم؛ أرفقوا ما يتوفر من قياس (اختبار آلي)");
  await kpis.getByRole("button", { name: /أرسل|احفظ|أضف/ }).first().click();
  await ex(kpis.getByTestId("field-note").filter({ hasText: "صحّحنا الإجابة" })).toBeVisible();

  // a task tied to the field
  await page.getByTestId("fa-kpisRecorded-task").click();
  await page.getByTestId("task-kpisRecorded").getByRole("button", { name: "أنشئ المهمة" }).click();
  await ex(kpis.getByTestId("field-task")).toBeVisible();

  // a completion request on a field the client left empty
  const issues = page.getByTestId("field-knownIssues");
  await page.getByTestId("fa-knownIssues-complete").click();
  await page.getByTestId("complete-knownIssues").getByRole("button", { name: "أرسل طلب الاستكمال" }).click();
  await ex(page.getByTestId("complete-knownIssues")).toHaveCount(0, { timeout: 15_000 }).catch(() => undefined);
  const items = await sql<{ field_key: string; status: string }>("select field_key, status from request_items where request_id = $1", [reqId]);
  expect(items.some((x) => x.field_key === "knownIssues" && x.status === "open")).toBe(true);
  await ex(issues).toBeVisible();
  await page.context().close();
});

test("the client completes the field, sees the team's correction with its reason, never the internal note", async ({ browser, viewport }, info) => {
  test.skip(info.project.name !== "desktop" || !reqId, "runs once on the request created above");
  const page = await as(browser, "chair", viewport);
  await page.goto(`/app/requests/${reqId}`);
  await ex(page.getByTestId("client-phase")).toBeVisible();
  await ex(page.getByTestId("fa-hasPlan-approve")).toHaveCount(0); // no team actions for the client

  const [item] = await sql<{ id: string; seq: number }>("select id, seq from request_items where request_id = $1 and field_key = 'knownIssues' and status = 'open'", [reqId]);
  const form = page.getByTestId(`answer-${item.id}`);
  await form.getByLabel("ردك").fill("تأخر تنفيذ قرارات الصيانة في الربع الثالث (اختبار آلي)");
  await form.getByRole("button", { name: "أرسل الرد" }).click();
  // the answer is applied to the field itself (the form closes once the item is answered)
  await ex.poll(async () => (await sql<{ intake: { answers: Record<string, unknown> } }>("select intake from service_requests where id = $1", [reqId]))[0].intake.answers.knownIssues, { timeout: 20_000 })
    .toBe("تأخر تنفيذ قرارات الصيانة في الربع الثالث (اختبار آلي)");
  const [st] = await sql<{ status: string }>("select status from request_field_states where request_id = $1 and field_key = 'knownIssues'", [reqId]);
  expect(st.status).toBe("needs_review");

  await page.reload();
  const kpis = page.getByTestId("cfield-kpisRecorded");
  await ex(kpis.getByTestId("cfield-revision")).toContainText("فريق وقفك");
  await ex(kpis.getByTestId("cfield-revision")).toContainText("اختبار آلي");
  await ex(kpis.getByTestId("cfield-revision")).toContainText("لا تُقاس مؤشرات");
  await ex(kpis.getByTestId("cfield-note")).toContainText("صحّحنا الإجابة");
  await ex(page.getByText("ملاحظة داخلية: نتحقق")).toHaveCount(0);
  await ex(page.getByTestId("cfield-hasPlan").getByTestId("cfield-approved")).toBeVisible();
  await ex(page.getByTestId("cfield-knownIssues").getByTestId("cfield-revision")).toContainText("ردًا على طلب استكمال");
  await page.context().close();

  // the team sees the completion on the field, back in review
  const staff = await as(browser, "ops", viewport);
  await staff.goto(`/admin/requests/${reqId}#intake`);
  const issues = staff.getByTestId("field-knownIssues");
  await ex(issues.getByTestId("field-origin")).toHaveText("استكمله العميل");
  await ex(issues.getByTestId("field-value")).toContainText("تأخر تنفيذ قرارات الصيانة");
  await ex(issues.getByTestId("field-state")).toHaveAttribute("data-state", "needs_review");
  await staff.context().close();
});

test("permissions: outsiders are refused; a field decision cannot be written as the client", async ({ browser, viewport }) => {
  test.skip(!(await findReq()), "needs the request created above");
  const page = await as(browser, "outsider", viewport);
  const a = await page.goto(`/admin/requests/${reqId}`);
  expect(page.url().includes(`/admin/requests/${reqId}`) ? a?.status() : 403).not.toBe(200);
  await page.goto(`/app/requests/${reqId}`);
  await ex(page.getByTestId("client-fields")).toHaveCount(0);
  await page.context().close();

  // the database itself refuses a field decision from a non-staff user (RLS), whatever the server code does
  pool ??= new pg.Pool({ connectionString: process.env.DATABASE_URL, max: 2 });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.user_id', $1, true), set_config('app.global_access', 'off', true)", [demo().users.chair.id]);
    const err = await c.query("insert into request_field_states (request_id, waqf_id, field_key, status) values ($1, $2, 'scope', 'approved')", [reqId, demo().waqfs.C]).then(() => null, (e: Error) => e);
    expect(err).not.toBeNull();
  } finally {
    await c.query("rollback").catch(() => undefined);
    c.release();
  }
});

test("mobile and desktop: the unified page reads in RTL with collapsible sections and filters", async ({ browser, viewport }) => {
  test.skip(!(await findReq()), "needs the request created above");
  const page = await as(browser, "ops", viewport);
  await page.goto(`/admin/requests/${reqId}#intake`);
  await ex(page.locator("html")).toHaveAttribute("dir", "rtl");
  await ex(page.getByTestId("field-filter")).toBeVisible();
  await page.getByRole("searchbox", { name: "ابحث في حقول الطلب" }).fill("مؤشرات");
  await ex(page.getByTestId("field-kpisRecorded")).toBeVisible();
  await ex(page.getByTestId("field-evaluatee")).toBeHidden();
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(1);
  await page.context().close();
});
