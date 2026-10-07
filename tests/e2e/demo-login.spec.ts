import { test, expect } from "@playwright/test";
import { loginAs } from "./helpers";
test("demo staff and client can log in", async ({ page }) => {
  await loginAs(page, "admin");
  await expect(page).toHaveURL(/\/(app|admin)/);
  await page.context().clearCookies();
  await loginAs(page, "nazir");
  await expect(page).toHaveURL(/\/app/);
});
