import { test } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { loginAs } from "./helpers";
test("shot", async ({ page }, info) => {
  const url = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_OWNER_URL="))!.slice(19).trim();
  const db = new pg.Client({ connectionString: url }); await db.connect();
  const { rows } = await db.query("select r.id from service_requests r join services s on s.id=r.service_id where r.status in ('in_progress','triage') and s.pricing_model <> 'free' order by r.updated_at desc limit 1"); await db.end();
  await loginAs(page, "admin");
  await page.goto(`/admin/requests/${rows[0].id}`);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: `/tmp/claude-0/scratch/ws-${info.project.name}.png`, fullPage: true });
});
