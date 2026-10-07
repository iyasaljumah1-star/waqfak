import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

/**
 * Logs in once per 30 minutes per account and reuses the session cookies: OTP sending is rate-limited
 * (4 per phone per 10 minutes) and other specs log in as the same demo users.
 */
async function signedIn(page: Page, key: string) {
  const file = path.join(tmpdir(), `waqfak-e2e-assessment-${key}.json`);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < 30 * 60_000) {
    await page.context().addCookies(JSON.parse(readFileSync(file, "utf8")));
    const r = await page.goto("/app");
    if (r && new URL(page.url()).pathname.startsWith("/app")) return;
  }
  await loginAs(page, key);
  writeFileSync(file, JSON.stringify(await page.context().cookies()));
}

/**
 * Assessment E2E:
 *  1) anonymous visitor completes a quick assessment and sees the result (with disclaimer, radar, waves);
 *  2) nazir runs an assessment for waqf A, sees recommendations, turns one into a request
 *     (lands on /app/requests/new with the service prefilled), and downloads the PDF report.
 */

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/assessment-${name}-${test.info().project.name}.png`, fullPage: true });

/**
 * Answers every visible question on the current step. `pick` chooses which main option to select
 * (so different runs produce weaknesses and therefore recommendations). Re-queries after each answer
 * because conditional questions can appear.
 */
async function answerStep(page: Page, pick: (i: number, count: number) => number) {
  const section = page.locator("section[aria-labelledby='step-title']");
  for (let i = 0; i < 80; i++) {
    const fieldsets = section.locator("fieldset[id^='q-']");
    const n = await fieldsets.count();
    if (i >= n) break;
    const fs = fieldsets.nth(i);
    await fs.scrollIntoViewIfNeeded();
    const date = fs.locator("input[type=date]");
    if (await date.count()) {
      if (!(await date.inputValue())) await date.fill("2024-01-15");
      continue;
    }
    const boxes = fs.locator("input[type=checkbox]");
    if (await boxes.count()) {
      if (!(await fs.locator("input[type=checkbox]:checked").count())) await boxes.first().check();
      continue;
    }
    const radios = fs.locator("input[type=radio]");
    const rc = await radios.count();
    if (rc) {
      if (await fs.locator("input[type=radio]:checked").count()) continue; // prefilled from the waqf file
      // main options exclude "لا أعلم" / "لا ينطبق" (rendered after the main ones)
      const values = await radios.evaluateAll((els) => els.map((e) => (e as HTMLInputElement).value));
      const main = values.map((v, k) => ({ v, k })).filter((x) => x.v !== "unknown" && x.v !== "na");
      await radios.nth(main[pick(i, main.length) % main.length].k).check();
      continue;
    }
    const text = fs.locator("input[type=text], input[type=number]");
    if (await text.count()) {
      await text.first().fill("1");
      await text.first().blur();
    }
  }
}

async function completeRunner(page: Page, pick: (i: number, count: number) => number) {
  await expect(page.getByRole("progressbar", { name: "نسبة الإجابة" })).toBeVisible();
  for (let step = 0; step < 20; step++) {
    const calc = page.getByRole("button", { name: "احسب النتيجة" });
    if (await calc.isVisible()) break;
    await answerStep(page, pick);
    await page.getByRole("button", { name: /^(التالي|راجع قبل الحساب)/ }).click();
    await expect(page.locator("#step-title")).toBeVisible();
  }
  await expect(page.getByRole("heading", { name: "راجع إجاباتك قبل الحساب" })).toBeVisible();
  await shot(page, "review");
  await page.getByRole("button", { name: "احسب النتيجة" }).click();
}

test("anonymous visitor completes a quick assessment and sees the result", async ({ page }) => {
  await page.goto("/assessment");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("اعرف أين يقف وقفك");
  await expect(page.getByText("تشخيص، لا فتوى ولا رأي قانوني ملزم")).toBeVisible();
  // deep requires login
  await expect(page.locator("input[name=kind][value=deep]")).toBeDisabled();
  await shot(page, "start");
  await page.getByLabel("اسم مختصر للوقف (اختياري)").fill("وقف اختبار (تجريبي)");
  await page.getByRole("button", { name: "ابدأ التقييم" }).click();
  await page.waitForURL(/\/assessment\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;

  // profile must be complete before moving on
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "أجب عن أسئلة ملف الوقف" })).toBeVisible();

  // conditional question: P02B appears only for private waqfs
  await expect(page.locator("#q-P02B")).toHaveCount(0);
  await page.locator("#q-P02 input[value=private]").check();
  await expect(page.locator("#q-P02B")).toBeVisible();
  await page.locator("#q-P02 input[value=public]").check();
  await expect(page.locator("#q-P02B")).toHaveCount(0);

  await answerStep(page, (i) => i);
  await shot(page, "profile");

  // autosave + resume: reload keeps answers
  await page.waitForTimeout(800);
  await page.reload();
  await expect(page.locator("#q-P02 input[value=public]")).toBeChecked();

  // "yes" (index 0) for most → strong; "no" for every third question → some weaknesses
  await completeRunner(page, (i) => (i % 3 === 2 ? 1 : 0));
  await page.waitForURL(new RegExp(`/assessment/${id}/result$`));

  await expect(page.getByRole("heading", { name: "نتيجة التقييم الوقفي" })).toBeVisible();
  await expect(page.getByRole("img", { name: /الدرجة الكلية \d+ من 100/ })).toBeVisible();
  await expect(page.getByRole("img", { name: /مخطط عنكبوتي لدرجات محاور التقييم/ })).toBeVisible();
  await expect(page.getByText("مؤشر النضج").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "ما الذي تفعله الآن؟" })).toBeVisible();
  await expect(page.getByText("هذا تشخيص استرشادي، وليس فتوى شرعية ولا رأيًا قانونيًا ملزمًا.")).toBeVisible();
  await expect(page.getByRole("link", { name: "أنشئ حسابًا" })).toBeVisible();
  await shot(page, "anon-result");

  // the anonymous PDF works from the same browser
  const pdf = await page.request.get(`/api/reports/assessment/${id}`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");

  // another browser (no cookie) cannot see it
  const other = await page.context().browser()!.newContext();
  const op = await other.newPage();
  const res = await op.goto(`/assessment/${id}/result`);
  expect(res?.status()).toBe(404);
  await expect(op.getByRole("heading", { name: "نتيجة التقييم الوقفي" })).toHaveCount(0);
  await other.close();
});

test("nazir assesses waqf A, converts a recommendation into a request and downloads the PDF", async ({ page }) => {
  const d = demo();
  const waqfA = d.waqfs.A;
  await signedIn(page, "nazir");
  await page.goto(`/assessment?waqf=${waqfA}`);
  await expect(page.locator(`input[name=waqf][value='${waqfA}']`)).toBeChecked();
  await page.getByRole("button", { name: "ابدأ التقييم" }).click();
  await page.waitForURL(/\/assessment\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await expect(page.getByText("عبّأنا بعض الإجابات من ملف الوقف")).toBeVisible();

  // mostly negative answers → critical flags and many recommendations
  await completeRunner(page, (i, count) => (i % 4 === 0 ? 0 : count - 1));
  await page.waitForURL(new RegExp(`/app/assessments/${id}$`));

  await expect(page.getByRole("heading", { name: "نتيجة التقييم الوقفي" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /علامات حرجة/ })).toBeVisible();
  await expect(page.getByText(/المرجع: /).first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "الآن", exact: true })).toBeVisible();
  await shot(page, "nazir-result");

  // PDF download
  const r = await page.request.get(`/api/reports/assessment/${id}`);
  expect(r.status()).toBe(200);
  expect(r.headers()["content-type"]).toBe("application/pdf");
  const body = await r.body();
  expect(body.subarray(0, 5).toString()).toBe("%PDF-");
  expect(body.length).toBeGreaterThan(20_000);
  await (await import("node:fs/promises")).writeFile(`test-results/assessment-report-${test.info().project.name}.pdf`, body);
  await expect(page.getByRole("link", { name: "نزّل التقرير PDF" })).toHaveAttribute("href", `/api/reports/assessment/${id}`);

  // the waqf's assessment history lists it
  await page.goto(`/app/w/${waqfA}/assessments`);
  await expect(page.getByRole("link", { name: new RegExp(id.slice(0, 8).toUpperCase(), "i") })).toBeVisible();
  await shot(page, "waqf-history");

  // convert one recommendation into a request
  await page.goto(`/app/assessments/${id}`);
  const req = page.getByRole("link", { name: "اطلب هذه الخدمة" }).first();
  await req.scrollIntoViewIfNeeded();
  const href = (await req.getAttribute("href"))!;
  const service = new URL(href, "http://x").searchParams.get("service")!;
  expect(href).toContain(`waqf=${waqfA}`);
  expect(href).toMatch(/rec=[0-9a-f-]{36}/);
  await req.click();
  await page.waitForURL(/\/app\/requests\/new\?/);
  const url = new URL(page.url());
  expect(url.searchParams.get("service")).toBe(service);
  await expect(page.getByText("من توصية التقييم")).toBeVisible();
  await shot(page, "request-new");
});

test("staff reviews a deep assessment: evidence, notes, dismissal, approval", async ({ page, browser }) => {
  test.setTimeout(300_000); // the deep bank has about twice the questions
  const d = demo();
  await signedIn(page, "nazir");
  await page.goto(`/assessment?kind=deep&waqf=${d.waqfs.A}`);
  await expect(page.locator("input[name=kind][value=deep]")).toBeChecked();
  await page.getByRole("button", { name: "ابدأ التقييم" }).click();
  await page.waitForURL(/\/assessment\/[0-9a-f-]{36}$/);
  const id = page.url().split("/").pop()!;
  await completeRunner(page, (i, count) => (i % 2 ? count - 1 : 0));
  await page.waitForURL(new RegExp(`/app/assessments/${id}$`));
  await expect(page.getByText("بانتظار مراجعة مختص")).toBeVisible();

  const staff = await (await browser.newContext({ ...test.info().project.use })).newPage();
  await signedIn(staff, "admin");
  await staff.goto("/admin/assessments");
  await expect(staff.getByRole("heading", { name: "التقييمات المعمّقة" })).toBeVisible();
  await staff.getByRole("link", { name: id.slice(0, 8).toUpperCase(), exact: false }).click();
  await staff.waitForURL(new RegExp(`/admin/assessments/${id}$`));
  await shot(staff, "admin-review");

  // adjust evidence on the first scored answer and recompute
  const group = staff.locator("details").filter({ has: staff.locator("select[name^=ev_]") }).first();
  if (!(await group.getAttribute("open"))) await group.locator("summary").click();
  const ev = group.locator("select[name^=ev_]").first();
  await ev.selectOption("verified");
  await staff.getByRole("button", { name: "احفظ الإثبات وأعد الحساب" }).click();
  await expect(staff.getByText(/حدّثنا الإثبات لـ1 إجابة وأعدنا الحساب/)).toBeVisible();

  // dismiss one recommendation with a reason
  const reason = staff.getByPlaceholder("سبب الاستبعاد (يراه العميل)").first();
  await reason.fill("عولج قبل التقييم بحسب المستندات (تجريبي)");
  await staff.getByRole("button", { name: "استبعد" }).first().click();
  await expect(staff.getByText("مستبعدة: عولج قبل التقييم بحسب المستندات (تجريبي)")).toBeVisible();

  await staff.getByLabel("الملخص للعميل").fill("ابدأ بفصل الحساب البنكي وتسجيل الوقف خلال الموجة الأولى. (تجريبي)");
  await staff.getByRole("button", { name: "احفظ الملاحظات" }).click();
  await expect(staff.getByText("حفظنا ملاحظات المراجعة.")).toBeVisible();
  await staff.getByRole("button", { name: "اعتمد المراجعة وأبلغ العميل" }).click();
  await expect(staff.getByText(/اعتمدنا المراجعة/)).toBeVisible();
  await staff.context().close();

  // the client now sees the reviewed result
  await page.reload();
  await expect(page.getByText("روجع من مختص").first()).toBeVisible();
  await expect(page.getByText("ابدأ بفصل الحساب البنكي وتسجيل الوقف خلال الموجة الأولى. (تجريبي)")).toBeVisible();
  await expect(page.getByText("استبعدها المراجع: عولج قبل التقييم بحسب المستندات (تجريبي)")).toBeAttached();
  await shot(page, "reviewed-result");
});
