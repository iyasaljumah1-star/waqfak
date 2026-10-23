import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Locator, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, passWaqfData } from "./helpers";

/**
 * The full request lifecycle on the new chain:
 * service form (draft → steps → documents → review → submit) → assignment → deficiencies register (raise, answer,
 * correction, accept) → verification and acceptance → versioned quote (maker-checker, change request, new version,
 * acceptance) → contract (company data check, parties with authority, approval, multi-party OTP signatures, signed
 * PDF) → invoices (proforma while VAT data is missing, tax invoice, partial payment, receipt, pre-start condition) →
 * amendment after contracting → delivery, completion blocked by an open required item, close. Plus isolation.
 *
 * Test-only data: the company profile is filled with clearly marked test values in the LOCAL database for the
 * duration of the suite and restored afterwards; a temporary membership lets the demo board chair co-sign.
 */

const shots = "/tmp/claude-0/shots";
const ex = expect.configure({ timeout: 25_000 });
mkdirSync(shots, { recursive: true });

const minimalPdf = (label: string) =>
  Buffer.from(
    [
      "%PDF-1.4",
      "1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj",
      "2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj",
      "3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >> endobj",
      `4 0 obj << /Length ${44 + label.length} >> stream`,
      `BT /F1 18 Tf 20 70 Td (${label}) Tj ET`,
      "endstream endobj",
      "5 0 obj << /Type /Font /Subtype /Type1 /BaseFont /Helvetica >> endobj",
      "trailer << /Root 1 0 R >>",
      "%%EOF",
    ].join("\n"),
  );

function ownerDb() {
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_OWNER_URL="));
  return new pg.Client({ connectionString: line!.slice("DATABASE_OWNER_URL=".length).trim() });
}
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = ownerDb();
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}

/** Test setup only: OTP sends are limited per phone/IP and other suites share the demo phones and localhost. */
async function resetOtpLimits(phone: string) {
  const norm = `+966${phone.replace(/\D/g, "").replace(/^0/, "")}`;
  await sql("delete from rate_limits where key = $1 or key like 'otp:ip:%'", [`otp:target:${norm}`]);
}

const TEST_COMPANY = {
  nameAr: "شركة وقفك (بيانات اختبار)", legalForm: "شركة ذات مسؤولية محدودة", crNumber: "0000000000", nationalAddress: "عنوان اختبار — الرياض",
  signatoryName: "مفوّض اختبار", signatoryTitle: "المدير العام (اختبار)", iban: "SA0000000000000000000000", bankName: "بنك اختبار",
};
async function setCompany(patch: Record<string, string>) {
  await sql("update settings set value = value || $1::jsonb where key = 'company.profile'", [JSON.stringify(patch)]);
}

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string, viewport: { width: number; height: number } | null): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-req-${key}-${demo().users[key].id}.json`;
  const opts = viewport ? { viewport } : {};
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const page = await ctx.newPage();
    const res = await page.request.get("/api/files/00000000-0000-4000-8000-000000000000");
    if (res.status() !== 401) {
      pages.set(key, page);
      return page;
    }
    await ctx.close();
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  pages.set(key, page);
  return page;
}

const statusBadge = (page: Page, label: string) => page.locator("header").getByText(label, { exact: true }).first();
const upload = async (scope: Locator | Page, name: string) => {
  await scope.getByTestId("document-file-input").setInputFiles({ name, mimeType: "application/pdf", buffer: minimalPdf(`${name} ${Date.now()}`) });
};

/** Opens a <details> by its summary text (clicking an open one would close it). */
async function openDetails(page: Page, summary: string) {
  const d = page.locator("details", { has: page.locator("summary", { hasText: summary }) }).first();
  if (!(await d.evaluate((el) => (el as HTMLDetailsElement).open))) await d.locator("summary").first().click();
  return d;
}

async function signWithOtp(page: Page, phone: string, scope?: Locator) {
  const s = scope ?? page.locator("body");
  await resetOtpLimits(phone);
  await s.getByRole("button", { name: "أرسل رمز التوقيع" }).first().click();
  const code = (await page.getByTestId("demo-otp").innerText()).trim();
  await page.getByLabel("رمز التوقيع").fill(code);
  await page.getByLabel(/قرأت نص العقد كاملًا/).check();
  await page.getByRole("button", { name: "وقّع العقد" }).click();
  await page.waitForURL(/\?signed=1/);
}

test.describe.serial("service request lifecycle", () => {
  test.setTimeout(240_000);
  let reqId = "";
  let reqNumber = "";
  let noWaqfReqId = "";
  let invoiceId = "";
  let originalCompany = "";
  let tempMembership = "";

  test.beforeAll(async () => {
    const [row] = await sql<{ value: unknown }>("select value from settings where key = 'company.profile'");
    originalCompany = JSON.stringify(row?.value ?? {});
    // Start without a signatory and without VAT status, to see the platform refuse contracts / tax invoices.
    await sql("update settings set value = $1::jsonb where key = 'company.profile'", [JSON.stringify({ ...JSON.parse(originalCompany), signatoryName: "", signatoryTitle: "", vatRegistration: "", vatNumber: "" })]);
    const [m] = await sql<{ id: string }>(
      "insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'board_chair', 'active') returning id",
      [demo().waqfs.A, demo().users.chair.id],
    );
    tempMembership = m.id;
  });

  test.afterAll(async () => {
    for (const p of pages.values()) await p.context().close();
    pages.clear();
    await sql("update settings set value = $1::jsonb where key = 'company.profile'", [originalCompany]);
    if (tempMembership) await sql("delete from waqf_memberships where id = $1", [tempMembership]);
  });

  test("service page explains the real next steps (no fixed five-day promise)", async ({ browser, viewport }) => {
    const page = await as(browser, "nazir", viewport);
    await page.goto(`/app/requests/new?service=C02&waqf=${demo().waqfs.A}`);
    await ex(page.getByText("ماذا يحدث بعد الإرسال؟")).toBeVisible();
    await ex(page.getByText(/المدة المعيارية لمرحلة «استلام البيانات والمستندات» 3 أيام عمل/)).toBeVisible();
    await ex(page.getByText("5 أيام عمل")).toHaveCount(0);
    await ex(page.getByText("صك الوقفية").first()).toBeVisible();
    await page.goto("/app/requests/new?service=N01");
    await ex(page.getByText("كيف تسير خدمة تولي النظارة").first()).toBeVisible();
    await ex(page.getByRole("button", { name: "ابدأ نموذج الطلب" })).toBeVisible();
  });

  test("nazir fills the C02 form step by step, keeps a draft, and submits with the required documents", async ({ browser, viewport }, info) => {
    const page = await as(browser, "nazir", viewport);
    await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [demo().users.nazir.id]);
    await page.goto(`/app/requests/new?service=C02&waqf=${demo().waqfs.A}`);
    await ex(page.getByRole("radio", { name: /وقف مسجل في منصة/ })).toBeChecked();
    await ex(page.getByLabel("اختر الوقف المسجل")).toHaveValue(demo().waqfs.A);
    await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    reqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];

    // Step 1: applicant — prefilled contact, capacity required, inline error
    await ex(page.getByLabel(/^الاسم الكامل/)).toHaveValue(demo().users.nazir.name);
    await page.getByRole("button", { name: "التالي" }).click();
    await ex(page.getByText("«صفتك في هذا الطلب» مطلوب.")).toBeVisible();
    await page.getByRole("radio", { name: "وكيل عن صاحب الشأن بموجب وكالة" }).check();
    await ex(page.getByLabel(/رقم الوكالة/)).toBeVisible(); // conditional field appears
    await page.getByRole("radio", { name: "ناظر الوقف" }).check();
    await ex(page.getByLabel(/رقم الوكالة/)).toHaveCount(0);
    await page.getByRole("button", { name: "التالي" }).click();

    // Step 2: the waqf's records as held in its file (source, date, status) — confirmed, not re-entered
    await ex(page.getByTestId("context-blocks")).toBeVisible();
    await passWaqfData(page);

    // Step 3: service questions
    await ex(page.getByRole("heading", { name: "التقييم المعمّق" })).toBeVisible();
    await page.getByRole("radio", { name: "نعم" }).check();
    await page.getByRole("checkbox", { name: "الحوكمة والنظارة" }).check(); // C02 v2: focus areas are required
    await page.getByLabel(/طريقة المقابلة/).selectOption("online");
    await page.getByLabel(/من نقابل من جهة الوقف/).fill("الناظر (اختبار آلي)");
    await page.getByRole("button", { name: "التالي" }).click();
    await ex(page.getByText(/حُفظت المسودة/)).toBeVisible();

    // The draft survives a reload (answers saved on the server)
    await page.reload();
    await page.getByRole("button", { name: /^3\. / }).click();
    await ex(page.getByLabel(/من نقابل من جهة الوقف/)).toHaveValue("الناظر (اختبار آلي)");
    await page.getByRole("button", { name: /^4\. / }).click();
    await page.getByRole("button", { name: "التالي" }).click();

    // Documents: only one of two required slots, then try to submit → refused server-side
    await ex(page.getByRole("heading", { name: "المستندات" })).toBeVisible();
    await upload(page.getByTestId("slot-svc_waqf_deed"), "waqf-deed.pdf");
    await ex(page.getByTestId("slot-svc_waqf_deed").getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "التالي" }).click();
    await ex(page.getByText("مستند مطلوب: صك النظارة")).toBeVisible();
    await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await ex(page.getByText(/مستندات مطلوبة لم تُرفق: صك النظارة/)).toBeVisible();
    await ex(page.getByRole("heading", { name: "المستندات" })).toBeVisible(); // jumped back to the gap
    await upload(page.getByTestId("slot-svc_nazara_deed"), "nazara-deed.pdf");
    await ex(page.getByTestId("slot-svc_nazara_deed").getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "التالي" }).click();
    await ex(page.getByText("البيانات والمستندات المطلوبة مكتملة.")).toBeVisible();
    await page.screenshot({ path: `${shots}/intake-review-${info.project.name}.png`, fullPage: true });
    await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?created=1/);
    reqNumber = (await page.locator("header [dir=ltr].tabular").first().innerText()).trim();
    expect(reqNumber).toMatch(/^REQ-\d+/);
    await ex(statusBadge(page, "مُرسل")).toBeVisible();
    await ex(page.getByTestId("next-action")).toContainText("إسناد الطلب إلى مختص");
    await ex(page.getByTestId("request-states")).toContainText("المستندات المطلوبة مرفقة");

    const [row] = await sql<{ intake: { answers: Record<string, string>; docs: Record<string, string[]> }; details: string }>("select intake, details from service_requests where id = $1", [reqId]);
    expect(row.intake.answers.capacity).toBe("nazir");
    expect(row.intake.answers.principalName).toBeUndefined(); // hidden answers are not stored
    expect(row.intake.docs.svc_nazara_deed?.length).toBe(1);
    expect(row.details).toContain("الناظر (اختبار آلي)");

    // A waqf-less request (isolation check later)
    await page.goto("/app/requests/new?service=C01");
    await page.getByRole("radio", { name: /لا يوجد لدي وقف قائم/ }).check();
    await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await page.waitForURL(/\/intake$/);
    noWaqfReqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await page.getByRole("radio", { name: "الواقف أو من يريد إنشاء الوقف" }).check();
    await page.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(page);
    await page.getByRole("checkbox", { name: "الحوكمة والنظارة" }).check(); // C01 v2: focus areas are required
    await page.getByRole("button", { name: /المراجعة والإرسال/ }).click();
    await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await page.waitForURL(/\?created=1/);
  });

  test("ops assigns the request to emp1; emp1 is isolated from other requests", async ({ browser, viewport }) => {
    const page = await as(browser, "ops", viewport);
    await page.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    // the unified panel: each answer with its origin (client / waqf file / team correction), not only "as submitted"
    await ex(page.getByRole("heading", { name: "بيانات الطلب", exact: true })).toBeVisible();
    await ex(page.getByTestId("field-contactPerson").getByTestId("field-value")).toHaveText("الناظر (اختبار آلي)");
    await ex(page.getByTestId("field-contactPerson").getByTestId("field-origin")).toHaveText("أدخله العميل");
    const select = page.getByLabel("الموظف");
    const value = await select.locator("option", { hasText: "موظف أول" }).first().getAttribute("value");
    await select.selectOption(value!);
    await page.getByRole("button", { name: "أسند", exact: true }).click();
    await ex(statusBadge(page, "قيد الفرز")).toBeVisible();

    const emp = await as(browser, "emp1", viewport);
    const [other] = await sql<{ id: string }>("select id from service_requests where assigned_to_user_id = $1 limit 1", [demo().users.emp2.id]);
    for (const id of [other.id, noWaqfReqId]) {
      await emp.goto(`/admin/requests/${id}`);
      await ex(emp.getByText("لم نجد ما طلبته")).toBeVisible();
      await emp.goto(`/app/requests/${id}`);
      await ex(emp.getByText("الصفحة غير موجودة")).toBeVisible();
    }
    // the waqf-less request's documents/items/quotes are not reachable through RLS either
    await emp.goto(`/app/requests/${noWaqfReqId}/quote/00000000-0000-4000-8000-000000000000`);
    await ex(emp.locator("body")).toContainText("غير موجود");
  });

  test("deficiencies: raise, hold for client, answer, correction, accept; internal notes stay internal", async ({ browser, viewport }, info) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    await openDetails(emp, "سجّل بندًا جديدًا");
    const form = emp.getByTestId("raise-item");
    await form.getByLabel("النوع").selectOption("document");
    await form.getByLabel("العنوان").fill("شهادة تسجيل الوقف سارية");
    await form.getByLabel("نوع المستند").selectOption("registration_certificate");
    await form.getByLabel("التفاصيل").fill("المرفوعة منتهية؛ نحتاج الشهادة السارية.");
    await form.getByRole("button", { name: "سجّل البند" }).click();
    await ex(emp.getByText("سُجّل البند رقم 1.")).toBeVisible();
    await ex(statusBadge(emp, "بانتظار العميل")).toBeVisible();
    // internal note item
    await openDetails(emp, "سجّل بندًا جديدًا");
    await form.getByLabel("النوع").selectOption("internal");
    await form.getByLabel("العنوان").fill("تحقق داخلي من رقم الصك");
    await form.getByRole("button", { name: "سجّل البند" }).click();
    await ex(emp.getByTestId("item-2")).toBeVisible();
    // verification refused while a required client item is open
    await ex(emp.getByRole("button", { name: "تحققت من البيانات والمستندات", exact: true })).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}`);
    await ex(naz.getByTestId("next-action")).toContainText("استكمال النواقص");
    await ex(naz.getByTestId("item-1")).toBeVisible();
    await ex(naz.getByText("تحقق داخلي من رقم الصك")).toHaveCount(0);
    const item = naz.getByTestId("item-1");
    await upload(item, "cert-old.pdf");
    await ex(item.getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible({ timeout: 30_000 });
    await item.getByRole("button", { name: "أرسل الرد" }).click();
    await ex(item.getByText("استكمله العميل — قيد المراجعة")).toBeVisible();
    await ex(statusBadge(naz, "قيد الفرز")).toBeVisible(); // returned to the team automatically

    await emp.reload();
    await emp.getByTestId("item-1").getByRole("button", { name: "اطلب تصحيحًا" }).click();
    await emp.getByLabel("ما المطلوب تصحيحه؟").fill("الملف المرفوع غير مقروء؛ أعد رفعه.");
    await emp.getByRole("button", { name: "أرسل طلب التصحيح" }).click();
    await ex(emp.getByText("أُرسل طلب التصحيح إلى العميل.")).toBeVisible();
    await ex(statusBadge(emp, "بانتظار العميل")).toBeVisible();

    await naz.reload();
    await ex(naz.getByText("مطلوب تصحيحه: الملف المرفوع غير مقروء؛ أعد رفعه.")).toBeVisible();
    await upload(naz.getByTestId("item-1"), "cert-new.pdf");
    await ex(naz.getByTestId("item-1").getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible({ timeout: 30_000 });
    await naz.getByTestId("item-1").getByRole("button", { name: "أرسل الرد" }).click();
    await ex(naz.getByTestId("item-1").getByText("استكمله العميل — قيد المراجعة")).toBeVisible();

    await emp.reload();
    await emp.getByTestId("item-1").getByRole("button", { name: "اقبل وأغلق" }).click();
    await ex(emp.getByTestId("item-1").getByText("مقبول ومغلق")).toBeVisible();
    await emp.getByTestId("item-2").getByRole("button", { name: "أغلق" }).click();
    await ex(emp.getByTestId("item-2").getByText("مقبول ومغلق")).toBeVisible();
    // the item history is immutable
    await expect(sql("update request_item_events set note = 'x' where request_id = $1", [reqId])).rejects.toThrow(/append-only/);

    // uploaded is not verified: each required form document is verified before the intake check
    await emp.reload();
    for (const slot of ["svc_waqf_deed", "svc_nazara_deed"]) {
      const row = emp.getByTestId(`docslot-${slot}`);
      await row.getByRole("button", { name: "تحققت منه" }).click();
      await ex(row).toContainText("متحقق منه");
    }
    await emp.reload();
    await ex(emp.getByTestId("doc-review")).not.toContainText("لم يُتحقق منه");
    await emp.getByRole("button", { name: "تحققت من البيانات والمستندات", exact: true }).click();
    await ex(emp.getByTestId("request-states")).toContainText("تحقق الفريق من البيانات والمستندات: تم");
    await emp.getByRole("button", { name: "اقبل الطلب للخدمة", exact: true }).click();
    await ex(emp.getByTestId("request-states")).toContainText("قُبل الطلب للخدمة: تم");
    await ex(emp.getByTestId("current-step")).toContainText("نطاق العمل وعرض السعر");
    await emp.screenshot({ path: `${shots}/req-items-${info.project.name}.png`, fullPage: true });
  });

  test("quote: maker-checker, change request, new version, acceptance; sent quotes are frozen", async ({ browser, viewport }, info) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#quote`);
    const ed = emp.getByTestId("quote-editor");
    await ed.getByLabel("سعر وحدة البند 1").fill("1000");
    await ed.getByLabel("نسبة الدفعة 1").fill("50");
    await ed.getByRole("button", { name: "أضف دفعة" }).click();
    await ed.getByLabel("وصف الدفعة 2").fill("عند تسليم التقرير");
    await ed.getByLabel("نسبة الدفعة 2").fill("50");
    await ex(ed.getByText(/1[,٬]150/).first()).toBeVisible(); // live preview: 1000 + 15%
    await ed.getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex(emp.getByText(/أُنشئت مسودة العرض QUO-\d+ \(نسخة 1\)/)).toBeVisible();
    await ex(emp.getByText("يعتمده زميل يملك صلاحية اعتماد العروض.").first()).toBeVisible();

    const ops = await as(browser, "ops", viewport);
    await ops.goto(`/admin/requests/${reqId}?t=${Date.now()}#quote`);
    await ops.getByRole("button", { name: "اعتمد العرض" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await emp.reload();
    await emp.getByRole("button", { name: "أرسل العرض للعميل" }).click();
    await ex(statusBadge(emp, "عرض سعر")).toBeVisible();
    // frozen after sending (database trigger)
    await expect(sql("update quotes set total = 1 where request_id = $1", [reqId])).rejects.toThrow(/no longer a draft/);

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}#quote`);
    await ex(naz.getByText("نطاق العمل").first()).toBeVisible();
    await ex(naz.getByText(/1[,٬]150/).first()).toBeVisible();
    await naz.getByRole("button", { name: "أطلب تعديلًا" }).click();
    await naz.getByLabel("ما التعديل الذي تطلبه؟").fill("نرجو خفض السعر إلى 900 ريال (اختبار).");
    await naz.getByRole("button", { name: "أرسل طلب التعديل" }).click();
    await ex(naz.getByText("طلب العميل تعديله").first()).toBeVisible();

    await emp.reload();
    await ex(emp.getByTestId("blockers")).toContainText("طلب العميل تعديل العرض");
    await ex(emp.getByTestId("next-step-link")).toHaveText("أعدّ نسخة معدلة من العرض");
    await openDetails(emp, "أعدّ نسخة جديدة من العرض");
    await emp.getByTestId("quote-editor").getByLabel("سعر وحدة البند 1").fill("900");
    await emp.getByTestId("quote-editor").getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex(emp.getByText(/\(نسخة 2\)/).first()).toBeVisible();
    await ops.reload();
    await ops.getByRole("button", { name: "اعتمد العرض" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await emp.reload();
    await emp.getByRole("button", { name: "أرسل العرض للعميل" }).click();
    await ex(emp.getByText("استُبدل بنسخة أحدث").first()).toBeVisible();
    const versions = await sql<{ version: number; status: string }>("select version, status from quotes where request_id = $1 order by version", [reqId]);
    expect(versions).toEqual([{ version: 1, status: "superseded" }, { version: 2, status: "sent" }]);

    await naz.reload();
    await ex(naz.getByText(/1[,٬]035/).first()).toBeVisible(); // 900 + 15%
    const q2 = naz.locator('[data-testid$="-v2"]');
    await q2.getByRole("button", { name: "أقبل العرض" }).click();
    await ex(statusBadge(naz, "بانتظار العقد")).toBeVisible();
    const pdf = await naz.request.get(`/app/requests/${reqId}/quote/${(await sql<{ id: string }>("select id from quotes where request_id = $1 and version = 2", [reqId]))[0].id}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    await naz.screenshot({ path: `${shots}/req-quote-${info.project.name}.png`, fullPage: true });
  });

  test("an expired offer cannot be accepted", async ({ browser, viewport }) => {
    // test fixture on the waqf-less request: a sent quote whose validity ended yesterday
    await sql(
      `insert into quotes (number, request_id, version, kind, status, scope, lines, subtotal, discount, net, vat_rate, vat, total, payment_terms, valid_until, content_hash, sent_at)
       values ($2, $1, 1, 'initial', 'sent', 'عرض اختبار منتهي الصلاحية', '[]', 100, 0, 100, 15, 15, 115, '[]', current_date - 1, 'test', now())
`,
      [noWaqfReqId, `QUO-TEST-${Date.now()}`],
    );
    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${noWaqfReqId}`);
    await ex(naz.getByText("انتهت صلاحية هذا العرض ولا يمكن قبوله.", { exact: false }).first()).toBeVisible();
    await ex(naz.getByRole("button", { name: "أقبل العرض" })).toHaveCount(0);
  });

  test("contract: company data required, parties with authority, approval, multi-party OTP, signed PDF", async ({ browser, viewport }, info) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#contract`);
    await ex(emp.getByText(/لا يُعدّ عقد قبل استكمال:.*اسم المفوّض بالتوقيع/).first()).toBeVisible();
    await ex(emp.getByRole("button", { name: "أعدّ مسودة العقد" })).toBeDisabled();
    await setCompany(TEST_COMPANY);
    await emp.reload();
    const form = emp.getByTestId("contract-prepare");
    await ex(form.getByLabel("اسم الطرف المتعاقد").first()).toHaveValue(/وقف النور/);
    await form.getByLabel(/سند الصفة/).first().fill("صك النظارة رقم 000 (اختبار)");
    await form.getByRole("button", { name: "أضف طرفًا موقّعًا آخر" }).click();
    const second = form.locator("fieldset").nth(1);
    await second.getByLabel("اسم الطرف المتعاقد").fill("مجلس نظارة وقف النور (اختبار)");
    await second.getByLabel("صفته", { exact: true }).fill("مجلس النظارة");
    await second.getByLabel(/الموقّع/).selectOption(demo().users.chair.id);
    await second.getByLabel("صفة التوقيع").selectOption("board");
    await second.getByLabel(/سند الصفة/).fill("قرار المجلس رقم 1 (اختبار)");
    await form.getByRole("button", { name: "أعدّ مسودة العقد" }).click();
    await ex(emp.locator('[data-testid^="contract-CTR-"]').getByText("مسودة", { exact: true })).toBeVisible();

    const ops = await as(browser, "ops", viewport);
    await ops.goto(`/admin/requests/${reqId}?t=${Date.now()}#contract`);
    await ops.getByRole("button", { name: "اعتمد العقد" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await emp.reload();
    await emp.getByRole("button", { name: "أرسل للتوقيع" }).click();
    await ex(emp.getByText("مرسل للتوقيع").first()).toBeVisible();
    await expect(sql("update contracts set amount = 1 where request_id = $1", [reqId])).rejects.toThrow(/no longer a draft/);

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}#contract`);
    await ex(naz.getByText(/مفوّض اختبار/).first()).toBeVisible();
    await ex(naz.getByTestId("contract-parties")).toContainText("لم يوقّع بعد");
    await signWithOtp(naz, demo().users.nazir.phone);
    await ex(naz.getByText("سُجّل توقيعك")).toBeVisible();
    await ex(naz.getByText("وقّعه بعض الأطراف").first()).toBeVisible();

    // work cannot start before every party signed
    await emp.reload();
    await emp.getByRole("button", { name: "بدء التنفيذ بعد توقيع العقد" }).click();
    await ex(emp.getByText(/يبدأ التنفيذ بعد/).first()).toBeVisible();

    const chair = await as(browser, "chair", viewport);
    await chair.goto(`/app/requests/${reqId}?t=${Date.now()}#contract`);
    await signWithOtp(chair, demo().users.chair.phone);

    await ops.reload();
    await signWithOtp(ops, demo().users.ops.phone);
    await ex(ops.getByText("نافذ — وقّعه جميع الأطراف").first()).toBeVisible();
    const [k] = await sql<{ id: string; status: string; executed_at: Date | null }>("select id, status, executed_at from contracts where request_id = $1 and status <> 'void'", [reqId]);
    expect(k.status).toBe("signed");
    expect(k.executed_at).not.toBeNull();
    const sigs = await sql<{ party_key: string }>("select party_key from contract_signatures where contract_id = $1 order by party_key", [k.id]);
    expect(sigs.map((s) => s.party_key)).toEqual(["client1", "client2", "company"]);
    const pdf = await naz.request.get(`/app/requests/${reqId}/contract/${k.id}`);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-disposition"]).toContain("-signed.pdf");
    await ops.screenshot({ path: `${shots}/req-contract-${info.project.name}.png`, fullPage: true });
  });

  test("billing: proforma without VAT data, tax invoice, partial payment, receipt, pre-start condition", async ({ browser, viewport }, info) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#billing`);
    await ex(emp.getByText("تصدر فاتورة أولية فقط")).toBeVisible();
    // invoice cycle: draft (team only) → approved by finance (legal number) → sent to the client
    await emp.getByTestId("term-t1").getByRole("button", { name: "أعدّ مسودة فاتورة أولية" }).click();
    await ex.poll(async () => (await sql("select 1 from invoices where request_id = $1 and status = 'draft'", [reqId])).length).toBe(1);
    const [prf] = await sql<{ id: string; kind: string; status: string }>("select id, kind, status from invoices where request_id = $1", [reqId]);
    expect(prf).toMatchObject({ kind: "proforma", status: "draft" });
    const admin = await as(browser, "admin", viewport);
    const approveAndSend = async (id: string) => {
      await admin.goto(`/admin/finance/${id}?t=${Date.now()}`);
      await admin.getByRole("button", { name: /^اعتمد الفاتورة/ }).click();
      await ex.poll(async () => (await sql<{ status: string }>("select status from invoices where id = $1", [id]))[0].status).toBe("approved");
      await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#billing`);
      await emp.getByTestId(`invoice-cycle-${id}`).getByRole("button", { name: "أرسل الفاتورة للعميل" }).click();
      await ex.poll(async () => (await sql<{ status: string }>("select status from invoices where id = $1", [id]))[0].status).toBe("issued");
    };
    await approveAndSend(prf.id);
    const [prfSent] = await sql<{ number: string; status: string; sent_at: Date | null }>("select number, status, sent_at from invoices where id = $1", [prf.id]);
    expect(prfSent.number).toMatch(/^PRF-\d+/);
    expect(prfSent.sent_at).toBeTruthy();

    await setCompany({ vatRegistration: "registered", vatNumber: "300000000000003" });
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#billing`);
    await emp.getByTestId("term-t1").getByRole("button", { name: "أعدّ مسودة الفاتورة" }).click();
    await ex.poll(async () => (await sql("select 1 from invoices where request_id = $1 and kind = 'tax_invoice' and status = 'draft'", [reqId])).length).toBe(1);
    const [draftInv] = await sql<{ id: string }>("select id from invoices where request_id = $1 and kind = 'tax_invoice' and status = 'draft'", [reqId]);
    // the client cannot see an unsent invoice (database row-level rule + page)
    const nazPeek = await as(browser, "nazir", viewport);
    expect((await nazPeek.request.get(`/app/billing/${draftInv.id}/pdf`)).status()).toBe(404);
    // the team previews it in full before approving
    await emp.goto(`/app/billing/${draftInv.id}?t=${Date.now()}`);
    await ex(emp.getByText("معاينة مسودة — لم تُعتمد ولم تُرسل")).toBeVisible();
    await approveAndSend(draftInv.id);
    await ex(emp.getByTestId("term-t1").getByText(/INV-\d+/)).toBeVisible();
    const [inv] = await sql<{ id: string; total: string; seller_snapshot: { vatNumber: string } }>("select id, total, seller_snapshot from invoices where request_id = $1 and kind = 'tax_invoice'", [reqId]);
    invoiceId = inv.id;
    expect(Number(inv.total)).toBe(517.5); // 50% of 900 + 15%
    expect(inv.seller_snapshot.vatNumber).toBe("300000000000003");
    await expect(sql("update invoices set total = 1 where id = $1", [inv.id])).rejects.toThrow(/cannot be edited/);
    // pre-start installment unpaid → work cannot start
    await emp.getByRole("button", { name: "بدء التنفيذ بعد توقيع العقد" }).click();
    await ex(emp.getByText("لم تُسدد الدفعة التي يشترط العرض سدادها قبل البدء.")).toBeVisible();

    await admin.goto(`/admin/finance/${invoiceId}`);
    await admin.getByLabel("المبلغ (ر.س)").fill("200");
    await admin.getByLabel("المرجع").fill("TRX-TEST-001");
    await admin.getByRole("button", { name: "سجّل السداد" }).click();
    await ex(admin.getByText(/سُجّل السداد \(الإيصال RCT-\d+\). المتبقي/)).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/billing/${invoiceId}`);
    await ex(naz.getByText("فاتورة ضريبية").first()).toBeVisible();
    await ex(naz.getByRole("img", { name: /رمز الاستجابة السريعة/ })).toBeVisible();
    await ex(naz.getByText(/المستحق: 317\.5/)).toBeVisible();
    await naz.getByRole("button", { name: "ادفع الآن" }).click();
    await naz.waitForURL(/\/pay\?payment=/);
    await naz.getByRole("button", { name: "4111111111111111" }).click();
    await naz.getByLabel("تاريخ الانتهاء").fill("12/29");
    await naz.getByLabel("رمز التحقق CVC").fill("123");
    await naz.getByRole("button", { name: "ادفع (تجريبي)" }).click();
    await naz.waitForURL(/\?paid=1/);
    await ex(naz.getByText("سُجلت الدفعة وأصبحت الفاتورة مدفوعة. شكرًا لك.")).toBeVisible();
    const receipts = await sql<{ id: string; receipt_number: string }>("select id, receipt_number from payments where invoice_id = $1 and status = 'paid' order by created_at", [invoiceId]);
    expect(receipts).toHaveLength(2);
    const rec = await naz.request.get(`/app/billing/${invoiceId}/receipt/${receipts[1].id}`);
    expect(rec.status()).toBe(200);
    const invPdf = await naz.request.get(`/app/billing/${invoiceId}/pdf`);
    expect(invPdf.status()).toBe(200);
    await naz.screenshot({ path: `${shots}/req-invoice-${info.project.name}.png`, fullPage: true });

    await emp.reload();
    await emp.getByRole("button", { name: "بدء التنفيذ بعد توقيع العقد" }).click();
    await ex(statusBadge(emp, "قيد التنفيذ")).toBeVisible();
  });

  test("amendment after contracting needs a new accepted quote and a signed amendment", async ({ browser, viewport }) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#quote`);
    await openDetails(emp, "أعدّ ملحق تعديل");
    const ed = emp.getByTestId("quote-editor");
    await ed.getByLabel("نطاق العمل").fill("إضافة مراجعة لسجل المستفيدين لم تكن في النطاق الأصلي (اختبار).");
    await ed.getByLabel("المخرجات").fill("ملحق بنتائج مراجعة السجل");
    await ed.getByLabel("وصف البند 1").fill("مراجعة سجل المستفيدين");
    await ed.getByLabel("سعر وحدة البند 1").fill("300");
    await ed.getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex(emp.getByText(/أُنشئت مسودة العرض QUO-\d+/)).toBeVisible();
    const ops = await as(browser, "ops", viewport);
    await ops.goto(`/admin/requests/${reqId}?t=${Date.now()}#quote`);
    await ops.getByRole("button", { name: "اعتمد العرض" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await emp.reload();
    await emp.getByRole("button", { name: "أرسل العرض للعميل" }).click();
    await ex(emp.getByText("مرسل للعميل").first()).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}#quote`);
    await naz.getByRole("button", { name: "أقبل العرض" }).click();
    await ex(naz.locator('[data-testid^="quote-"]').filter({ hasText: "ملحق تعديل" }).getByText("مقبول", { exact: true })).toBeVisible();
    await ex(statusBadge(naz, "قيد التنفيذ")).toBeVisible(); // the request keeps going

    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#contract`);
    const form = emp.getByTestId("contract-prepare");
    await form.getByLabel(/سند الصفة/).first().fill("صك النظارة رقم 000 (اختبار)");
    await form.getByRole("button", { name: "أعدّ مسودة العقد" }).click();
    await ex(emp.getByText(/ملحق تعديل CTR-\d+/).first()).toBeVisible();
    await ops.goto(`/admin/requests/${reqId}?t=${Date.now()}#contract`);
    await ops.getByRole("button", { name: "اعتمد العقد" }).click();
    await ex(ops.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    await emp.reload();
    await emp.getByRole("button", { name: "أرسل للتوقيع" }).click();
    await ex(emp.getByText("مرسل للتوقيع").first()).toBeVisible();
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}#contract`);
    await signWithOtp(naz, demo().users.nazir.phone);
    await ops.reload();
    await signWithOtp(ops, demo().users.ops.phone);
    const [req] = await sql<{ agreed_price: string }>("select agreed_price from service_requests where id = $1", [reqId]);
    expect(Number(req.agreed_price)).toBe(1200);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    await ex(emp.getByText(/فحص الاتساق: لا فروق/)).toBeVisible();
  });

  test("delivery, four-eyes QA, completion blocked by an open required item, close", async ({ browser, viewport }) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    // the legacy path: a file prepared outside the platform (generated drafts are covered in operations.spec)
    await openDetails(emp, "أو ارفع ملفًا أُعدّ خارج المنصة");
    await emp.getByLabel("عنوان المخرج").fill("تقرير التقييم المعمّق (اختبار)");
    await emp.getByRole("button", { name: "سجّل المخرج" }).click();
    await ex(emp.getByText("أُضيف المخرج.")).toBeVisible();
    // open work stages are confirmed explicitly by the sender (recorded in the request log)
    if (await emp.getByTestId("approval-ack").count()) await emp.getByTestId("approval-ack").locator("input").check();
    await emp.getByRole("button", { name: "إرسال لمراجعة الجودة" }).click();
    await ex(statusBadge(emp, "مراجعة الجودة")).toBeVisible();
    const ops = await as(browser, "ops", viewport);
    await ops.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    await ops.getByRole("button", { name: "اعتماد الجودة وإرسال للعميل" }).click();
    await ex(statusBadge(ops, "بانتظار اعتماد العميل")).toBeVisible();
    // a required question opened now blocks completion
    await openDetails(ops, "سجّل بندًا جديدًا");
    await ops.getByTestId("raise-item").getByLabel("النوع").selectOption("question");
    await ops.getByTestId("raise-item").getByLabel("العنوان").fill("هل نضيف ملخصًا تنفيذيًا؟");
    await ops.getByTestId("raise-item").getByRole("button", { name: "سجّل البند" }).click();
    await ex(ops.getByText(/سُجّل البند رقم 3/)).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}`);
    await naz.getByTestId("approval-ack").locator("input").check();
    await naz.getByRole("button", { name: "أعتمد المخرجات" }).click();
    await ex(naz.getByText(/لا يكتمل الطلب وفيه 1/)).toBeVisible();
    await naz.getByTestId("item-3").getByLabel("ردك").fill("نعم، أضيفوه (اختبار).");
    await naz.getByTestId("item-3").getByRole("button", { name: "أرسل الرد" }).click();
    await ex(naz.getByTestId("item-3").getByText("استكمله العميل — قيد المراجعة")).toBeVisible();
    await ops.reload();
    await ops.getByTestId("item-3").getByRole("button", { name: "اقبل وأغلق" }).click();
    await ex(ops.getByTestId("item-3").getByText("مقبول ومغلق")).toBeVisible();
    await naz.reload();
    await naz.getByTestId("approval-ack").locator("input").check();
    await naz.getByRole("button", { name: "أعتمد المخرجات" }).click();
    await ex(statusBadge(naz, "مكتمل")).toBeVisible();
    await ex(naz.getByTestId("request-states")).toContainText("نُفّذت الخدمة");
    // ACC-14: the client's approval makes the completion/milestone installments due (date recorded) with a finance task
    const late = await sql<{ id: string; due_on: string | null }>("select id, due_on from payment_schedule where request_id = $1 and due_kind in ('on_completion','on_milestone','on_delivery')", [reqId]);
    for (const r of late) {
      expect(r.due_on).toBeTruthy();
      expect((await sql("select 1 from tasks where request_id = $1 and kind = 'finance' and output_key = $2", [reqId, `pay:${r.id}`])).length).toBe(1);
    }
    // closing waits for an issued invoice of every contractual installment (payment is not required)
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    await emp.getByRole("button", { name: "إغلاق الطلب" }).click();
    await ex(emp.getByText(/لا يُغلق الطلب قبل إصدار فواتير الدفعات المستحقة/)).toBeVisible();
    const fin = await as(browser, "admin", viewport);
    for (let i = 0; i < 4; i++) {
      await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#billing`);
      const issue = emp.getByRole("button", { name: "أعدّ مسودة الفاتورة" });
      if (!(await issue.count())) break;
      await issue.first().click();
      await ex.poll(async () => (await sql("select 1 from invoices where request_id = $1 and status = 'draft'", [reqId])).length).toBe(1);
      const [dr] = await sql<{ id: string }>("select id from invoices where request_id = $1 and status = 'draft'", [reqId]);
      await fin.goto(`/admin/finance/${dr.id}?t=${Date.now()}`);
      await fin.getByRole("button", { name: /^اعتمد الفاتورة/ }).click();
      await ex.poll(async () => (await sql<{ status: string }>("select status from invoices where id = $1", [dr.id]))[0].status).toBe("approved");
      await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}#billing`);
      await emp.getByTestId(`invoice-cycle-${dr.id}`).getByRole("button", { name: "أرسل الفاتورة للعميل" }).click();
      await ex.poll(async () => (await sql<{ status: string }>("select status from invoices where id = $1", [dr.id]))[0].status).toBe("issued");
    }
    await emp.goto(`/admin/requests/${reqId}?t=${Date.now()}`);
    await emp.getByRole("button", { name: "إغلاق الطلب" }).click();
    await ex(statusBadge(emp, "مغلق")).toBeVisible();
    // messages are immutable
    const [note] = await sql<{ id: string }>("insert into request_notes (request_id, waqf_id, author_id, body) values ($1, $2, $3, 'رسالة اختبار') returning id", [reqId, demo().waqfs.A, demo().users.nazir.id]);
    await expect(sql("update request_notes set body = 'x' where id = $1", [note.id])).rejects.toThrow(/append-only/);
  });

  test("finance lists the invoices; staff without admin.finance are kept out", async ({ browser, viewport }) => {
    const page = await as(browser, "admin", viewport);
    await page.goto("/admin/finance");
    await ex(page.getByRole("heading", { level: 1, name: "الفواتير والمدفوعات" })).toBeVisible();
    await ex(page.locator(`a[href="/admin/finance/${invoiceId}"]`).first()).toBeVisible();
    const emp = await as(browser, "emp1", viewport);
    await emp.goto("/admin/finance");
    await ex(emp).not.toHaveURL(/\/admin\/finance/);
  });
});
