import "dotenv/config";
import { mkdirSync } from "node:fs";
import { Client } from "pg";
import { expect, test, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

/** Cleanup with the owner connection (removes only rows this spec created). */
async function sql(text: string, params: unknown[] = []) {
  const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.global_access','on',true)");
    const r = await c.query(text, params);
    await c.query("commit");
    return r.rows;
  } finally {
    await c.end();
  }
}

const shotDir = "storage/e2e-screenshots/admin-editors"; // test-results/ is wiped by every Playwright run
async function shot(page: Page, name: string) {
  mkdirSync(shotDir, { recursive: true });
  await page.screenshot({ path: `${shotDir}/${test.info().project.name}-${name}.png`, fullPage: true });
}

/** Fails the test on uncaught page errors (hydration problems, client crashes). */
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  return errors;
}

test.describe.configure({ mode: "serial" });

test("every editor page renders for the super admin", async ({ page }) => {
  test.setTimeout(900_000); // first dev compile of ~35 routes
  const errors = watchErrors(page);
  await loginAs(page, "admin");
  const [ob] = await sql("select id from obligations where code = 'OB-REG-01'");
  const [req] = await sql("select id from regulatory_requirements where code = 'REQ-001'");
  const [ref] = await sql("select id from regulatory_references where code = 'NAZARA-REG'");
  const [pen] = await sql("select id from penalty_schedule order by code limit 1");
  const [svc] = await sql("select id from services where code = 'T03'");
  const [pkg] = await sql("select id from packages where code = 'governance'");
  const [bank] = await sql("select id from question_bank_versions where status = 'published' order by version desc limit 1");
  const [q] = await sql("select id from assessment_questions where bank_version_id = $1 order by position limit 1", [bank.id]);
  const [content] = await sql("select id from content_items where kind = 'regulation' limit 1");
  const [faq] = await sql("select id from faqs limit 1");
  const [term] = await sql("select id from glossary_terms limit 1");
  const pages: [string, RegExp][] = [
    ["/admin/services", /الخدمات والباقات والأسعار/],
    ["/admin/services?tab=packages", /الباقات/],
    ["/admin/services?tab=discounts", /الخصومات/],
    ["/admin/services?tab=workflows", /قوالب سير العمل/],
    [`/admin/services/${svc.id}`, /الأسعار حسب الفئة/],
    ["/admin/services/new", /خدمة جديدة/],
    [`/admin/services/packages/${pkg.id}`, /الخدمات المشمولة/],
    ["/admin/services/discounts/new", /خصم جديد/],
    ["/admin/services/workflows/standard", /المراحل/],
    ["/admin/question-bank", /بنك الأسئلة/],
    [`/admin/question-bank/${bank.id}`, /مجموع أوزان/],
    [`/admin/question-bank/${bank.id}/questions/${q.id}`, /للقراءة فقط/],
    ["/admin/question-bank/flags", /الإشارات الحرجة/],
    ["/admin/question-bank/flags/R01", /المرجع النظامي/],
    ["/admin/rules", /محرك التوصيات/],
    ["/admin/rules/needs", /الاحتياجات/],
    ["/admin/rules/new", /قاعدة توصية جديدة/],
    ["/admin/compliance", /محرك الامتثال/],
    ["/admin/compliance?tab=requirements", /REQ-001/],
    ["/admin/compliance?tab=references", /NAZARA-REG/],
    ["/admin/compliance?tab=penalties", /جدول المخالفات/],
    ["/admin/compliance?tab=log", /سجل التغييرات/],
    [`/admin/compliance/obligations/${ob.id}`, /OB-REG-01/],
    [`/admin/compliance/requirements/${req.id}`, /REQ-001/],
    [`/admin/compliance/references/${ref.id}`, /المتطلبات المستخرجة/],
    [`/admin/compliance/penalties/${pen.id}`, /التزامات تشير إليه/],
    ["/admin/compliance/penalties/new", /بند مخالفة جديد/],
    ["/admin/traceability", /سجل تتبع المتطلبات/],
    ["/admin/traceability?print=1", /طُبع في/],
    ["/admin/content", /المحتوى والمكتبة/],
    [`/admin/content/${content.id}`, /مسار النشر/],
    ["/admin/content/faqs", /الأسئلة الشائعة/],
    [`/admin/content/faqs/${faq.id}`, /تعديل سؤال شائع/],
    ["/admin/content/glossary", /المصطلحات/],
    [`/admin/content/glossary/${term.id}`, /التعريف/],
  ];
  for (const [url, re] of pages) {
    const res = await page.goto(url);
    expect(res?.status(), url).toBeLessThan(400);
    await expect(page.locator("main"), url).toContainText(re);
  }
  expect(errors).toEqual([]);
});

test.describe("scenario 6 — a new obligation applies with no code change", () => {
  const tag = Date.now().toString(36).toUpperCase();
  let reqCode = "";
  let oblCode = "";
  const title = `مراجعة سنوية لسجل المخاطر للأوقاف الكبيرة (اختبار ${tag})`;

  test.afterAll(async () => {
    if (oblCode) {
      await sql("delete from obligation_instances where obligation_id in (select id from obligations where code = $1)", [oblCode]);
      await sql("delete from obligations where code = $1", [oblCode]);
    }
    if (reqCode) await sql("delete from regulatory_requirements where code = $1 and title like '%(اختبار%'", [reqCode]);
  });

  test("admin adds a requirement and an obligation; large waqf C gets it, medium waqf A does not", async ({ page }) => {
    test.setTimeout(240_000);
    const errors = watchErrors(page);
    const d = demo();
    const proj = test.info().project.name.toUpperCase().slice(0, 3);
    oblCode = `OB-E2E-${proj}-${tag}`;
    await loginAs(page, "admin");

    // 1) New regulatory requirement (REQ-xxx suggested automatically).
    await page.goto("/admin/compliance/requirements/new");
    reqCode = await page.getByLabel("الرمز").inputValue();
    expect(reqCode).toMatch(/^REQ-\d{3,}$/);
    await page.getByLabel("المصدر النظامي").selectOption({ label: "NAZARA-REG — لائحة تنظيم أعمال النظارة" });
    await page.getByLabel("المادة").fill("م14/3");
    await page.getByLabel("نص المتطلب").fill(`مراجعة سجل المخاطر سنويًا للأوقاف الكبيرة (اختبار ${tag})`);
    await page.getByRole("button", { name: "أضف بند تنفيذ" }).click();
    await page.getByLabel("النوع").first().selectOption("obligation");
    await page.getByLabel("المرجع").first().fill(oblCode);
    await page.getByLabel("حالة التنفيذ").selectOption("pending_verification");
    await page.getByRole("button", { name: "أنشئ المتطلب" }).click();
    await page.waitForURL(/\/admin\/compliance\/requirements\/[0-9a-f-]{36}\?created=1/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText(reqCode);

    // 2) Invalid JSON-logic is rejected with a clear message (live and on save).
    await page.goto("/admin/compliance/obligations/new");
    await page.locator('input[name="code"]').fill(oblCode);
    await page.getByLabel("عنوان الالتزام").fill(title);
    await page.getByLabel("المرجع (المصدر والمادة)").fill("لائحة تنظيم أعمال النظارة م14/3");
    const reqValue = await page.locator('select[name="requirementId"] option', { hasText: `${reqCode} —` }).getAttribute("value");
    await page.getByLabel("المتطلب النظامي").selectOption(reqValue!);
    await page.getByLabel("الإجراء المطلوب").fill("راجع سجل المخاطر واعتمد التحديث في اجتماع المجلس.");
    const rule = page.locator('textarea[name="rule"]');
    await rule.fill('{"foo": [{"var": "sizeClass"}, "large"]}');
    await expect(page.locator("#rule-status")).toContainText("العامل «foo» غير مدعوم");
    await page.getByRole("button", { name: "احفظ الالتزام وطبّقه" }).click();
    await expect(page.getByRole("alert").first()).toContainText("العامل «foo» غير مدعوم");
    await rule.fill('{"==": [{"var": "sizeClass"}, "large"');
    await expect(page.locator("#rule-status")).toContainText("ليست JSON صالحًا");
    await page.getByRole("button", { name: "احفظ الالتزام وطبّقه" }).click();
    await expect(page.getByRole("alert").first()).toContainText("ليست JSON صالحًا");
    await expect(page).toHaveURL(/\/obligations\/new$/);
    expect(await sql("select 1 from obligations where code = $1", [oblCode])).toHaveLength(0);

    // 3) Valid rule → preview applicability across all waqfs before saving.
    await rule.fill('{"==": [{"var": "sizeClass"}, "large"]}');
    await expect(page.locator("#rule-status")).toContainText("قاعدة صالحة");
    await page.getByRole("button", { name: "عاين الانطباق على الأوقاف" }).click();
    const preview = page.getByRole("region", { name: "معاينة الانطباق" });
    await expect(preview).toBeVisible();
    await expect(preview.locator('[data-testid="preview-row"][data-applies="yes"]', { hasText: "وقف الإحسان الصحي" })).toBeVisible();
    await expect(preview.locator('[data-testid="preview-row"][data-applies="no"]', { hasText: "وقف النور التعليمي" })).toBeVisible();
    await shot(page, "obligation-preview");

    // 4) Save → resync every waqf → "applies now to N waqfs".
    await page.getByRole("button", { name: "احفظ الالتزام وطبّقه" }).click();
    await page.waitForURL(/\/admin\/compliance\/obligations\/[0-9a-f-]{36}\?saved=/, { timeout: 120_000 });
    await expect(page.getByRole("status").filter({ hasText: "ينطبق الآن على" })).toContainText(/ينطبق الآن على [1-9]\d* /);
    const [row] = await sql("select id, applies_to, requirement_id from obligations where code = $1", [oblCode]);
    expect(row.applies_to.rule).toEqual({ "==": [{ var: "sizeClass" }, "large"] });
    expect(row.requirement_id).toBeTruthy();
    const log = await sql("select change from compliance_change_log where entity_id = $1", [row.id]);
    expect(log.length).toBeGreaterThan(0);
    expect(log[0].change.appliesNow).toBeGreaterThanOrEqual(1);
    const audit = await sql("select 1 from audit_logs where action = 'admin.obligation.create' and entity_id = $1", [row.id]);
    expect(audit).toHaveLength(1);
    await shot(page, "obligation-saved");

    // 5) Traceability shows the new requirement → obligation link as active.
    await page.goto(`/admin/traceability?q=${reqCode}`);
    const rtm = page.locator(`[data-testid="rtm-row"][data-req="${reqCode}"]`);
    await expect(rtm).toContainText(oblCode);
    await expect(rtm).toContainText("بانتظار التحقق");
    await shot(page, "traceability");
    const csv = await page.request.get(`/admin/traceability/export?q=${reqCode}`);
    expect(csv.status()).toBe(200);
    expect(csv.headers()["content-type"]).toContain("text/csv");
    expect(await csv.text()).toContain(oblCode);

    // 6) Board chair of C (large) sees it in the waqf compliance page; nazir of A (medium) does not.
    await page.context().clearCookies();
    await loginAs(page, "chair");
    await page.goto(`/app/w/${d.waqfs.C}/compliance?view=all`);
    await expect(page.getByText(title).first()).toBeVisible();
    await shot(page, "waqf-c-compliance");
    await page.context().clearCookies();
    await loginAs(page, "nazir");
    await page.goto(`/app/w/${d.waqfs.A}/compliance?view=all`);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("الامتثال");
    await expect(page.getByText(title)).toHaveCount(0);
    expect(errors).toEqual([]);
  });
});

test("rule test panel evaluates the rule as typed and shows resulting recommendations", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAs(page, "admin");
  await page.goto("/admin/rules/R-FIN-001");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("R-FIN-001");
  const facts = page.getByLabel(/حقائق \(JSON\)/);
  await facts.fill('{"has_bank_account": "no", "size_class": "medium"}');
  await page.getByRole("button", { name: "اختبر القاعدة" }).click();
  const result = page.getByTestId("rule-test-result");
  await expect(result).toContainText("تنطبق");
  await expect(result).toContainText("التوصيات الناتجة");
  await shot(page, "rule-test");
  await facts.fill('{"has_bank_account": "yes"}');
  await page.getByRole("button", { name: "اختبر القاعدة" }).click();
  await expect(result).toContainText("لا تنطبق");
  // Invalid facts JSON → clear message.
  await facts.fill("{has_bank_account: no}");
  await page.getByRole("button", { name: "اختبر القاعدة" }).click();
  await expect(page.getByRole("alert").first()).toContainText("ليست JSON صالحًا");
  // A demo assessment's computed facts.
  await facts.fill("");
  const sel = page.getByLabel("تقييم تجريبي");
  const value = await sel.locator("option").nth(1).getAttribute("value");
  if (value) {
    await sel.selectOption(value);
    await page.getByRole("button", { name: "اختبر القاعدة" }).click();
    await expect(result).toContainText(/حقائق التقييم المختار/);
  }
});

test("content editor can edit content but cannot open the rules engine", async ({ page }) => {
  test.setTimeout(120_000);
  const errors = watchErrors(page);
  const slug = `e2e-${Date.now().toString(36)}`;
  try {
    await loginAs(page, "editor");
    await page.goto("/admin/content/new");
    await page.getByLabel("المعرّف في الرابط").fill(slug);
    await page.getByLabel("العنوان").fill("دليل تجريبي لاختبار المحرر (تجريبي)");
    await page.locator('textarea[name="bodyMd"]').fill("## عنوان فرعي\n\nفقرة فيها **نص عريض** و[رابط](https://example.com).\n\n- بند أول\n- بند ثانٍ\n\n<script>alert(1)</script>");
    const preview = page.getByTestId("md-preview");
    if (test.info().project.name === "mobile") await page.getByRole("tab", { name: "معاينة" }).click();
    await expect(preview.locator("h2")).toHaveText("عنوان فرعي");
    await expect(preview.locator("strong")).toHaveText("نص عريض");
    await expect(preview.locator("script")).toHaveCount(0);
    if (test.info().project.name === "mobile") await page.getByRole("tab", { name: "تحرير" }).click();
    await page.getByRole("button", { name: "احفظ المسودة" }).click();
    await page.waitForURL(/\/admin\/content\/[0-9a-f-]{36}\?created=1/);
    await expect(page.getByRole("heading", { level: 1 })).toContainText("دليل تجريبي");
    // Workflow: article → review → publish.
    await page.getByRole("button", { name: "أرسل للمراجعة" }).click();
    await expect(page.getByRole("button", { name: "انشر" })).toBeVisible();
    await shot(page, "content-editor");
    // Switching to "regulation" requires a review before publishing.
    await page.getByLabel("النوع").first().selectOption("regulation");
    await page.getByRole("button", { name: "أضف مصدرًا" }).click();
    await page.getByLabel("المصدر", { exact: true }).fill("لائحة تنظيم أعمال النظارة");
    await page.getByRole("button", { name: "احفظ المحتوى" }).click();
    await expect(page.getByRole("status").filter({ hasText: "حُفظ المحتوى" })).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "انشر" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "مراجعة متخصص" })).toBeVisible();
    await page.getByRole("button", { name: "سجّل المراجعة" }).click();
    await expect(page.getByText("سُجّلت المراجعة المعتمدة")).toBeVisible();
    page.once("dialog", (d) => d.accept());
    await page.getByRole("button", { name: "انشر" }).click();
    await expect(page.getByText("نُشر المحتوى")).toBeVisible();

    // No access to the rules engine.
    await page.goto("/admin/rules");
    await expect(page).not.toHaveURL(/\/admin\/rules/);
    await page.goto("/admin/compliance");
    await expect(page).not.toHaveURL(/\/admin\/compliance/);
    expect(errors).toEqual([]);
  } finally {
    await sql("delete from content_items where slug = $1", [slug]);
  }
});

test("question bank: published version is read-only; services list and workflow editor validate input", async ({ page }) => {
  test.setTimeout(120_000);
  await loginAs(page, "admin");
  await page.goto("/admin/question-bank");
  await expect(page.getByText(/النسخة المعتمدة للتقييمات الجديدة/)).toBeVisible();
  await page.getByRole("link", { name: /الإصدار \d+/ }).first().click();
  await expect(page.getByText(/للقراءة فقط/).first()).toBeVisible();
  await expect(page.getByText("مجموع أوزان الوقف الصغير")).toBeVisible();
  await shot(page, "question-bank");
  // Workflow stages JSON validation (no save happens on an invalid stage list).
  await page.goto("/admin/services/workflows/new");
  await page.getByLabel("الرمز").fill("e2e_bad");
  await page.getByLabel("الاسم").fill("قالب غير صالح");
  await page.locator('textarea[name="stages"]').fill('[{"key": "Bad Key", "name": "x", "slaDays": 1, "role": "r"}]');
  await expect(page.getByText(/المفتاح key يكون بحروف إنجليزية صغيرة/).first()).toBeVisible();
  await page.getByRole("button", { name: "أنشئ القالب" }).click();
  await expect(page.getByRole("alert").first()).toContainText("المرحلة 1");
  expect(await sql("select 1 from workflow_templates where code = 'e2e_bad'")).toHaveLength(0);
  await page.goto("/admin/services");
  await shot(page, "services");
});

test("catalog and versioning mutations: price log, discount, bank draft clone, rule draft", async ({ page }) => {
  test.setTimeout(240_000);
  const errors = watchErrors(page);
  const disc = `E2E${Date.now().toString(36).toUpperCase()}`;
  const [svc] = await sql("select id from services where code = 'T05'");
  try {
    await loginAs(page, "admin");
    // Price with an effective period → price_change_log; overlapping period rejected.
    await page.goto(`/admin/services/${svc.id}`);
    const add = page.locator("form").filter({ has: page.getByRole("button", { name: "أضف السعر" }) });
    await add.getByLabel("فئة الوقف").selectOption("small");
    await add.getByLabel("السعر (ر.س)").fill("1234");
    await add.getByLabel("يسري من").fill("2031-01-01");
    await add.getByRole("button", { name: "أضف السعر" }).click();
    await expect(add.getByRole("status")).toContainText("أُضيف السعر");
    await add.getByLabel("السعر (ر.س)").fill("999");
    await add.getByRole("button", { name: "أضف السعر" }).click();
    await expect(add.getByRole("alert").first()).toContainText("تتداخل فترة السعر");
    expect(await sql("select 1 from price_change_log where entity_type = 'service_price' and new_value = '1234'")).not.toHaveLength(0);

    // Discount with validation (percent > 100 rejected).
    await page.goto("/admin/services/discounts/new");
    await page.getByLabel("رمز الخصم").fill(disc);
    await page.getByLabel("القيمة").fill("150");
    await page.getByRole("button", { name: "أنشئ الخصم" }).click();
    await expect(page.getByRole("alert").first()).toBeVisible();
    await expect(page.getByText("النسبة لا تتجاوز 100%.").first()).toBeVisible();
    await page.getByLabel("القيمة").fill("15");
    await page.getByLabel("الحد الأقصى للاستخدام").fill("20");
    await page.getByRole("button", { name: "أنشئ الخصم" }).click();
    await page.waitForURL(/\/admin\/services\/discounts\/[0-9a-f-]{36}\?created=1/);

    // Question bank: clone the published version into a draft, break the weight sum, then delete the draft.
    const before = await sql("select id from question_bank_versions where status = 'draft'");
    if (!before.length) {
      await page.goto("/admin/question-bank");
      await page.getByRole("button", { name: "أنشئ نسخة جديدة منها" }).first().click();
      await page.waitForURL(/\/admin\/question-bank\/[0-9a-f-]{36}\?created=1/);
      await expect(page.getByText("النسخة جاهزة للنشر")).toBeVisible();
      await page.getByText("تعديل المحور").first().click();
      const axis = page.locator("form").filter({ has: page.getByRole("button", { name: "احفظ المحور" }) }).first();
      await axis.getByLabel("وزن الوقف الصغير").fill("1");
      await axis.getByRole("button", { name: "احفظ المحور" }).click();
      await expect(axis.getByRole("status")).toContainText("يجب أن يكون 100");
      await page.reload();
      await expect(page.getByText(/لا يمكن النشر بعد/)).toBeVisible();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "احذف المسودة" }).click();
      await page.waitForURL(/\/admin\/question-bank\?deleted=1/);
    }

    // Rule: new draft version from the published one, edit, then delete the draft.
    const drafts = await sql("select 1 from recommendation_rules where code = 'R-FIN-002' and status = 'draft'");
    if (!drafts.length) {
      await page.goto("/admin/rules/R-FIN-002");
      await page.getByRole("button", { name: "أنشئ مسودة تعديل" }).click();
      await expect(page.getByText(/أُنشئت مسودة الإصدار/)).toBeVisible();
      await page.locator('textarea[name="condition"]').fill('{"bogus": 1}');
      await page.getByRole("button", { name: "احفظ المسودة" }).click();
      await expect(page.getByRole("alert").first()).toContainText("العامل «bogus» غير مدعوم");
      await page.locator('textarea[name="condition"]').fill('{"==": [{"var": "funds_separated"}, "no"]}');
      await page.getByRole("button", { name: "احفظ المسودة" }).click();
      await expect(page.getByText(/حُفظت المسودة/)).toBeVisible();
      page.once("dialog", (d) => d.accept());
      await page.getByRole("button", { name: "احذف المسودة" }).click();
      await page.waitForURL(/\/admin\/rules\/R-FIN-002$/);
    }
    expect(errors).toEqual([]);
  } finally {
    await sql("delete from service_prices where service_id = $1 and price = 1234", [svc.id]);
    await sql("delete from discounts where code = $1", [disc]);
  }
});
