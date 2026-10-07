import "dotenv/config";
import { existsSync, mkdirSync } from "node:fs";
import { Client } from "pg";
import { expect, test, type Browser, type BrowserContext } from "@playwright/test";
import { demo, loginAs } from "./helpers";

/** Test cleanup with global access (removes only rows this spec created). */
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

// Login endpoints are rate limited per phone and per IP (shared with other suites), so a demo user's session is
// cached on disk (test-results/.auth) and reused across tests, projects and reruns while it remains valid.
const sessions = new Map<string, Promise<BrowserContext>>();
async function as(browser: Browser, key: string) {
  const u = test.info().project.use;
  const id = `${key}-${test.info().project.name}`;
  if (!sessions.has(id)) {
    sessions.set(
      id,
      (async () => {
        const opts = {
          baseURL: u.baseURL,
          viewport: u.viewport,
          userAgent: u.userAgent,
          deviceScaleFactor: u.deviceScaleFactor,
          isMobile: u.isMobile,
          hasTouch: u.hasTouch,
          locale: u.locale,
          timezoneId: u.timezoneId,
          acceptDownloads: true,
        };
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
        await loginAs(p, key);
        mkdirSync("test-results/.auth", { recursive: true });
        await ctx.storageState({ path: file });
        await p.close();
        return ctx;
      })(),
    );
  }
  const ctx = await sessions.get(id)!;
  return ctx.newPage();
}

test.describe.configure({ mode: "serial" });

/** Full-page screenshots for visual review (desktop 1366 / mobile). */
async function shot(page: import("@playwright/test").Page, name: string) {
  await page.screenshot({ path: `test-results/compliance-shots/${test.info().project.name}-${name}.png`, fullPage: true });
}

test.afterAll(async () => {
  for (const c of sessions.values()) await (await c).close().catch(() => undefined);
  sessions.clear();
});

test.describe("compliance runtime", () => {
  test("nazir sees waqf A obligations with due dates and completes one with evidence", async ({ browser }, info) => {
    const { waqfs } = demo();
    const page = await as(browser, "nazir");
    await page.goto(`/app/w/${waqfs.A}/compliance`);
    await expect(page.getByRole("heading", { level: 1, name: "الامتثال والمواعيد" })).toBeVisible();
    await expect(page.getByText("الجاهزية")).toBeVisible();

    // Seeded material-change update for A (OB-REG-02) is listed with both calendars and its reference.
    const reg = page.locator("article").filter({ hasText: "OB-REG-02" }).first();
    await expect(reg).toBeVisible();
    await expect(reg.getByText("الموعد")).toBeVisible();
    await expect(reg.getByText(/هـ/).first()).toBeVisible(); // Hijri date
    await expect(reg.getByText("المرجع النظامي")).toBeVisible();
    await shot(page, "compliance");

    // Add a one-off obligation, then complete it with an evidence document from the waqf's vault.
    const title = `تزويد الهيئة بكشف الأصول (اختبار ${info.project.name} ${Date.now()})`;
    try {
      const manual = page.locator("#manual");
      await manual.getByLabel("الالتزام").fill(title);
      await manual.getByLabel("الموعد النهائي").fill("2026-12-15");
      await manual.getByRole("button", { name: "أضف الالتزام" }).click();
      await expect(manual.getByText("أُضيف الالتزام إلى قائمة الوقف وتقويمه.")).toBeVisible({ timeout: 30_000 });

      const item = page.locator("article").filter({ has: page.getByRole("heading", { name: title }) });
      await expect(item).toBeVisible({ timeout: 15_000 });
      await expect(item.getByText("قادم")).toBeVisible();
      await item.getByText("أنجز مع دليل").click();
      const select = item.getByLabel("وثيقة الدليل");
      await expect(select).toBeVisible();
      const firstDoc = await select.locator("option").nth(1).getAttribute("value");
      expect(firstDoc).toBeTruthy();
      await select.selectOption(firstDoc!);
      await item.getByLabel("ملاحظة (اختياري)").fill("أُرسل الكشف عبر البريد الرسمي (اختبار)");
      await item.getByRole("button", { name: "سجّل الإنجاز" }).click();
      await expect(page.getByText("سُجّل الالتزام منجزًا مع الدليل.")).toBeVisible({ timeout: 30_000 });
      await expect(page).toHaveURL(/view=done/);

      // Done view lists it with its evidence linked.
      await page.goto(`/app/w/${waqfs.A}/compliance?view=done`);
      const done = page.locator("article").filter({ has: page.getByRole("heading", { name: title }) });
      await expect(done.getByText("منجز").first()).toBeVisible();
      await expect(done.locator(`a[href^="/app/w/${waqfs.A}/documents/"]`).first()).toBeVisible();

      // Calendar (list view) shows A's items for the nazir.
      await page.goto("/app/calendar?view=list");
      await expect(page.getByRole("heading", { level: 1, name: "التقويم والالتزامات" })).toBeVisible();
      await expect(page.getByRole("link", { name: /تحديث بيانات الوقف|التغيير الجوهري|تحديث/ }).first()).toBeVisible();
      await page.goto("/app/calendar?view=month&month=2026-12");
      await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
      await shot(page, "calendar-month");
      await page.goto(`/app/w/${waqfs.A}/compliance/violations`);
      await expect(page.getByRole("heading", { level: 1, name: "سجل المخالفات" })).toBeVisible();
      await expect(page.getByText("جدول المخالفات والجزاءات")).toBeVisible();
      await shot(page, "violations");
    } finally {
      await sysQuery(`delete from obligation_instances where waqf_id = $1 and id in (select instance_id from obligation_events where action = 'created' and note like $2)`, [
        waqfs.A,
        `%${title.replace(/[%_]/g, "")}%`,
      ]);
    }
  });

  test("outsider cannot see waqf A compliance or calendar items", async ({ browser }) => {
    const { waqfs } = demo();
    const page = await as(browser, "outsider");
    await page.goto("/app/calendar?view=list");
    await expect(page.getByText("لا توجد التزامات تتابعها")).toBeVisible();
    await expect(page.locator(`a[href^="/app/w/${waqfs.A}/"]`)).toHaveCount(0);

    // Direct URL to A's compliance tab is refused.
    await page.goto(`/app/w/${waqfs.A}/compliance`);
    await expect(page).not.toHaveURL(new RegExp(`/app/w/${waqfs.A}/compliance`));

    // ICS export carries no events for the outsider.
    const ics = await page.request.get("/app/calendar/ics");
    expect(ics.status()).toBe(200);
    const body = await ics.text();
    expect(body).toContain("BEGIN:VCALENDAR");
    expect(body).not.toContain("BEGIN:VEVENT");
    expect(body).not.toContain(waqfs.A);
  });

  test("nazir records a risk in the risk register", async ({ browser }) => {
    const { waqfs } = demo();
    const page = await as(browser, "nazir");
    const title = `تركّز إيرادات الوقف في مستأجر واحد (اختبار ${test.info().project.name} ${Date.now()})`;
    await page.goto(`/app/w/${waqfs.A}/risks`);
    await expect(page.getByRole("heading", { level: 1, name: "سجل المخاطر" })).toBeVisible();
    try {
      const form = page.locator("section").filter({ has: page.getByRole("heading", { name: "أضف خطرًا" }) });
      await form.getByLabel("الخطر").fill(title);
      await form.getByLabel("الفئة").selectOption("market");
      await form.getByLabel("الأثر").selectOption("3");
      await form.getByLabel("الاحتمال").selectOption("2");
      await form.getByLabel("خطة المعالجة").fill("تنويع المستأجرين عند تجديد العقود (اختبار)");
      await form.getByRole("button", { name: "أضف الخطر" }).click();
      await expect(form.getByText("أُضيف الخطر إلى السجل.")).toBeVisible({ timeout: 30_000 });
      const item = page.locator("li").filter({ hasText: title });
      await expect(item.getByText("درجة 6 — مرتفع")).toBeVisible();
      await shot(page, "risks");
    } finally {
      await sysQuery("delete from risk_register where waqf_id = $1 and title = $2", [waqfs.A, title]);
    }
  });

  test("nazir generates the annual GAA package and downloads PDF and ZIP", async ({ browser }) => {
    const { waqfs } = demo();
    const page = await as(browser, "nazir");
    await page.goto(`/app/w/${waqfs.A}/reports`);
    await expect(page.getByRole("heading", { level: 1, name: "التقارير وحزم التصدير" })).toBeVisible();
    await page.getByRole("button", { name: "جهّز الحزمة السنوية" }).click();
    const dl = page.getByRole("link", { name: "نزّل الحزمة" });
    await expect(dl).toBeVisible({ timeout: 30_000 });
    const href = await dl.getAttribute("href");
    await shot(page, "reports");
    const pdf = await page.request.get(href!);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    const zip = await page.request.get(`${href}?format=zip`);
    expect(zip.status()).toBe(200);
    expect(zip.headers()["content-type"]).toContain("application/zip");
    expect((await zip.body()).readUInt32LE(0)).toBe(0x04034b50);
    const reportId = href!.split("/").at(-2)!;
    await sysQuery("update reports set revoked_at = now() where id = $1", [reportId]);
  });
});
