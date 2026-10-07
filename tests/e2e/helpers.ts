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
import { readFileSync } from "node:fs";
import { generate } from "otplib";

type DemoUser = { id: string; phone: string; email?: string; password?: string | null; totpSecret?: string | null; name: string };
export type DemoCreds = { waqfs: { A: string; B: string; C: string }; users: Record<string, DemoUser> };
export const demo = (): DemoCreds => JSON.parse(readFileSync("storage/demo-credentials.json", "utf8"));

/** Logs in as a demo user. Staff: email + password + TOTP. Clients: phone + on-screen OTP. */
export async function loginAs(page: Page, key: string) {
  const u = demo().users[key];
  if (!u) throw new Error(`unknown demo user ${key}`);
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
  return u;
}
