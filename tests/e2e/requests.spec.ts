import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * Services → request → workflow → contract → invoice → sandbox payment, plus request isolation (scenario 5).
 * Runs serially; each actor keeps one cached session (OTP sends are rate-limited).
 */

const shots = "/tmp/claude-0/shots";
// The dev server compiles routes on first hit and two CPUs are shared; give UI assertions room.
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

/** Test setup only: OTP sends are limited per phone/IP and other suites share the demo phones and localhost. */
async function resetOtpLimits(phone: string) {
  const db = ownerDb();
  await db.connect();
  const norm = `+966${phone.replace(/\D/g, "").replace(/^0/, "")}`;
  await db.query("delete from rate_limits where key = $1 or key like 'otp:ip:%'", [`otp:target:${norm}`]);
  await db.end();
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

const statusBadge = (page: Page, label: string) => page.getByText(label, { exact: true }).first();

test.describe.serial("service requests end to end", () => {
  test.setTimeout(180_000);
  let reqId = "";
  let reqNumber = "";
  let noWaqfReqId = "";
  let invoiceUrl = "";

  test.afterAll(async () => {
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("catalog shows the quote label and gates N01 behind its flag", async ({ browser, viewport }, info) => {
    const page = await as(browser, "nazir", viewport);
    await page.goto("/app/services");
    await ex(page.getByRole("heading", { level: 1, name: "الخدمات والباقات" })).toBeVisible();
    await ex(page.getByText("عرض سعر بعد الدراسة").first()).toBeVisible();
    // N01 (nazara) is behind service.nazara (off): visible, but not requestable
    await ex(page.locator('a[href^="/app/requests/new?service=N01"]')).toHaveCount(0);
    await ex(page.locator('a[href^="/app/requests/new?service=C02"]')).toHaveCount(1);
    await page.goto("/app/requests/new?service=N01");
    await ex(page.getByText("الخدمة غير متاحة حاليًا").first()).toBeVisible();
    await page.screenshot({ path: `${shots}/req-catalog-${info.project.name}.png`, fullPage: false });
  });

  test("nazir creates a request on waqf A, uploads a document and tracks it", async ({ browser, viewport }, info) => {
    const page = await as(browser, "nazir", viewport);
    await page.goto(`/app/requests/new?service=C02&waqf=${demo().waqfs.A}`);
    await ex(page.getByLabel("الوقف")).toHaveValue(demo().waqfs.A);
    await page.getByLabel("تفاصيل الطلب").fill("نحتاج مراجعة امتثال سنوية قبل نهاية السنة المالية (اختبار آلي).");
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?created=1/);
    reqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await ex(page.getByText("أُرسل طلبك")).toBeVisible();
    reqNumber = (await page.locator("header [dir=ltr].tabular").first().innerText()).trim();
    expect(reqNumber).toMatch(/^REQ-\d+/);
    await ex(statusBadge(page, "مُرسل")).toBeVisible();

    await page.getByTestId("document-file-input").setInputFiles({ name: "waqf-deed.pdf", mimeType: "application/pdf", buffer: minimalPdf(`deed ${Date.now()}`) });
    await ex(page.getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible({ timeout: 30_000 });
    await page.reload();
    await ex(page.getByText("waqf-deed", { exact: false }).first()).toBeVisible();
    await page.screenshot({ path: `${shots}/req-client-${info.project.name}.png`, fullPage: true });

    // A waqf-less request (isolation check later: RLS lets every user read rows with waqf_id NULL)
    await page.goto("/app/requests/new?service=C01");
    await page.getByLabel("الوقف").selectOption("none");
    await page.getByLabel("تفاصيل الطلب").fill("استشارة أولية بلا وقف قائم (اختبار آلي للعزل).");
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?created=1/);
    noWaqfReqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];

    await page.goto("/app/requests");
    await ex(page.getByRole("link", { name: reqNumber })).toBeVisible();
  });

  test("ops assigns the request to emp1", async ({ browser, viewport }, info) => {
    const page = await as(browser, "ops", viewport);
    await page.goto("/admin/requests?tab=unassigned");
    await ex(page.getByRole("link", { name: reqNumber })).toBeVisible();
    await page.goto(`/admin/requests/${reqId}`);
    const select = page.getByLabel("الموظف");
    const value = await select.locator("option", { hasText: "موظف أول" }).first().getAttribute("value");
    await select.selectOption(value!);
    await page.getByRole("button", { name: "أسند", exact: true }).click();
    await ex(page.getByText(/أُسند الطلب إلى/).first()).toBeVisible();
    await ex(statusBadge(page, "قيد الفرز")).toBeVisible();
    await page.screenshot({ path: `${shots}/req-admin-${info.project.name}.png`, fullPage: true });
  });

  test("emp1 sees only assigned requests and cannot open emp2's or unassigned ones", async ({ browser, viewport }) => {
    const page = await as(browser, "emp1", viewport);
    const db = ownerDb();
    await db.connect();
    const { rows } = await db.query("select id from service_requests where assigned_to_user_id = $1 limit 1", [demo().users.emp2.id]);
    await db.end();
    expect(rows.length).toBeGreaterThan(0);
    const emp2Req = rows[0].id as string;

    await page.goto("/admin/requests");
    await ex(page.getByRole("link", { name: reqNumber })).toBeVisible();
    await ex(page.getByRole("link", { name: "غير مسندة" })).toHaveCount(0);

    for (const id of [emp2Req, noWaqfReqId]) {
      const res = await page.goto(`/admin/requests/${id}`);
      // /admin streams (admin/loading.tsx): notFound() may arrive with 200; what matters is that nothing leaks.
      expect([200, 404], `staff view of ${id}`).toContain(res?.status());
      await expect(page.getByText("لم نجد ما طلبته")).toBeVisible();
      // /app streams (loading.tsx), so notFound() renders the not-found UI with status 200 or 404
      const res2 = await page.goto(`/app/requests/${id}`);
      expect([200, 404]).toContain(res2?.status());
      await ex(page.getByText("الصفحة غير موجودة")).toBeVisible();
      await ex(page.getByText("بيانات الطلب")).toHaveCount(0);
    }
    // No access to waqf C data
    await page.goto(`/app/w/${demo().waqfs.C}`);
    await ex(page).not.toHaveURL(new RegExp(`/app/w/${demo().waqfs.C}`));
    await page.goto(`/app/billing/00000000-0000-4000-8000-000000000000`);
    await ex(page.getByText("الصفحة غير موجودة")).toBeVisible();
  });

  test("emp1 sends a quote; nazir accepts", async ({ browser, viewport }) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}`);
    await emp.getByLabel("المبلغ قبل الضريبة (ر.س)").fill("1000");
    await emp.getByRole("button", { name: "احفظ العرض" }).click();
    await ex(emp.getByText("أُرسل عرض السعر للعميل.")).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}`);
    await ex(naz.getByText(/1[,٬]?150/).first()).toBeVisible(); // 1000 + VAT 15%
    await naz.getByRole("button", { name: "أقبل عرض السعر" }).click();
    await ex(statusBadge(naz, "بانتظار العقد")).toBeVisible();
  });

  test("emp1 issues the contract; nazir signs it with an OTP", async ({ browser, viewport }, info) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}`);
    await emp.getByRole("button", { name: "أنشئ العقد وأرسله" }).click();
    await ex(emp.getByText("بانتظار توقيع العميل")).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}`);
    await ex(naz.getByText(/SHA-256: [0-9a-f]{64}/)).toBeVisible();
    await resetOtpLimits(demo().users.nazir.phone);
    await naz.getByRole("button", { name: "أرسل رمز التوقيع" }).click();
    const code = (await naz.getByTestId("demo-otp").innerText()).trim();
    await naz.getByLabel("رمز التوقيع").fill(code);
    await naz.getByLabel(/قرأت نص العقد كاملًا/).check();
    await naz.getByRole("button", { name: "وقّع العقد" }).click();
    await naz.waitForURL(/\?signed=1/);
    await ex(naz.getByText("تم توقيع العقد", { exact: true })).toBeVisible();
    await ex(naz.getByText(/وقّعه العميل/).first()).toBeVisible();
    await naz.screenshot({ path: `${shots}/req-contract-${info.project.name}.png`, fullPage: true });
  });

  test("emp1 issues the invoice and starts work; nazir pays in the sandbox", async ({ browser, viewport }, info) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}`);
    await emp.getByRole("button", { name: "أصدر الفاتورة" }).click();
    await ex(emp.getByText(/صدرت الفاتورة INV-/).first()).toBeVisible();
    await emp.getByRole("button", { name: "بدء التنفيذ بعد توقيع العقد" }).click();
    await ex(statusBadge(emp, "قيد التنفيذ")).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}`);
    await naz.getByRole("link", { name: "ادفع" }).first().click();
    await naz.waitForURL(/\/app\/billing\/[0-9a-f-]{36}$/);
    invoiceUrl = naz.url();
    await ex(naz.getByText("فاتورة ضريبية مبسطة")).toBeVisible();
    await ex(naz.getByText("ضريبة القيمة المضافة (15%)")).toBeVisible();
    await ex(naz.getByTestId("einvoice-status")).toContainText("لم تُرسل");
    await ex(naz.getByRole("img", { name: /رمز الاستجابة السريعة/ })).toBeVisible();
    await naz.screenshot({ path: `${shots}/req-invoice-${info.project.name}.png`, fullPage: true });
    await naz.getByRole("button", { name: "ادفع الآن" }).click();
    await naz.waitForURL(/\/pay\?payment=/);
    await ex(naz.getByText("بيئة تجريبية — لا تُخصم أي مبالغ")).toBeVisible();
    await naz.getByRole("button", { name: "4111111111111111" }).click();
    await naz.getByLabel("تاريخ الانتهاء").fill("12/29");
    await naz.getByLabel("رمز التحقق CVC").fill("123");
    await naz.getByRole("button", { name: "ادفع (تجريبي)" }).click();
    await naz.waitForURL(/\?paid=1/);
    await ex(naz.getByText("تم السداد")).toBeVisible();
    await ex(naz.getByText("مدفوعة").first()).toBeVisible();
  });

  test("delivery, four-eyes QA by ops, client approval, rating and close", async ({ browser, viewport }) => {
    const emp = await as(browser, "emp1", viewport);
    await emp.goto(`/admin/requests/${reqId}`);
    await emp.getByLabel("عنوان المخرج").fill("تقرير الامتثال (اختبار)");
    await emp.getByRole("button", { name: "سجّل المخرج" }).click();
    await ex(emp.getByText("أُضيف المخرج.")).toBeVisible();
    await emp.getByRole("button", { name: "إرسال لمراجعة الجودة" }).click();
    await ex(statusBadge(emp, "مراجعة الجودة")).toBeVisible();
    // emp1 (deliverer, no QA permission) cannot approve quality
    await ex(emp.getByRole("button", { name: "اعتماد الجودة وإرسال للعميل" })).toHaveCount(0);

    const ops = await as(browser, "ops", viewport);
    await ops.goto(`/admin/requests/${reqId}`);
    await ops.getByRole("button", { name: "اعتماد الجودة وإرسال للعميل" }).click();
    await ex(statusBadge(ops, "بانتظار اعتماد العميل")).toBeVisible();

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}`);
    await naz.getByRole("button", { name: "أعتمد المخرجات" }).click();
    await ex(statusBadge(naz, "مكتمل")).toBeVisible();
    await naz.getByRole("radio", { name: "5 من 5" }).click();
    await naz.getByRole("button", { name: "أرسل التقييم" }).click();
    await ex(naz.getByText("شكرًا لتقييمك.")).toBeVisible();

    await emp.goto(`/admin/requests/${reqId}`);
    await emp.getByRole("button", { name: "إغلاق الطلب" }).click();
    await ex(statusBadge(emp, "مغلق")).toBeVisible();
  });

  test("finance sees the paid invoice and receivables", async ({ browser, viewport }, info) => {
    const page = await as(browser, "admin", viewport);
    await page.goto("/admin/finance");
    await ex(page.getByRole("heading", { level: 1, name: "الفواتير والمدفوعات" })).toBeVisible();
    const invId = invoiceUrl.split("/").pop()!;
    await ex(page.locator(`a[href="/admin/finance/${invId}"]`).first()).toBeVisible();
    await page.screenshot({ path: `${shots}/finance-${info.project.name}.png`, fullPage: true });
    await page.goto("/admin/finance?tab=payments");
    await ex(page.getByText("بيئة تجريبية").first()).toBeVisible();
    await page.goto("/admin/finance?tab=receivables");
    await ex(page.getByText("أعمار الذمم")).toBeVisible();
    // emp1 has no admin.finance
    const emp = await as(browser, "emp1", viewport);
    await emp.goto("/admin/finance");
    await ex(emp).not.toHaveURL(/\/admin\/finance/);
  });
});
