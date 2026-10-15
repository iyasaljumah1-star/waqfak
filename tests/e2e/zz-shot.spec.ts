import { test } from "@playwright/test";
import { loginAs } from "./helpers";
const ids = (process.env.SHOT_IDS ?? "").split(",");
test("shots", async ({ page }) => {
  test.setTimeout(240_000);
  await loginAs(page, "admin");
  for (const id of ids) {
    await page.goto(`/admin/requests/${id}`);
    await page.waitForLoadState("networkidle");
    await page.screenshot({ path: `/tmp/claude-0/shots/pv/${id.slice(0, 8)}.png`, fullPage: true });
    const txt = await page.locator("main").innerText();
    console.log("=====", id, "\n", txt.slice(0, 6000));
  }
});
