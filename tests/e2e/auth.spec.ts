import { expect, test } from "@playwright/test";
import { login, signup } from "./helpers";

test("sign up, log out, log back in", async ({ page }) => {
  const phone = await signup(page, "سارة الاختبار");
  await expect(page.getByText("سارة الاختبار")).toBeVisible();
  await page.getByRole("button", { name: "خروج" }).click();
  await page.goto("/app");
  await expect(page).toHaveURL(/\/login/);
  await login(page, phone);
  await expect(page).toHaveURL(/\/app/);
});

test("wrong OTP is rejected", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("رقم الجوال").fill("0599999999");
  await page.getByRole("button", { name: "أرسل رمز الدخول" }).click();
  await page.getByLabel("رمز التحقق").fill("000000");
  await page.getByRole("button", { name: "تحقّق" }).click();
  await expect(page.getByText("الرمز غير صحيح")).toBeVisible();
});
