import { expect, type Page } from "@playwright/test";

export const uniquePhone = () => `05${String(Date.now()).slice(-8)}`;

/** Signs up a fresh user through the real UI (OTP shown on screen in demo mode). */
export async function signup(page: Page, name = "مستخدم اختبار") {
  const phone = uniquePhone();
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
  return phone;
}

export async function login(page: Page, phone: string) {
  await page.goto("/login");
  await page.getByLabel("رقم الجوال").fill(phone);
  await page.getByRole("button", { name: "أرسل رمز الدخول" }).click();
  await expect(page).toHaveURL(/\/verify/);
  const code = (await page.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(code);
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL(/\/(app|admin|login\/mfa)/);
}

// ── Demo accounts (created by `npm run db:seed-demo`; credentials in storage/demo-credentials.json) ──
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { generate } from "otplib";

type DemoUser = { id: string; phone: string; email?: string; password?: string | null; totpSecret?: string | null; name: string };
export type DemoCreds = { waqfs: { A: string; B: string; C: string }; users: Record<string, DemoUser> };
export const demo = (): DemoCreds => JSON.parse(readFileSync("storage/demo-credentials.json", "utf8"));

/**
 * Whether the page's context holds a live session. Asked of an API route (401 without one) rather than read from the URL
 * after opening a page: a page answers 200 and streams its redirect to /login, so the URL right after goto() still says
 * /app for an expired session — a cached session that had expired was taken for a live one.
 */
export async function isSignedIn(page: Page) {
  return (await page.request.get("/api/files/00000000-0000-4000-8000-000000000000")).status() !== 401;
}

/** Logs in as a demo user. Staff: email + password + TOTP. Clients: phone + on-screen OTP. */
export async function loginAs(page: Page, key: string, opts: { fresh?: boolean } = {}) {
  const u = demo().users[key];
  if (!u) throw new Error(`unknown demo user ${key}`);
  // Reuse a recent session to stay under OTP/login rate limits shared by all specs.
  const cache = `storage/.e2e-auth/${key}.json`;
  if (!opts.fresh && existsSync(cache) && Date.now() - statSync(cache).mtimeMs < 8 * 60_000) {
    await page.context().addCookies(JSON.parse(readFileSync(cache, "utf8")));
    if (await isSignedIn(page)) {
      await page.goto("/app");
      writeFileSync(cache, JSON.stringify(await page.context().cookies()));
      return u;
    }
    await page.context().clearCookies();
  }
  await freshLogin(page, u);
  mkdirSync("storage/.e2e-auth", { recursive: true });
  writeFileSync(cache, JSON.stringify(await page.context().cookies()));
  return u;
}

async function freshLogin(page: Page, u: DemoUser) {
  if (u.password && u.totpSecret) {
    await page.goto("/login");
    await page.getByRole("tab", { name: "البريد وكلمة المرور" }).click();
    await page.getByLabel("البريد الإلكتروني").fill(u.email!);
    await page.getByLabel("كلمة المرور").fill(u.password);
    await page.getByRole("button", { name: "ادخل" }).click();
    await page.waitForURL(/\/login\/mfa/);
    await page.getByLabel(/الرمز من تطبيق المصادقة/).fill(await generate({ secret: u.totpSecret }));
    await page.getByRole("button", { name: "تحقّق" }).click();
    await page.waitForURL(/\/(app|admin)/);
  } else {
    await login(page, u.phone);
  }
}

/**
 * Services that read the waqf file show its records in a «بيانات الوقف المسجلة» step right after the applicant step:
 * the client confirms them instead of re-entering them. No-op for services without that step.
 */
export async function passWaqfData(page: Page, review: "confirmed" | "needs_update" = "confirmed") {
  const heading = page.getByRole("heading", { name: "بيانات الوقف المسجلة" });
  await page.getByRole("button", { name: "التالي" }).first().waitFor({ state: "visible" });
  if (!(await heading.isVisible().catch(() => false))) {
    await page.waitForTimeout(300);
    if (!(await heading.isVisible().catch(() => false))) return false;
  }
  await page.getByRole("radio", { name: review === "confirmed" ? "نعم، صحيحة ومحدّثة" : "بعضها يحتاج تحديثًا أو تصحيحًا" }).check();
  await page.getByRole("button", { name: "التالي" }).click();
  await expect(heading).toBeHidden();
  return true;
}
