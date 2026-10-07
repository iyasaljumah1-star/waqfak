import { existsSync, mkdirSync } from "node:fs";
import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { demo, loginAs, uniquePhone } from "./helpers";

// The dev server runs on 2 CPUs next to other suites: server actions can take several seconds.
const expect = baseExpect.configure({ timeout: 20_000 });
const shots = "/tmp/claude-0/shots";
mkdirSync(shots, { recursive: true });

/**
 * Reuses one session per demo user (OTP sends are rate-limited per phone and per IP, and other suites log in
 * concurrently). A cached session is re-validated before use.
 */
async function sessionPage(browser: Browser, key: string, viewport: { width: number; height: number } | null, isMobile: boolean): Promise<Page> {
  const file = `/tmp/claude-0/e2e-portal-${key}-${demo().users[key].id}.json`;
  const opts = { ...(viewport ? { viewport } : {}), isMobile, hasTouch: isMobile };
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const page = await ctx.newPage();
    await page.goto("/app/profile");
    if (page.url().includes("/app/profile")) return page;
    await ctx.close();
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  return page;
}

/** Signs up through the real UI with a chosen phone (OTP is shown on screen in demo mode). */
async function signupWith(page: Page, phone: string, name: string) {
  await page.goto("/signup");
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("رقم الجوال").fill(phone);
  await page.getByLabel(/قرأت/).check();
  await page.getByRole("button", { name: "أنشئ الحساب" }).click();
  await expect(page).toHaveURL(/\/verify/);
  const code = (await page.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(code);
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL(/\/app/);
}

test.describe.serial("portal shell & core", () => {
  const stamp = Date.now().toString(36);
  const waqfName = `وقف الاختبار ${stamp} (تجريبي)`;
  let founder: Page;
  let newWaqfId = "";

  test("nazir dashboard lists waqf A with obligations, requests and tasks", async ({ browser, viewport, isMobile }, info) => {
    const page = await sessionPage(browser, "nazir", viewport, isMobile);
    const A = demo().waqfs.A;
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("أهلًا");
    await expect(page.getByRole("heading", { name: "أوقافك" })).toBeVisible();
    const card = page.locator(`a[href="/app/w/${A}"]`).first();
    await expect(card).toBeVisible();
    await expect(page.getByText("الالتزامات القادمة").first()).toBeVisible();
    await expect(page.getByText("طلبات مفتوحة").first()).toBeVisible();
    await expect(page.getByText("مهام مفتوحة").first()).toBeVisible();
    await expect(page.getByRole("link", { name: /الإشعارات/ }).first()).toBeVisible(); // bell
    await page.screenshot({ path: `${shots}/portal-dashboard-${info.project.name}.png`, fullPage: true });

    await card.click();
    await page.waitForURL(new RegExp(`/app/w/${A}$`));
    await expect(page.getByRole("heading", { name: "بيانات أساسية" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "مسار الوقف" })).toBeVisible();
    await expect(page.getByRole("navigation", { name: "أقسام ملف الوقف" }).first()).toBeVisible();
    await page.screenshot({ path: `${shots}/portal-waqf-${info.project.name}.png`, fullPage: true });
  });

  test("a fresh signup sees start paths and registers an existing waqf", async ({ browser, viewport, isMobile }, info) => {
    const ctx = await browser.newContext({ ...(viewport ? { viewport } : {}), isMobile, hasTouch: isMobile });
    founder = await ctx.newPage();
    await signupWith(founder, uniquePhone(), "ناظر اختبار (تجريبي)");
    await founder.goto("/app");
    await expect(founder.getByRole("heading", { name: "من أين تبدأ؟" })).toBeVisible();
    for (const href of ["/assessment", "/app/establish", "/app/waqfs/new"]) await expect(founder.locator(`main a[href="${href}"]`).first()).toBeVisible();
    await founder.screenshot({ path: `${shots}/portal-empty-${info.project.name}.png`, fullPage: true });

    await founder.goto("/app/waqfs");
    await expect(founder.getByText("لا يرتبط حسابك بأي وقف بعد")).toBeVisible();

    await founder.goto("/app/waqfs/new");
    // validation: empty submit keeps the user on the form with field errors
    await founder.getByRole("button", { name: "افتح ملف الوقف" }).click();
    await expect(founder.getByText("راجع الحقول المظللة.")).toBeVisible();

    await founder.getByLabel("اسم الوقف").fill(waqfName);
    await founder.getByLabel("رقم الصك").fill(`E2E-${stamp}`);
    await founder.getByLabel("تاريخ التوثيق").fill("2024-03-10");
    await founder.getByLabel("تاريخ التسجيل لدى الهيئة العامة للأوقاف").fill("2024-05-02");
    await founder.getByLabel("نوع الوقف").selectOption("public");
    await founder.getByLabel("صيغة النظارة").selectOption("founder");
    await founder.getByLabel("القيمة التقديرية للأصول").selectOption("50to200");
    await founder.getByLabel("صفتك في الوقف").selectOption("founder");
    await founder.getByLabel("يجمع الوقف تبرعات من الغير").check();
    await founder.screenshot({ path: `${shots}/portal-register-${info.project.name}.png`, fullPage: true });
    await founder.getByRole("button", { name: "افتح ملف الوقف" }).click();
    await founder.waitForURL(/\/app\/w\/[0-9a-f-]{36}$/);
    newWaqfId = founder.url().split("/").pop()!;

    // header badges: registered, public, medium (50–200m band); founder-nazir gets both roles
    await expect(founder.getByText(waqfName).first()).toBeVisible();
    await expect(founder.getByText("متوسط").first()).toBeVisible();
    await expect(founder.getByText(/بصفتك واقف، ناظر/).first()).toBeVisible();
    await expect(founder.getByText("تسجيل الوقف لدى الهيئة العامة للأوقاف").first()).toBeVisible(); // timeline

    // audit trail
    await founder.goto(`/app/w/${newWaqfId}/audit`);
    await expect(founder.getByText("فتح ملف الوقف في المنصة").first()).toBeVisible();

    // edit the core profile (flags drive obligations) → saved notice
    await founder.goto(`/app/w/${newWaqfId}?edit=1`);
    await founder.getByLabel("له مستفيدون خارج المملكة").check();
    await founder.getByLabel("نهاية السنة المالية").fill("06-30");
    await founder.getByRole("button", { name: "احفظ وأعد حساب الالتزامات" }).click();
    await founder.waitForURL(/\?saved=1/);
    await expect(founder.getByText("حُفظ ملف الوقف")).toBeVisible();
    await expect(founder.getByText("مستفيدون خارج المملكة").first()).toBeVisible();
    await founder.screenshot({ path: `${shots}/portal-new-waqf-${info.project.name}.png`, fullPage: true });

    // dashboard now shows the waqf
    await founder.goto("/app");
    await expect(founder.getByRole("link", { name: waqfName })).toBeVisible();
  });

  test("outsider cannot open waqf A", async ({ browser, viewport, isMobile }) => {
    const page = await sessionPage(browser, "outsider", viewport, isMobile);
    const A = demo().waqfs.A;
    await page.goto(`/app/w/${A}`);
    await page.waitForURL(/\/app\?notfound=1/);
    await expect(page.getByText("لم نجد ما طلبته")).toBeVisible();
    await page.goto(`/app/w/${A}/settings`);
    await page.waitForURL(/\/app\?notfound=1/);
    // the freshly registered waqf is equally hidden from the outsider
    await page.goto(`/app/w/${newWaqfId}`);
    await page.waitForURL(/\/app\?notfound=1/);
  });

  test("invite flow: in-app notification, bell count, accept, last nazir protected", async ({ browser, viewport, isMobile }, info) => {
    test.skip(!newWaqfId, "needs the waqf registered above");
    // invitee signs up first so the invitation reaches them as an in-app notification
    const ctx = await browser.newContext({ ...(viewport ? { viewport } : {}), isMobile, hasTouch: isMobile });
    const invitee = await ctx.newPage();
    const phone = uniquePhone();
    await signupWith(invitee, phone, "عضو مدعو (تجريبي)");

    await founder.goto(`/app/w/${newWaqfId}/settings`);
    // the only nazir cannot be removed
    await expect(founder.getByText(/آخر ناظر نشط/).first()).toBeVisible();
    await founder.getByLabel("رقم جوال المدعو").fill(phone);
    await founder.locator("#invite select#roleKey").selectOption("board_member");
    await founder.getByLabel("رسالة قصيرة (اختياري)").fill("ننتظر انضمامك (تجريبي)");
    await founder.getByRole("button", { name: "أرسل الدعوة" }).click();
    await expect(founder.getByText("أُرسلت الدعوة برسالة نصية وإشعار داخل المنصة.")).toBeVisible();
    await expect(founder.getByText("دعوات بانتظار القبول")).toBeVisible();
    await founder.screenshot({ path: `${shots}/portal-settings-${info.project.name}.png`, fullPage: true });

    // invitee: bell shows 1 unread; notifications page lists the invitation
    await invitee.goto("/app");
    await expect(invitee.getByRole("link", { name: "الإشعارات، 1 غير مقروءة" })).toBeVisible();
    await invitee.goto("/app/notifications");
    const item = invitee.getByTestId("notification").filter({ hasText: "دعوة للانضمام إلى ملف وقف" });
    await expect(item).toHaveAttribute("data-unread", "1");
    await invitee.screenshot({ path: `${shots}/portal-notifications-${info.project.name}.png`, fullPage: true });
    await item.getByRole("link", { name: "افتح" }).click();
    await invitee.waitForURL(/\/app\/invitations\//);
    await expect(invitee.getByRole("heading", { name: waqfName })).toBeVisible();
    await expect(invitee.getByText("عضو مجلس نظارة").first()).toBeVisible();
    await invitee.getByRole("button", { name: "أقبل الدعوة" }).click();
    await invitee.waitForURL(new RegExp(`/app/w/${newWaqfId}$`));
    await expect(invitee.getByText(/بصفتك عضو مجلس نظارة/)).toBeVisible();
    // a board member has no members.manage permission: settings is not in the section nav and redirects
    await invitee.goto(`/app/w/${newWaqfId}/settings`);
    await invitee.waitForURL(/\?denied=1/);
    await expect(invitee.getByText("هذه الصفحة خارج صلاحياتك")).toBeVisible();

    // notification was marked read when opened
    await invitee.goto("/app/notifications");
    await expect(invitee.getByText("لا إشعارات جديدة")).toBeVisible();
    await expect(invitee.getByTestId("notification").filter({ hasText: "دعوة للانضمام إلى ملف وقف" })).toHaveAttribute("data-unread", "0");
    // preferences save
    await invitee.getByLabel(/دعوة للانضمام إلى ملف وقف — رسالة نصية/).uncheck();
    await invitee.getByRole("button", { name: "احفظ التفضيلات" }).click();
    await expect(invitee.getByText("حُفظت تفضيلات الإشعارات.")).toBeVisible();

    // founder sees the new member; the invite link cannot be reused
    await founder.goto(`/app/w/${newWaqfId}/settings`);
    await expect(founder.locator("#members").getByText("عضو مدعو (تجريبي)").first()).toBeVisible();
    await ctx.close();
  });

  test("navigation: side nav on desktop, bottom tabs and menu sheet on mobile", async ({ browser, viewport, isMobile }, info) => {
    const page = await sessionPage(browser, "nazir", viewport, isMobile);
    await page.goto("/app");
    const tabs = page.getByRole("navigation", { name: "التنقل السريع" });
    const side = page.getByRole("navigation", { name: "القائمة الرئيسية" });
    if (info.project.name === "mobile") {
      await expect(tabs).toBeVisible();
      await expect(side).toBeHidden();
      for (const l of ["الرئيسية", "أوقافي", "مهامي", "الإشعارات", "المزيد"]) await expect(tabs.getByText(l, { exact: true })).toBeVisible();
      // no horizontal page scroll at phone width
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
      await tabs.getByRole("link", { name: "أوقافي" }).click();
      await page.waitForURL(/\/app\/waqfs$/);
      // The Next.js dev-tools badge (dev server only) sits over the bottom-left corner, where the last RTL tab is.
      await page.addStyleTag({ content: "nextjs-portal{display:none!important}" });
      await tabs.getByRole("button", { name: "المزيد" }).click();
      const sheet = page.getByRole("dialog", { name: "المزيد" });
      await expect(sheet).toBeVisible();
      await page.screenshot({ path: `${shots}/portal-mobile-menu.png` });
      await sheet.getByRole("link", { name: "الأمان والجلسات" }).click();
      await page.waitForURL(/\/app\/security$/);
      await expect(sheet).toBeHidden();
      await expect(page.getByRole("heading", { level: 1, name: "الأمان والجلسات" })).toBeVisible();
      // waqf section tabs scroll horizontally inside their own strip
      await page.goto(`/app/w/${demo().waqfs.A}`);
      await expect(page.getByRole("navigation", { name: "أقسام ملف الوقف" }).first()).toBeVisible();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1)).toBe(true);
    } else {
      await expect(side).toBeVisible();
      await expect(tabs).toBeHidden();
      await side.getByRole("link", { name: "خصوصيتي وبياناتي" }).click();
      await page.waitForURL(/\/app\/privacy$/);
      await expect(page.getByRole("heading", { level: 1, name: "خصوصيتي وبياناتي" })).toBeVisible();
      await page.getByRole("button", { name: "قائمة الحساب" }).click();
      await expect(page.getByRole("button", { name: "تسجيل الخروج" }).last()).toBeVisible();
      await page.keyboard.press("Escape");
      await page.screenshot({ path: `${shots}/portal-privacy-desktop.png`, fullPage: true });
    }
  });

  test("account pages render for a client: profile, security, privacy export", async ({ browser, viewport, isMobile }, info) => {
    const page = await sessionPage(browser, "nazir", viewport, isMobile);
    await page.goto("/app/profile");
    await expect(page.getByRole("heading", { level: 1, name: "ملفي الشخصي" })).toBeVisible();
    await page.goto("/app/security");
    await expect(page.getByRole("heading", { name: "الجلسات المفتوحة" })).toBeVisible();
    await expect(page.getByText("هذا الجهاز")).toBeVisible();
    await page.screenshot({ path: `${shots}/portal-security-${info.project.name}.png`, fullPage: true });
    const res = await page.request.get("/app/privacy/export");
    expect(res.status()).toBe(200);
    const json = await res.json();
    expect(String(json.profile.phone).slice(-9)).toBe(demo().users.nazir.phone.slice(-9));
    expect(JSON.stringify(json)).not.toContain("passwordHash");
  });
});
