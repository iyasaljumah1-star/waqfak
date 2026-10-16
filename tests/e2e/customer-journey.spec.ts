import { readFileSync } from "node:fs";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, uniquePhone } from "./helpers";

/**
 * Customer-journey order — the 22 scenarios, end to end through the real UI, on synthetic data only.
 * One fresh client per project (desktop / mobile) establishes a waqf with a board, leaves, comes back, follows the
 * gaps, documents the waqf with evidence, edits an earlier stage; a demo chair runs the governance part on waqf C.
 * The W01 will types (10–12) and the full meeting/vote/minutes/task cycle (17–18) have their own specs
 * (output-quality, execution, governance); this spec adds what they do not cover.
 */

const expect = baseExpect.configure({ timeout: 60_000 });
const T = 120_000;
const envLine = (k: string) => readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${k}=`))!.slice(k.length + 1).trim();
async function sql<R = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<R[]> {
  const db = new pg.Client({ connectionString: envLine("DATABASE_OWNER_URL") });
  await db.connect();
  try { return (await db.query(q, params)).rows as R[]; } finally { await db.end(); }
}
const shot = (page: Page, name: string) => page.screenshot({ path: `storage/.e2e-shots/journey/${test.info().project.name}-${name}.png`, fullPage: true });
const pdf = (s: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${s}\ntrailer << /Root 1 0 R >>\n%%EOF`);

async function otpLogin(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel("رقم الجوال").fill(phone);
  await page.getByRole("button", { name: "أرسل رمز الدخول" }).click();
  await page.waitForURL(/\/verify/, { timeout: T });
  const code = (await page.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(code);
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL(/\/app/, { timeout: T });
}
async function signup(page: Page, name: string) {
  const phone = uniquePhone();
  await page.goto("/signup");
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("رقم الجوال").fill(phone);
  await page.getByLabel(/قرأت/).check();
  await page.getByRole("button", { name: "أنشئ الحساب" }).click();
  await page.waitForURL(/\/verify/, { timeout: T });
  const code = (await page.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(code);
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL(/\/app/, { timeout: T });
  return phone;
}
/** The logout form exists on every portal page (sidebar on desktop, account menu on mobile). */
async function logout(page: Page) {
  await page.goto("/app");
  await Promise.all([
    page.waitForURL(/\/(login|$)|\/\?/, { timeout: T }).catch(() => undefined),
    page.locator('form:has(button:has-text("تسجيل الخروج"))').first().evaluate((f: HTMLFormElement) => f.requestSubmit()),
  ]);
  await page.goto("/app");
  await page.waitForURL(/\/login/, { timeout: T });
}
const next = (page: Page) => page.getByRole("button", { name: "التالي" }).click();
const noHorizontalScroll = async (page: Page) => expect(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth)).toBeLessThanOrEqual(1);

/** Opens every gap of the journey and checks that it lands on the form or section that settles it. */
async function followGaps(page: Page, waqfId: string) {
  await page.goto(`/app/w/${waqfId}`);
  const links = page.getByTestId("journey-gaps").locator("a[data-gap]");
  const gaps = await links.evaluateAll((as) => as.map((a) => ({ key: a.getAttribute("data-gap")!, href: a.getAttribute("href")! })));
  expect(gaps.length).toBeGreaterThan(0);
  for (const g of gaps) {
    await page.goto(g.href);
    const url = new URL(page.url());
    const anchor = g.href.split("#")[1];
    const step = /[?&]step=(\d)/.exec(g.href)?.[1];
    if (step) await expect(page.getByTestId(`wizard-step-${step}`), `gap ${g.key} → wizard step ${step}`).toBeVisible();
    if (anchor) await expect(page.locator(`[id="${anchor}"]`).first(), `gap ${g.key} → #${anchor}`).toBeAttached();
    const upload = /upload=([a-z_]+)/.exec(g.href)?.[1];
    if (upload) await expect(page.locator("#upload select[name=docType]"), `gap ${g.key} preselects ${upload}`).toHaveValue(upload);
    if (/[?&]edit=1/.test(g.href) && anchor === "edit") await expect(page.getByTestId("edit-asset-form")).toBeVisible();
    if (/[?&]add=1/.test(g.href)) await expect(page.getByTestId("add-asset-form")).toBeVisible();
    expect(url.pathname, `gap ${g.key} stays on its waqf`).toContain(waqfId);
  }
  return gaps;
}

test.describe.configure({ mode: "serial" });
test.use({ navigationTimeout: T });

let phone = "";
let waqfId = "";
const name = `وقف رحلة العميل (تجريبي ${Date.now() % 100000})`;

test("1–5, 13: draft, typed assets refused until complete, logout/login, resume from «أوقافي», no duplicate", async ({ page }) => {
  test.setTimeout(900_000);
  phone = await signup(page, "واقف رحلة (تجريبي)");
  await page.goto("/app/establish");
  await page.getByRole("button", { name: "ابدأ وقفًا جديدًا" }).click();
  await page.waitForURL(/\/app\/establish\/[0-9a-f-]{36}\?step=1/, { timeout: T });
  waqfId = page.url().match(/establish\/([0-9a-f-]{36})/)![1];

  // 1. a draft exists after the first step and carries the client's answers
  await page.getByLabel(/ذريتي أو أقاربي/).check();
  await page.getByLabel("لا، لهم جميعًا").check();
  await page.getByLabel("نعم", { exact: true }).check();
  await next(page);
  await page.waitForURL(/step=2/, { timeout: T });
  await next(page);
  await page.waitForURL(/step=3/, { timeout: T });

  // 6–8 in the wizard + 13: three types, each with its own fields; incomplete rows stop the step
  const s3 = page.getByTestId("wizard-step-3");
  await s3.locator("#as-0-category").selectOption("real_estate");
  await expect(s3.locator("#as-0-ownershipDocNo")).toBeVisible();
  await s3.locator("#as-0-title").fill("أرض تجريبية للرحلة");
  await s3.locator("#as-0-propertyType").selectOption("land");
  await s3.locator("#as-0-city").fill("الرياض");
  await s3.getByRole("button", { name: /أضف أصلًا/ }).click();
  await s3.locator("#as-1-category").selectOption("movable");
  await expect(s3.locator("#as-1-ownershipDocNo")).toHaveCount(0); // no deed for a movable
  await s3.locator("#as-1-title").fill("مكتبة مخطوطات تجريبية");
  await s3.locator("#as-1-movableCategory").selectOption("books");
  await s3.locator("#as-1-quantity").fill("120");
  await s3.locator("#as-1-unit").fill("مجلد");
  await s3.locator("#as-1-location").fill("مستودع تجريبي");
  await s3.getByRole("button", { name: /أضف أصلًا/ }).click();
  await s3.locator("#as-2-category").selectOption("portfolio");
  await s3.locator("#as-2-title").fill("محفظة تجريبية");
  await s3.locator("#as-2-institution").fill("شركة وساطة تجريبية");
  await s3.locator("#as-2-portfolioRef").fill("1234567890"); // a full reference is refused
  await s3.locator("#as-2-management").selectOption("custody");
  await next(page);
  await expect(page.getByText(/ينقص المساحة \(م²\)، رقم صك الملكية/).first()).toBeVisible({ timeout: T });
  await expect(page.getByText(/آخر 4 أرقام/).first()).toBeVisible();
  expect(page.url()).toContain("step=3");
  await shot(page, "assets-refused");
  await s3.locator("#as-0-areaSqm").fill("600");
  await s3.locator("#as-0-ownershipDocNo").fill("4410000099");
  await s3.locator("#as-2-portfolioRef").fill("7890");
  await page.getByRole("button", { name: "احفظ واخرج" }).click();
  await page.waitForURL(/\/app\/establish\?saved=/, { timeout: T });

  // 2. logout, login again: the draft is still there with its data
  await logout(page);
  await otpLogin(page, phone);

  // 3. «أوقافي» shows the draft with its journey status and a resume link to the first incomplete step
  await page.goto("/app/waqfs");
  await expect(page.getByText("بانتظار استكمال العميل").first()).toBeVisible();
  await page.getByTestId("list-resume").first().click();
  await page.waitForURL(new RegExp(`/app/establish/${waqfId}\\?step=4`), { timeout: T });
  await page.goto(`/app/establish/${waqfId}?step=3`);
  await expect(page.locator("#as-0-areaSqm")).toHaveValue("600");
  await expect(page.locator("#as-1-unit")).toHaveValue("مجلد");
  await expect(page.locator("#as-2-portfolioRef")).toHaveValue("7890");

  // the waqf page explains where it stopped, who acts, and resumes
  await page.goto(`/app/w/${waqfId}`);
  await expect(page.getByTestId("journey")).toHaveAttribute("data-status", "awaiting_client");
  await expect(page.getByTestId("journey-current")).toBeVisible();
  await expect(page.getByTestId("draft-banner")).toBeVisible();
  await expect(page.getByTestId("resume-establishment")).toHaveAttribute("href", new RegExp(`/app/establish/${waqfId}\\?step=4`));
  await noHorizontalScroll(page);
  await shot(page, "journey-draft");

  // 4. every gap opens the step or form that settles it
  await followGaps(page, waqfId);

  // 5. no duplicate: the establish page resumes the open draft instead of creating another
  await page.goto("/app/establish");
  await expect(page.getByTestId("resume-draft")).toBeVisible();
  await expect(page.getByRole("button", { name: "ابدأ وقفًا جديدًا" })).toHaveCount(0);
  const owned = await sql<{ n: number }>("select count(*)::int n from waqfs w join users u on u.id = w.created_by where u.phone in ($1, $2)", [phone, `+966${phone.slice(1)}`]);
  expect(owned[0].n).toBe(1);

  // 13 (server side): approving before the data is complete is refused
  await page.goto(`/app/establish/${waqfId}?step=7`);
  await page.getByRole("button", { name: "اعتمد المسودة وأنشئ ملف الوقف" }).click();
  await expect(page.getByText(/أكمل قبل الاعتماد/).first()).toBeVisible({ timeout: T });
  expect((await sql<{ s: string }>("select status s from waqfs where id = $1", [waqfId]))[0].s).toMatch(/idea|draft/);
  await page.context().storageState({ path: clientState() });
});

test("16: board from the wizard with members and roles; the founder completes the file while establishing", async ({ browser }) => {
  test.setTimeout(900_000);
  const page = await clientPage(browser);
  await page.goto(`/app/establish/${waqfId}?step=4`);
  const s4 = page.getByTestId("wizard-step-4");
  await s4.locator('input[name="c.name"]').first().fill("أولاد الواقف (تجريبي)");
  await page.getByLabel("المآل إذا انقطع المستحقون").fill("الفقراء والمساكين");
  await next(page);
  await page.waitForURL(/step=5/, { timeout: T });

  // a board needs three members and one chair
  await page.getByLabel("صيغة النظارة").selectOption("board");
  const board = page.locator("#board");
  const member = async (k: number, n: string, role: string, email = "") => {
    await board.getByRole("button", { name: "أضف عضوًا" }).click();
    await page.locator(`#m-${k}-name`).fill(n);
    await page.locator(`#m-${k}-role`).selectOption(role);
    if (email) await page.locator(`#m-${k}-email`).fill(email);
  };
  await member(0, "رئيس مجلس الرحلة (تجريبي)", "chair", "chair.journey@example.test");
  await member(1, "عضو الرحلة (تجريبي)", "member");
  await next(page);
  await expect(page.getByText(/ثلاثة أعضاء فأكثر \(أُدخل 2\)/).first()).toBeVisible({ timeout: T });
  await member(2, "أمين سر الرحلة (تجريبي)", "secretary");
  await next(page);
  await page.waitForURL(/step=6/, { timeout: T });
  await next(page);
  await page.waitForURL(/step=7/, { timeout: T });
  await page.getByLabel("اسم الوقف كما تريده في الوثيقة").fill(name);
  await page.getByRole("button", { name: "احفظ الاسم" }).click();
  await page.waitForURL(/step=7/, { timeout: T });
  await expect(page.getByTestId("deed-draft")).toContainText("مجلس نظارة من 3 أعضاء");
  await page.getByRole("button", { name: "اعتمد المسودة وأنشئ ملف الوقف" }).click();
  await page.waitForURL(/done=1/, { timeout: T });

  // 16. the board exists in the file with its members and roles
  await page.goto(`/app/w/${waqfId}/parties#bodies`);
  for (const n of ["رئيس مجلس الرحلة (تجريبي)", "عضو الرحلة (تجريبي)", "أمين سر الرحلة (تجريبي)"]) await expect(page.getByText(n).first()).toBeVisible();
  if (!test.info().project.name.includes("mobile")) await expect(page.getByText("chair.journey@example.test").first()).toBeVisible(); // contact column (hidden on narrow screens) for whoever manages governance
  // assets were created with their types
  await page.goto(`/app/w/${waqfId}/assets`);
  await expect(page.getByText("أرض تجريبية للرحلة").first()).toBeVisible();
  await expect(page.getByText("مكتبة مخطوطات تجريبية").first()).toBeVisible();
  await expect(page.getByText(/120 مجلد/).first()).toBeVisible();
  await page.getByRole("link", { name: "محفظة تجريبية" }).first().click();
  await expect(page.getByText("••••7890").first()).toBeVisible();
  await expect(page.locator("body")).not.toContainText("1234567890");
  await page.goto(`/app/w/${waqfId}`);
  await expect(page.getByTestId("establishing-founder")).toBeVisible();

});

test("9, 15, 21: other asset types in the file; editing an earlier stage brings it back; save and upload errors", async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await clientPage(browser);
  // 9. cash needs its amount; the message names what is missing
  await page.goto(`/app/w/${waqfId}/assets?add=1#add-asset`);
  const add = page.getByTestId("add-asset-form");
  const msg = add.locator('[role="alert"], [role="status"]').first();
  await add.locator("#new-category").selectOption("cash");
  await expect(add.locator("#new-ownershipDocNo")).toHaveCount(0);
  await add.locator("#new-title").fill("مبلغ نقدي تجريبي");
  await add.locator("#new-currency").selectOption("SAR");
  await add.locator("#new-holding").selectOption("bank_account");
  await add.getByRole("button", { name: "أضف الأصل" }).click();
  // saved as incomplete with what it lacks; the form clears so a second click cannot duplicate it
  await expect(msg).toContainText("ينقصه لاكتماله: المبلغ", { timeout: T });
  await expect(add.locator("#new-category")).toHaveValue("");
  expect((await sql<{ n: number }>("select count(*)::int n from assets where waqf_id = $1 and category = 'cash'", [waqfId]))[0].n).toBe(1);
  await add.getByTestId("complete-added-asset").click();
  const cashEd = page.getByTestId("edit-asset-form");
  await expect(cashEd).toBeVisible();
  await cashEd.locator('[id$="-value"]').fill("abc"); // 21. a wrong number is refused with a clear message, nothing saved
  await cashEd.getByRole("button", { name: "احفظ" }).click();
  await expect(cashEd.locator('[role="alert"]').first()).toBeVisible({ timeout: T });
  await cashEd.locator('[id$="-value"]').fill("50000");
  await cashEd.getByRole("button", { name: "احفظ" }).click();
  await expect(cashEd.getByRole("status")).toContainText("حُفظ الأصل", { timeout: T });
  await expect(cashEd.getByRole("status")).not.toContainText("ينقصه");
  const cash = (await sql<{ n: number; v: string }>("select count(*)::int n, max(market_value)::text v from assets where waqf_id = $1 and category = 'cash'", [waqfId]))[0];
  expect(cash.n).toBe(1);
  expect(Number(cash.v)).toBe(50000);
  // sukuk and usufruct have their own fields
  await page.goto(`/app/w/${waqfId}/assets?add=1#add-asset`);
  await add.locator("#new-category").selectOption("usufruct");
  await expect(add.locator("#new-endsOn")).toBeVisible();
  await expect(add.locator("#new-currency")).toHaveCount(0);
  await add.locator("#new-category").selectOption("sukuk");
  await expect(add.locator("#new-quantity")).toBeVisible();
  await expect(add.locator("#new-endsOn")).toHaveCount(0);

  // 15. edit an earlier stage: removing the land's city reopens the assets step and the journey goes back
  const [land] = await sql<{ id: string }>("select id from assets where waqf_id = $1 and category = 'real_estate' limit 1", [waqfId]);
  const stageBefore = (await sql<{ stage: number }>("select stage from waqfs where id = $1", [waqfId]))[0].stage;
  await page.goto(`/app/w/${waqfId}/assets/${land.id}?edit=1#edit`);
  const ed = page.getByTestId("edit-asset-form");
  await ed.locator('[id$="-city"]').fill("");
  await ed.getByRole("button", { name: "احفظ" }).click();
  await expect(ed.locator('[role="alert"], [role="status"]').first()).toContainText("المدينة", { timeout: T });
  await page.goto(`/app/w/${waqfId}`);
  const gap = page.getByTestId("journey-gaps").locator(`a[data-gap="assets:${land.id}"]`);
  await expect(gap).toHaveAttribute("href", `/app/w/${waqfId}/assets/${land.id}?edit=1#edit`);
  await expect(page.getByTestId("journey-steps").locator('[data-step="assets"]')).not.toHaveAttribute("data-state", "done");
  expect((await sql<{ stage: number }>("select stage from waqfs where id = $1", [waqfId]))[0].stage).toBeLessThanOrEqual(stageBefore);
  await gap.click();
  await expect(page.getByTestId("edit-asset-form")).toBeVisible();
  await page.getByTestId("edit-asset-form").locator('[id$="-city"]').fill("الرياض");
  await page.getByTestId("edit-asset-form").getByRole("button", { name: "احفظ" }).click();
  await expect(page.getByTestId("edit-asset-form").getByRole("status")).toBeVisible({ timeout: T });
  await page.goto(`/app/w/${waqfId}`);
  await expect(page.getByTestId("journey-gaps").locator(`a[data-gap="assets:${land.id}"]`)).toHaveCount(0);

  // 21. upload errors: a type the vault does not accept, and a file whose content is not what its name says
  await page.goto(`/app/w/${waqfId}/documents#upload`);
  await page.getByTestId("document-file-input").setInputFiles({ name: "tool.exe", mimeType: "application/octet-stream", buffer: Buffer.from("MZ") });
  await expect(page.locator("#upload").getByRole("alert")).toContainText("غير مقبول");
  await page.getByTestId("document-file-input").setInputFiles({ name: "fake.pdf", mimeType: "application/pdf", buffer: Buffer.from("not a pdf at all") });
  await page.getByRole("button", { name: "ارفع الوثيقة" }).click();
  await expect(page.locator("#upload").getByRole("alert")).toBeVisible({ timeout: T });
});

test("5 (requests): a second drafting request for the same waqf opens the existing one", async ({ browser }) => {
  test.setTimeout(400_000);
  const page = await clientPage(browser);
  await page.goto(`/app/requests/new?service=T03&waqf=${waqfId}`);
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/, { timeout: T });
  const reqId = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
  // stand-in for a submitted request (the intake itself is covered by waqf-file.spec)
  await sql("update service_requests set status = 'submitted' where id = $1", [reqId]);
  await page.goto(`/app/requests/new?service=T03&waqf=${waqfId}`);
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(new RegExp(`/app/requests/${reqId}\\?existing=1`), { timeout: T });
  await expect(page.getByTestId("existing-request")).toBeVisible();
  const n = await sql<{ n: number }>("select count(*)::int n from service_requests r join services s on s.id = r.service_id where r.waqf_id = $1 and s.code = 'T03'", [waqfId]);
  expect(n[0].n).toBe(1);
});

const clientState = () => `test-results/.auth/journey-client-${test.info().project.name}.json`;
async function clientPage(browser: Browser) {
  const ctx = await browser.newContext({ ...ctxOpts(), storageState: clientState() });
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}
const ctxOpts = () => {
  const u = test.info().project.use;
  return { baseURL: u.baseURL, viewport: u.viewport, userAgent: u.userAgent, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch, locale: u.locale, timezoneId: u.timezoneId };
};
async function chairPage(browser: Browser) {
  const ctx = await browser.newContext(ctxOpts());
  const page = await ctx.newPage();
  page.on("dialog", (d) => d.accept());
  await loginAs(page, "chair");
  return page;
}

test("14: documented only with the deed in the vault; the founder's establishment permissions then lapse", async ({ browser }) => {
  test.setTimeout(600_000);
  const page = await clientPage(browser);
  // the ownership deed the land still lacks, uploaded from its gap (the upload form opens on the right type)
  await page.goto(`/app/w/${waqfId}`);
  await page.getByTestId("journey-gaps").locator('a[data-gap="assets:docs"]').click();
  await expect(page.locator("#upload select[name=docType]")).toHaveValue("ownership_deed");
  await page.getByLabel("عنوان الوثيقة").fill("صك ملكية الأرض (تجريبي)");
  await page.getByTestId("document-file-input").setInputFiles({ name: "ownership.pdf", mimeType: "application/pdf", buffer: pdf("journey ownership") });
  await page.getByRole("button", { name: "ارفع الوثيقة" }).click();
  await expect(page.getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible({ timeout: T });
  await page.goto(`/app/w/${waqfId}`);
  await expect(page.getByTestId("journey-steps").locator('[data-step="assets"]')).toHaveAttribute("data-state", "done");

  // 14. a deed number alone is not documentation
  await page.goto(`/app/w/${waqfId}?edit=1#profile`);
  await page.getByLabel("رقم الصك").fill("DEMO-J-001");
  await page.getByLabel("تاريخ الصك (ميلادي)").fill("2026-10-01");
  await page.getByLabel("تاريخ التوثيق").fill("2026-10-01");
  await page.getByRole("button", { name: "احفظ وأعد حساب الالتزامات" }).click();
  await expect(page.getByText(/يُعد الوقف موثقًا حين يُرفع صك الوقف/).first()).toBeVisible({ timeout: T });
  await page.goto(`/app/w/${waqfId}`);
  await expect(page.getByTestId("journey")).toHaveAttribute("data-status", "documenting");
  await expect(page.getByTestId("journey-steps").locator('[data-step="documentation"]')).not.toHaveAttribute("data-state", "done");
  expect((await sql<{ s: string }>("select status s from waqfs where id = $1", [waqfId]))[0].s).toBe("documenting");

  // the deed in the vault is the evidence: the stage moves on by itself
  await page.goto(`/app/w/${waqfId}/documents?upload=waqf_deed#upload`);
  await expect(page.locator("#upload select[name=docType]")).toHaveValue("waqf_deed");
  await page.getByLabel("عنوان الوثيقة").fill("صك وقف الرحلة (تجريبي)");
  await page.getByTestId("document-file-input").setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: pdf("journey deed") });
  await page.getByRole("button", { name: "ارفع الوثيقة" }).click();
  await expect(page.getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible({ timeout: T });
  await page.goto(`/app/w/${waqfId}`);
  await expect(page.getByTestId("journey-steps").locator('[data-step="documentation"]')).toHaveAttribute("data-state", "done");
  expect((await sql<{ s: string }>("select status s from waqfs where id = $1", [waqfId]))[0].s).toBe("documented");
  await shot(page, "journey-documented");
  // the nazara manages the file from here on: no more editing by the founder
  await expect(page.getByTestId("establishing-founder")).toHaveCount(0);
  // what is left for the file is now the nazara's (the founder may still upload the registration certificate)
  await expect(page.getByTestId("journey-gaps").locator('a[data-gap="reg:data"]')).toContainText("على النظارة");
  await expect(page.getByTestId("journey-gaps").locator('a[data-gap="doc:reg"]')).toContainText("لدى الجهة");
  await page.goto(`/app/w/${waqfId}/assets`);
  await expect(page.getByTestId("add-asset-form")).toHaveCount(0);
});

test("16–19: members with capacity and contact, management rules, agenda with presenter and attachment, governance report", async ({ browser }) => {
  test.setTimeout(900_000);
  const C = demo().waqfs.C;
  const chair = await chairPage(browser);
  const stamp = `${test.info().project.name}-${Date.now() % 100000}`;

  // 16. a member without an account, with capacity and a contact for invitations; a second chair is refused
  await chair.goto(`/app/w/${C}/parties#bodies`);
  const bodies = chair.locator("#bodies");
  await bodies.getByText("أضف عضوًا").first().click();
  const addForm = bodies.locator("form").filter({ has: chair.getByLabel("البريد (للدعوات إن لم يكن له حساب)") }).first();
  await addForm.getByLabel("الاسم").fill(`مستشار خارجي ${stamp} (تجريبي)`);
  await addForm.getByLabel("الدور").selectOption("chair");
  await addForm.getByRole("button", { name: "أضف" }).click();
  await expect(addForm.locator('[role="alert"]').first()).toContainText("للمجلس رئيس قائم", { timeout: T });
  await addForm.getByLabel("الدور").selectOption("member");
  await addForm.getByLabel("صفته").fill("خبير مالي");
  await addForm.getByLabel("البريد (للدعوات إن لم يكن له حساب)").fill("advisor.journey@example.test");
  await addForm.getByRole("button", { name: "أضف" }).click();
  await expect(addForm.getByRole("status")).toBeVisible({ timeout: T });
  await chair.reload();
  await expect(chair.getByText(`مستشار خارجي ${stamp} (تجريبي)`).first()).toBeVisible();
  await expect(chair.getByText("بلا حساب في المنصة").first()).toBeVisible();

  // management rules with their source
  await chair.goto(`/app/w/${C}/governance#rules`);
  await chair.locator("#rules summary").first().click();
  const rules = chair.getByTestId("rules-form");
  await rules.getByLabel("مصدر هذه القواعد").fill(`لائحة المجلس التجريبية ${stamp}`);
  await rules.getByLabel("صلاحيات التوقيع").fill("يوقع الرئيس ونائبه مجتمعين على ما يزيد على 50 ألف ريال (تجريبي).");
  await rules.getByRole("button", { name: "احفظ القواعد" }).click();
  await expect(rules.getByRole("status")).toBeVisible({ timeout: T });
  await chair.reload();
  await expect(chair.getByTestId("rules")).toContainText(`لائحة المجلس التجريبية ${stamp}`);

  // 17. a meeting with an agenda item that has a presenter and an attachment from the vault
  const title = `اجتماع رحلة العميل (${stamp})`;
  await chair.goto(`/app/w/${C}/governance#new-meeting`);
  const form = chair.locator("#new-meeting");
  await form.getByLabel("عنوان الاجتماع").fill(title);
  await form.getByLabel("التاريخ والوقت").fill("2026-10-25T10:00");
  await form.getByLabel("المكان").fill("مقر الوقف (تجريبي)");
  await form.getByLabel("جدول الأعمال").fill("! اعتماد خطة الصيانة");
  await form.getByRole("button", { name: "أنشئ الاجتماع" }).click();
  await chair.waitForURL(/\/governance\/meetings\/[0-9a-f-]{36}$/, { timeout: T });
  const agenda = chair.getByTestId("agenda-form");
  await agenda.getByLabel("بند جديد").fill("مراجعة عقد الصيانة");
  await agenda.getByLabel("مقدّم البند (اختياري)").fill("أمين السر");
  const doc = agenda.locator('input[name="docIds"]').first();
  await doc.check();
  const docTitle = (await doc.locator("xpath=..").innerText()).trim();
  await agenda.getByRole("button", { name: "أضف البند" }).click();
  await expect(chair.getByTestId("agenda-2-meta")).toContainText("يقدّمه: أمين السر", { timeout: T });
  await expect(chair.getByTestId("agenda-2-meta").getByRole("link", { name: docTitle })).toBeVisible();
  await chair.getByRole("button", { name: "أرسل الدعوات" }).click();
  await expect(chair.getByText(/أُرسل إشعار الدعوة داخل المنصة إلى \d+/).first()).toBeVisible({ timeout: T });
  await expect(chair.getByText(/دعوة بجدول الأعمال إلى \d+ من الأعضاء بلا حساب/).first()).toBeVisible(); // the member without an account is reported honestly
  await shot(chair, "meeting-agenda");

  // 19. the governance report is built from these records
  await chair.goto(`/app/w/${C}/governance`);
  await chair.getByTestId("governance-report-link").click();
  await chair.waitForURL(/\/reports\/governance/, { timeout: T });
  // the default period ends today; the meeting is scheduled later, so the period is widened to include it
  await chair.goto(`/app/w/${C}/reports/governance?from=2026-01-01&to=2026-12-31`);
  const rep = chair.getByTestId("governance-report");
  await expect(rep).toContainText(`مستشار خارجي ${stamp} (تجريبي)`);
  await expect(rep).toContainText(`لائحة المجلس التجريبية ${stamp}`);
  await expect(rep.getByRole("link", { name: title })).toBeVisible();
  await expect(rep).toContainText("السياسات واللوائح");
  await noHorizontalScroll(chair);
  await shot(chair, "governance-report");
  // a period with no records says so instead of inventing figures
  await chair.goto(`/app/w/${C}/reports/governance?from=2001-01-01&to=2001-12-31`);
  await expect(chair.getByText("لا اجتماعات في الفترة.")).toBeVisible();
  await expect(chair.getByText("لا قرارات مسجلة في الفترة.")).toBeVisible();

  // leave the demo board as it was: end the test member
  const [m] = await sql<{ id: string }>("select id from body_memberships where person_name = $1", [`مستشار خارجي ${stamp} (تجريبي)`]);
  if (m) await sql("update body_memberships set status = 'ended', ends_on = current_date - 1 where id = $1", [m.id]);
  await chair.context().close();
});

test("20: another client cannot reach this waqf, its draft or its report", async ({ browser }) => {
  test.setTimeout(300_000);
  const ctx = await browser.newContext(ctxOpts());
  const page = await ctx.newPage();
  await loginAs(page, "outsider");
  for (const p of [`/app/w/${waqfId}`, `/app/w/${waqfId}/assets`, `/app/w/${waqfId}/reports/governance`, `/app/w/${demo().waqfs.C}/reports/governance`]) {
    await page.goto(p);
    await expect(page, p).toHaveURL(/\/app\?notfound=1|\/app$/);
  }
  await page.goto(`/app/establish/${waqfId}?step=3`);
  await expect(page.getByTestId("wizard-step-3")).toHaveCount(0);
  await expect(page.locator("body")).not.toContainText("أرض تجريبية للرحلة");
  await ctx.close();
});
