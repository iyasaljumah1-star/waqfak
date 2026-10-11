import { expect as baseExpect, test, type Browser, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

// The dev server compiles each route on first visit; allow for it.
const expect = baseExpect.configure({ timeout: 30_000 });
const SHOTS = "test-results-shots/admin";
const isMobile = (page: Page) => (page.viewportSize()?.width ?? 1366) < 1024;

/** Admin menu labels as the viewer sees them (side nav on desktop, drawer on phones). */
async function adminNavLabels(page: Page) {
  if (isMobile(page)) {
    await page.getByRole("button", { name: "فتح قائمة الإدارة" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const links = dialog.getByRole("navigation", { name: "قائمة الإدارة" }).getByRole("link");
    await expect(links.first()).toBeVisible();
    const labels = (await links.allInnerTexts()).map((s) => s.trim());
    await dialog.getByRole("button", { name: "إغلاق القائمة" }).click();
    return labels;
  }
  const links = page.getByRole("navigation", { name: "قائمة الإدارة" }).getByRole("link");
  await expect(links.first()).toBeVisible();
  return (await links.allInnerTexts()).map((s) => s.trim());
}

async function asUser(browser: Browser, key: string) {
  const ctx = await browser.newContext({ baseURL: "http://localhost:3000", locale: "ar-SA", timezoneId: "Asia/Riyadh", viewport: { width: 1366, height: 900 } });
  const page = await ctx.newPage();
  await loginAs(page, key);
  return { ctx, page };
}

/** Sets one role×permission switch on the roles page to the wanted state. */
async function setPermission(page: Page, roleKey: string, roleName: string, permName: string, on: boolean) {
  await page.goto("/admin/users/roles?scope=global");
  if (isMobile(page)) await page.locator("#focus-role").selectOption(roleKey);
  const sw = page.getByRole("switch", { name: `${permName} — ${roleName}` });
  await expect(sw).toBeVisible();
  if ((await sw.getAttribute("aria-checked")) !== String(on)) {
    await sw.click();
    await expect(page.getByText(on ? /أُضيفت/ : /أُزيلت/)).toBeVisible();
  }
  await expect(sw).toHaveAttribute("aria-checked", String(on));
}

test.describe.configure({ mode: "serial" });

test("admin signs in with password + TOTP and lands on the company dashboard", async ({ page }, info) => {
  await loginAs(page, "admin", { fresh: true });
  await page.goto("/admin");
  await expect(page.getByRole("heading", { name: "لوحة الشركة", level: 1 })).toBeVisible();
  const kpis = page.getByRole("region", { name: "مؤشرات الشركة" });
  for (const label of ["العملاء", "الأوقاف", "الطلبات المفتوحة", "تجاوزت المهلة", "التزامات نظامية متأخرة", "فواتير غير مسددة", "رسائل تواصل جديدة"])
    await expect(kpis.getByText(label, { exact: true })).toBeVisible();
  await expect(page.getByText("بيئة تجريبية")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-dashboard.png`, fullPage: true });
  if (isMobile(page)) {
    await page.getByRole("button", { name: "فتح قائمة الإدارة" }).click();
    await expect(page.getByRole("dialog").getByRole("link", { name: "المستخدمون والأدوار" })).toBeVisible();
    await page.waitForTimeout(400); // let the drawer finish fading in
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-drawer.png` });
    await page.getByRole("button", { name: "إغلاق القائمة" }).click();
  }
});

test("removing a permission from a role takes effect immediately, then is restored", async ({ page, browser }, info) => {
  test.setTimeout(180_000);
  await loginAs(page, "admin");
  const editor = await asUser(browser, "editor");
  try {
    await editor.page.goto("/admin");
    expect(await adminNavLabels(editor.page)).toContain("المحتوى والمكتبة");

    await setPermission(page, "content_editor", "محرر محتوى", "إدارة المحتوى", false);
    await page.screenshot({ path: `${SHOTS}/${info.project.name}-roles.png` });

    await editor.page.reload();
    expect(await adminNavLabels(editor.page)).not.toContain("المحتوى والمكتبة");

    // the change is in the audit trail
    await page.goto("/admin/audit?action=admin.role.permission_revoked");
    await expect(page.getByRole("link", { name: "إزالة صلاحية من دور" }).first()).toBeVisible();
  } finally {
    await setPermission(page, "content_editor", "محرر محتوى", "إدارة المحتوى", true);
  }
  await editor.page.reload();
  expect(await adminNavLabels(editor.page)).toContain("المحتوى والمكتبة");
  await editor.ctx.close();
});

test("audit hash chain verifies with no broken link", async ({ page }, info) => {
  await loginAs(page, "admin");
  await page.goto("/admin/audit");
  await page.getByRole("button", { name: "تحقق من سلامة السجل" }).click();
  await expect(page.getByText("السجل سليم: لا روابط مقطوعة ولا محتوى معدّل")).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-audit.png`, fullPage: true });
  // before/after diff of an entry
  await page.getByRole("table").getByRole("link").nth(1).click();
  await expect(page.getByRole("heading", { name: "قبل وبعد" })).toBeVisible({ timeout: 30_000 });
});

test("employee cannot open users or MLRO; MLRO is closed to the super admin too", async ({ page, browser }) => {
  await loginAs(page, "emp1");
  for (const path of ["/admin/users", "/admin/users/roles", "/admin/mlro", "/admin/settings", "/admin/audit"]) {
    await page.goto(path);
    await page.waitForURL(/\/admin\?denied=1$/, { timeout: 30_000 });
    await expect(page.getByText("تلك الصفحة خارج صلاحياتك")).toBeVisible();
  }
  const labels = await adminNavLabels(page);
  expect(labels).not.toContain("المستخدمون والأدوار");
  expect(labels).not.toContain("الامتثال الداخلي (MLRO)");

  const admin = await asUser(browser, "admin");
  await admin.page.goto("/admin/mlro");
  await admin.page.waitForURL(/\/admin\?denied=1$/, { timeout: 30_000 });
  await admin.ctx.close();
});

test("MLRO opens the restricted register and records a note", async ({ page }, info) => {
  await loginAs(page, "mlro");
  await page.goto("/admin/mlro");
  await expect(page.getByRole("heading", { name: "الامتثال الداخلي (MLRO)" })).toBeVisible();
  expect(await adminNavLabels(page)).toContain("الامتثال الداخلي (MLRO)");
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-mlro.png`, fullPage: true });
  await page.getByRole("link", { name: /WQF-/ }).first().click();
  await expect(page.getByRole("heading", { name: "المسار" })).toBeVisible();
  const note = `ملاحظة اختبار ${Date.now()}`;
  await page.getByLabel("الملاحظة").fill(note);
  await page.getByRole("button", { name: "نفّذ" }).click();
  await expect(page.getByText("أُضيفت الملاحظة.")).toBeVisible();
  await page.reload();
  await expect(page.getByText(note)).toBeVisible();
});

test("content editor sees only content-related navigation", async ({ page }) => {
  await loginAs(page, "editor");
  await page.goto("/admin");
  expect((await adminNavLabels(page)).sort()).toEqual(["المحتوى والمكتبة", "لوحة الشركة"].sort());
  await page.goto("/admin/users");
  await page.waitForURL(/denied=1/, { timeout: 30_000 });
});

test("break-glass: employee requests, another admin approves, access is time-limited and revocable", async ({ page, browser }, info) => {
  test.setTimeout(240_000);
  const B = demo().waqfs.B;
  const admin = await asUser(browser, "admin");
  await admin.page.goto(`/admin/waqfs/${B}`);
  const number = (await admin.page.locator("header span.tabular").first().innerText()).trim();
  expect(number).toMatch(/^WQF-/);
  // leftovers from an interrupted run
  await admin.page.goto("/admin/users/break-glass");
  await expect(admin.page.getByRole("heading", { name: /نشط الآن/ })).toBeVisible();
  while (await admin.page.getByRole("button", { name: "أنهِ الآن" }).count()) {
    const n = await admin.page.getByRole("button", { name: "أنهِ الآن" }).count();
    await admin.page.getByRole("button", { name: "أنهِ الآن" }).first().click();
    await expect(admin.page.getByRole("button", { name: "أنهِ الآن" })).toHaveCount(n - 1);
  }
  const stale = () => admin.page.getByRole("listitem").filter({ hasText: "اختبار آلي: طلب عاجل" }).filter({ has: admin.page.getByRole("button", { name: "ارفض" }) });
  while (await stale().count()) {
    const n = await stale().count();
    await stale().first().getByLabel("سبب الرفض").fill("تنظيف بعد اختبار مقطوع");
    await stale().first().getByRole("button", { name: "ارفض" }).click();
    await expect(stale()).toHaveCount(n - 1);
  }

  await loginAs(page, "emp1");
  await page.goto(`/admin/waqfs/${B}`);
  await page.waitForURL(/denied=1/, { timeout: 30_000 }); // not assigned to waqf B

  await page.goto("/admin/users/break-glass");
  await page.getByLabel("الرقم الداخلي للوقف").fill(number);
  await page.getByLabel("سبب الحاجة العاجلة").fill("اختبار آلي: طلب عاجل من الناظر خارج ساعات العمل لمراجعة مستند.");
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await expect(page.getByText(/أُرسل الطلب/)).toBeVisible();

  await admin.page.goto("/admin/users/break-glass");
  const item = admin.page.getByRole("listitem").filter({ hasText: "اختبار آلي: طلب عاجل" }).first();
  await item.getByRole("button", { name: "اعتمد الوصول" }).click();
  // the request leaves the pending list and appears under «نشط الآن», with the standing banner in the shell
  await expect(admin.page.getByRole("heading", { name: /نشط الآن \([1-9]/ })).toBeVisible();
  await expect(admin.page.getByText(/وصول طارئ نشط/)).toBeVisible();

  await page.goto(`/admin/waqfs/${B}`);
  await expect(page.getByText("تطلع عبر وصول طارئ")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-breakglass-view.png`, fullPage: true });

  await admin.page.goto("/admin/users/break-glass");
  await admin.page.getByRole("button", { name: "أنهِ الآن" }).first().click();
  await expect(admin.page.getByRole("heading", { name: "نشط الآن (0)" })).toBeVisible();
  await page.goto(`/admin/waqfs/${B}`);
  await page.waitForURL(/denied=1/, { timeout: 30_000 });
  await admin.ctx.close();
});

test("feature flag changes require a reason; N01 intake is an operational switch, separate from the licence", async ({ page }, info) => {
  test.skip(info.project.name === "mobile", "changes a shared flag; runs once (desktop)");
  await loginAs(page, "admin");
  await page.goto("/admin/settings/flags");
  const row = page.getByRole("listitem").filter({ hasText: "service.nazara" });
  await row.getByRole("button", { name: "أوقف" }).click();
  await row.getByRole("button", { name: "أكّد الإيقاف" }).click();
  await expect(row.getByText(/اذكر سبب التغيير/)).toBeVisible();
  await row.getByLabel(/سبب الإيقاف/).fill("اختبار: إيقاف مؤقت لاستقبال طلبات النظارة");
  await row.getByRole("button", { name: "أكّد الإيقاف" }).click();
  await expect(row.getByText("موقوفة")).toBeVisible({ timeout: 20_000 });
  await page.goto("/admin/settings");
  await expect(page.getByText(/استقبال الطلبات متوقف/)).toBeVisible();
  // Licence inactive: the note says starting a nazara on a real waqf waits for it (intake is independent)
  await expect(page.getByText(/مباشرة النظارة على وقف حقيقي تنتظر تفعيل ترخيص الهيئة/)).toBeVisible();
  await page.goto("/admin/settings/flags");
  const row2 = page.getByRole("listitem").filter({ hasText: "service.nazara" });
  await row2.getByRole("button", { name: "فعّل" }).click();
  await row2.getByLabel(/سبب التفعيل/).fill("اختبار: إعادة استقبال طلبات النظارة");
  await row2.getByRole("button", { name: "أكّد التفعيل" }).click();
  await expect(row2.getByText("مفعّلة")).toBeVisible({ timeout: 20_000 });
  await page.goto("/admin/settings");
  await expect(page.getByText(/تُستقبل الطلبات وتُدرس/)).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/${info.project.name}-settings.png`, fullPage: true });
});
