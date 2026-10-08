import "dotenv/config";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { Client } from "pg";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

/**
 * Scenario 4 — beneficiary portal on waqf B: the beneficiary sees only their own record, entitlement and payments,
 * submits an information request and a complaint; the nazir (waqif of B) answers; the beneficiary sees the answer;
 * an outsider is redirected away.
 */

const T = 120_000; // shared dev server is slow under parallel load

/** loginAs with a cache check first, then a phone-OTP login tolerant of a slow shared dev server. */
async function loginPatiently(page: Page, key: string) {
  const u = demo().users[key];
  const cache = `storage/.e2e-auth/${key}.json`;
  if (existsSync(cache) && Date.now() - statSync(cache).mtimeMs < 8 * 60_000) return loginAs(page, key);
  await page.goto("/login");
  await page.getByLabel("رقم الجوال").fill(u.phone);
  await page.getByRole("button", { name: "أرسل رمز الدخول" }).click();
  await expect(page).toHaveURL(/\/verify/, { timeout: 120_000 });
  const code = (await page.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(code);
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL(/\/app/, { timeout: 120_000 });
  mkdirSync("storage/.e2e-auth", { recursive: true });
  writeFileSync(cache, JSON.stringify(await page.context().cookies()));
}

const sessions = new Map<string, Promise<BrowserContext>>();
async function as(browser: Browser, key: string): Promise<Page> {
  const u = test.info().project.use;
  const id = `${key}-${test.info().project.name}`;
  if (!sessions.has(id)) {
    sessions.set(
      id,
      (async () => {
        const opts = { baseURL: u.baseURL, viewport: u.viewport, userAgent: u.userAgent, deviceScaleFactor: u.deviceScaleFactor, isMobile: u.isMobile, hasTouch: u.hasTouch, locale: u.locale, timezoneId: u.timezoneId };
        const file = `test-results/.auth/${key}.json`;
        if (existsSync(file)) {
          const ctx = await browser.newContext({ ...opts, storageState: file });
          const p = await ctx.newPage();
          await p.goto("/app/profile");
          const ok = !/\/login/.test(p.url());
          await p.close();
          if (ok) return ctx;
          await ctx.close();
        }
        const ctx = await browser.newContext(opts);
        const p = await ctx.newPage();
        await loginPatiently(p, key);
        mkdirSync("test-results/.auth", { recursive: true });
        await ctx.storageState({ path: file });
        await p.close();
        return ctx;
      })(),
    );
  }
  return (await sessions.get(id)!).newPage();
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `storage/.e2e-shots/beneficiary/${test.info().project.name}-${name}.png`, fullPage: true });
}

async function sysQuery(text: string, params: unknown[] = []) {
  const c = new Client({ connectionString: process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL });
  await c.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('app.global_access','on',true)");
    const r = await c.query(text, params);
    await c.query("commit");
    return r.rows;
  } finally {
    await c.end();
  }
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  for (const c of sessions.values()) await (await c).close().catch(() => undefined);
  sessions.clear();
});

test("scenario 4: beneficiary sees only their entitlement, asks, complains and reads the nazir's answer", async ({ browser }, info) => {
  test.setTimeout(900_000);
  const { waqfs } = demo();
  const B = waqfs.B;
  const stamp = `${info.project.name}-${Date.now() % 100000}`;
  const infoSubject = `طلب الاطلاع على القوائم المالية (${stamp})`;
  const complaintSubject = `تأخر إشعار الصرف (${stamp})`;
  try {
    const ben = await as(browser, "beneficiary");
    await ben.goto(`/app/b/${B}`);
    await expect(ben.getByRole("heading", { level: 1, name: /وقف آل سالم الأهلي/ })).toBeVisible();
    // Own record and entitlement only
    await expect(ben.locator("section").filter({ hasText: "بياناتك في سجل المستفيدين" }).getByText("مستفيد تجريبي — ريم")).toBeVisible();
    await expect(ben.getByText(/23,000|23٬000/).first()).toBeVisible();
    await expect(ben.getByText(/21,500|21٬500/).first()).toBeVisible();
    for (const other of ["ماجد", "لمى", "يوسف"]) await expect(ben.getByText(other)).toHaveCount(0);
    await expect(ben.getByText("النظارة", { exact: true })).toBeVisible();
    await shot(ben, "portal");

    // The waqf file itself is closed to beneficiary-only members → redirected to the portal
    await ben.goto(`/app/w/${B}`);
    await expect(ben).toHaveURL(new RegExp(`/app/b/${B}`), { timeout: T });
    await ben.goto(`/app/w/${B}/beneficiaries`);
    await expect(ben).toHaveURL(new RegExp(`/app/b/${B}`), { timeout: T });

    // Information request (default kind)
    const form = ben.locator("#new");
    await form.getByLabel("الموضوع").fill(infoSubject);
    await form.getByLabel("التفاصيل").fill("أرغب في الاطلاع على القوائم المالية لعام 2025 وأساس احتساب نصيبي (اختبار).");
    await form.getByRole("button", { name: "أرسل الطلب" }).click();
    await expect(form.getByText(/استلمنا طلب اطلاع برقم CMP-\d{6}/)).toBeVisible({ timeout: T });

    // Complaint
    await form.getByText("شكوى", { exact: true }).click();
    await form.getByLabel("الموضوع").fill(complaintSubject);
    await form.getByLabel("التفاصيل").fill("لم يصلني إشعار بموعد صرف الدفعة الأخيرة (اختبار).");
    await form.getByRole("button", { name: "أرسل الطلب" }).click();
    await expect(form.getByText(/استلمنا شكوى برقم CMP-\d{6}/)).toBeVisible({ timeout: T });

    const subs = ben.locator("#submissions");
    await expect(subs.getByTestId("submission").filter({ hasText: infoSubject })).toBeVisible({ timeout: T });
    await expect(subs.getByTestId("submission").filter({ hasText: complaintSubject })).toContainText("جديد");

    // Nazir of B answers both
    const nazir = await as(browser, "waqif");
    await nazir.goto(`/app/w/${B}/complaints`);
    await expect(nazir.getByRole("heading", { level: 1, name: "الشكاوى والاستفسارات" })).toBeVisible();
    const infoRow = nazir.getByTestId("complaint").filter({ hasText: infoSubject });
    await expect(infoRow).toBeVisible();
    await expect(infoRow).toContainText("مستفيد تجريبي — ريم");
    await expect(infoRow).toContainText("الرد مطلوب قبل");
    await shot(nazir, "nazir-inbox");
    const answer = `أُرفقت القوائم المالية لعام 2025 في ملف الوقف، ويُحتسب نصيبك بربع صافي الغلة (اختبار ${stamp}).`;
    await infoRow.getByLabel(/الرد على CMP-/).fill(answer);
    await infoRow.getByRole("button", { name: "أرسل الرد" }).click();
    await expect(infoRow.locator("p", { hasText: answer })).toBeVisible({ timeout: T });
    await expect(infoRow).toContainText("تم الرد");

    const cRow = nazir.getByTestId("complaint").filter({ hasText: complaintSubject });
    await cRow.getByRole("button", { name: "قيد المعالجة" }).click();
    await expect(cRow).toContainText("قيد المعالجة", { timeout: T });
    const cAnswer = `سنرسل إشعار الصرف عبر المنصة قبل كل دفعة بأسبوع (اختبار ${stamp}).`;
    await cRow.getByLabel(/الرد على CMP-/).fill(cAnswer);
    await cRow.getByLabel("أغلق الطلب بعد الرد").check();
    await cRow.getByRole("button", { name: "أرسل الرد" }).click();
    // Closed requests leave the default (open) list
    await expect(nazir.getByTestId("complaint").filter({ hasText: complaintSubject })).toHaveCount(0, { timeout: T });
    await nazir.goto(`/app/w/${B}/complaints?f=all`);
    await expect(nazir.getByTestId("complaint").filter({ hasText: complaintSubject })).toContainText("مغلق");

    // Beneficiary sees both answers
    await ben.goto(`/app/b/${B}`);
    const s1 = ben.locator("#submissions").getByTestId("submission").filter({ hasText: infoSubject });
    await expect(s1.getByTestId("response")).toHaveText(answer);
    await expect(s1).toContainText("تم الرد");
    const s2 = ben.locator("#submissions").getByTestId("submission").filter({ hasText: complaintSubject });
    await expect(s2.getByTestId("response")).toHaveText(cAnswer);
    await expect(s2).toContainText("مغلق");
    await ben.locator("#submissions").scrollIntoViewIfNeeded();
    await shot(ben, "portal-answered");

    // The beneficiary got an in-app notification
    await ben.goto("/app/notifications");
    await expect(ben.getByText("تم الرد على طلبك").first()).toBeVisible();
  } finally {
    await sysQuery("delete from complaints where waqf_id = $1 and subject like $2", [B, `%(${stamp})`]);
  }
});

test("outsider is redirected away from the beneficiary portal", async ({ browser }) => {
  const { waqfs } = demo();
  const out = await as(browser, "outsider");
  await out.goto(`/app/b/${waqfs.B}`);
  await expect(out).toHaveURL(/\/app\?notfound=1/, { timeout: T });
});
