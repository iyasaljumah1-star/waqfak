import "dotenv/config";
import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { expect, test, type Browser, type BrowserContext, type Locator, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

/**
 * Scenario 3 — board meeting lifecycle on waqf C, across four browser contexts:
 * chair creates the meeting and invites → members declare conflicts (member1 declares one on item 1) →
 * attendance + quorum → votes (member1 excluded on item 1; tie on item 2 settled by the chair's casting vote) →
 * secretary drafts and circulates minutes → every attendee signs with OTP → secretary locks →
 * chair turns a resolution into a task for member2, who sees it in «مهامي».
 */

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
  const page = await (await sessions.get(id)!).newPage();
  page.on("dialog", (d) => d.accept());
  return page;
}

async function shot(page: Page, name: string) {
  await page.screenshot({ path: `storage/.e2e-shots/governance/${test.info().project.name}-${name}.png`, fullPage: true });
}

/** The shared dev server is slow under parallel load; server actions can take tens of seconds. */
const T = 120_000;

const item = (page: Page, n: number) => page.getByTestId(`agenda-${n}`);

async function declareNone(page: Page, n: number) {
  const it = item(page, n);
  await it.getByRole("button", { name: "أقرّ بعدم وجود تعارض" }).click();
  await expect(it.getByText(/سُجّل إقرارك بعدم وجود تعارض|إقرارك: لا تعارض/)).toBeVisible({ timeout: T });
}

async function vote(page: Page, n: number, label: "موافق" | "معارض" | "ممتنع") {
  const it = item(page, n);
  await it.getByLabel(label, { exact: true }).check();
  await it.getByRole("button", { name: "سجّل صوتي" }).click();
  await expect(it.getByText(/سُجّل صوتك|صوتك:/).first()).toBeVisible({ timeout: T });
}

async function sign(page: Page) {
  const box: Locator = page.locator("#minutes");
  await box.getByRole("button", { name: "أرسل رمز التوقيع" }).click();
  const code = (await box.getByTestId("demo-otp").innerText({ timeout: T })).trim();
  await box.getByLabel("رمز التوقيع").fill(code);
  await box.getByLabel(/قرأت المحضر كاملًا/).check();
  await box.getByRole("button", { name: "وقّع المحضر" }).click();
  // On success the signing form gives way to the signature list.
  await expect(box.getByLabel("رمز التوقيع")).toHaveCount(0, { timeout: T });
  await expect(box.getByRole("alert")).toHaveCount(0);
}

test.describe.configure({ mode: "serial" });

test.afterAll(async () => {
  for (const c of sessions.values()) await (await c).close().catch(() => undefined);
  sessions.clear();
});

test("scenario 3: board meeting from invitation to locked minutes and a resolution task", async ({ browser }, info) => {
  test.setTimeout(1_500_000);
  const { waqfs, users } = demo();
  const C = waqfs.C;
  const stamp = `${info.project.name} ${Date.now() % 100000}`;
  const title = `اجتماع اختبار المجلس (${stamp})`;

  // ── Chair: governance home → new meeting with two decision items → invitations
  const chair = await as(browser, "chair");
  await chair.goto(`/app/w/${C}/governance`);
  await expect(chair.getByRole("heading", { level: 1, name: "الحوكمة والاجتماعات" })).toBeVisible();
  await expect(chair.locator("#board").getByText("مستقل", { exact: true }).first()).toBeVisible();
  await shot(chair, "home");
  const form = chair.locator("#new-meeting");
  await form.getByLabel("عنوان الاجتماع").fill(title);
  await form.getByLabel("نوع الاجتماع").selectOption("extraordinary");
  await form.getByLabel("التاريخ والوقت").fill("2026-10-20T10:00");
  await form.getByLabel("المكان").fill("مقر الوقف (اختبار)");
  await form.getByLabel("رابط الاجتماع عن بُعد").fill("https://meet.example.test/board");
  await form.getByLabel("جدول الأعمال").fill("! تعيين مدير أملاك جديد\n! اعتماد خطة الصيانة السنوية");
  await form.getByRole("button", { name: "أنشئ الاجتماع" }).click();
  await chair.waitForURL(/\/governance\/meetings\/[0-9a-f-]{36}$/, { timeout: T });
  const url = new URL(chair.url()).pathname;
  await expect(chair.getByRole("heading", { level: 1, name: title })).toBeVisible();
  await expect(chair.getByText(/MTG-\d{6}/).first()).toBeVisible();
  await chair.getByRole("button", { name: "أرسل الدعوات" }).click();
  await expect(chair.getByText(/أُرسلت الدعوة إلى 4/)).toBeVisible({ timeout: T });

  // ── Conflict declarations: member1 declares an actual conflict on item 1; everyone else declares none
  const m1 = await as(browser, "member1");
  await m1.goto(url);
  const it1 = item(m1, 1);
  await it1.getByLabel("تعارض فعلي").check();
  await it1.getByLabel("طبيعة التعارض").fill("المرشح لإدارة الأملاك قريب من الدرجة الثانية (اختبار)");
  await it1.getByRole("button", { name: "أفصح عن التعارض" }).click();
  await expect(it1.getByText(/سُجّل إفصاحك|إقرارك: تعارض فعلي/).first()).toBeVisible({ timeout: T });
  await declareNone(m1, 2);

  const m2 = await as(browser, "member2");
  await m2.goto(url);
  await declareNone(m2, 1);
  await declareNone(m2, 2);

  await chair.reload();
  await declareNone(chair, 1);
  await declareNone(chair, 2);
  await expect(item(chair, 1).getByText(/أفصح عن تعارض: عضو مجلس تجريبي — نورة/)).toBeVisible();

  // ── Attendance + quorum (majority incl. one independent)
  for (const name of ["رئيس مجلس تجريبي — فهد", "عضو مجلس تجريبي — نورة", "عضو مستقل تجريبي — خالد", "أمين سر تجريبي — هند"]) {
    await chair.getByLabel(`حضور ${name}`, { exact: true }).selectOption("present");
  }
  await chair.getByRole("button", { name: "احفظ كشف الحضور" }).click();
  await expect(chair.getByText("حُفظ كشف الحضور.")).toBeVisible({ timeout: T });
  await chair.getByRole("button", { name: "تحقق من النصاب وابدأ الاجتماع" }).click();
  await expect(chair.getByText(/اكتمل النصاب \(3 من 3/)).toBeVisible({ timeout: T });

  // ── Open votes on both items
  for (const n of [1, 2]) {
    const it = item(chair, n);
    await it.getByText("اطرح للتصويت").click();
    await it.getByRole("button", { name: "افتح التصويت" }).click();
    await expect(it.getByText(/RES-\d{6}/).first()).toBeVisible({ timeout: T });
  }
  // member1 was recused automatically: 2 eligible voters on item 1, 3 on item 2
  await expect(item(chair, 1).getByText("صوّت 0 من 2 مؤهلين للتصويت على هذا البند.")).toBeVisible();
  await expect(item(chair, 2).getByText("صوّت 0 من 3 مؤهلين للتصويت على هذا البند.")).toBeVisible();

  // Item 1: chair + member2 vote for; member1 is excluded (no vote form)
  await vote(chair, 1, "موافق");
  await m2.reload();
  await vote(m2, 1, "موافق");
  await m1.reload();
  await expect(item(m1, 1).getByText("أنت مستبعد من التصويت على هذا البند")).toBeVisible();
  await expect(item(m1, 1).getByRole("button", { name: "سجّل صوتي" })).toHaveCount(0);
  await expect(item(m1, 1).getByTestId("my-vote")).toHaveText(/مستبعد لتعارض المصالح/);
  await shot(m1, "member1-excluded");

  // Item 2: 1 for, 1 against, 1 abstain → tie settled by the chair's casting vote
  await vote(m1, 2, "معارض");
  await vote(m2, 2, "ممتنع");
  await chair.reload();
  await vote(chair, 2, "موافق");

  // Votes cannot be altered: no vote form remains for the chair
  await expect(item(chair, 2).getByRole("button", { name: "سجّل صوتي" })).toHaveCount(0);

  for (const n of [1, 2]) {
    await item(chair, n).getByRole("button", { name: "أغلق التصويت واحسب النتيجة" }).click();
    await expect(item(chair, n).getByText(/RES-\d{6}.*معتمد/).first()).toBeVisible({ timeout: T });
  }
  await expect(item(chair, 1).getByText(/مستبعد\s*1/)).toBeVisible();
  await expect(item(chair, 2).getByText("تعادلت الأصوات فرجح صوت الرئيس")).toBeVisible();

  // ── Secretary drafts minutes (decisions listed automatically), completes the summaries, circulates
  const sec = await as(browser, "secretary");
  await sec.goto(url);
  await sec.getByRole("button", { name: "أنشئ مسودة المحضر" }).click();
  const body = sec.getByLabel("نص المحضر");
  await expect(body).toBeVisible({ timeout: T });
  const draft = await body.inputValue();
  expect(draft).toMatch(/RES-\d{6}/);
  expect(draft).toContain("فاستُبعد من المداولة والتصويت");
  await body.fill(draft.replace(/ملخص المداولة: \n/g, "ملخص المداولة: نوقش البند واطلع الأعضاء على المستندات (اختبار).\n"));
  await sec.getByRole("button", { name: "احفظ المسودة" }).click();
  await expect(sec.getByText("حُفظت المسودة.")).toBeVisible({ timeout: T });
  await sec.getByRole("button", { name: "عمّم المحضر للتوقيع" }).click();
  await expect(sec.getByText("التوقيعات (0 من 4)")).toBeVisible({ timeout: T });

  // ── Every attendee signs with an OTP bound to the minutes hash
  await sec.reload();
  await sign(sec);
  for (const p of [chair, m1, m2]) {
    await p.reload();
    await sign(p);
  }

  // ── Lock; afterwards the minutes are read-only
  await sec.reload();
  await sec.getByRole("button", { name: "أقفل المحضر" }).click();
  await expect(sec.getByText("المحضر مقفل").first()).toBeVisible({ timeout: T });
  await sec.reload();
  await expect(sec.getByRole("status").filter({ hasText: "المحضر مقفل" }).first()).toBeVisible();
  await expect(sec.getByLabel("نص المحضر")).toHaveCount(0);
  await expect(sec.getByRole("button", { name: "أعده إلى مسودة" })).toHaveCount(0);
  await expect(sec.getByText(/التوقيعات \(4 من 4\)/)).toBeVisible();
  await shot(sec, "meeting-locked");

  // ── Chair creates an execution task from resolution 1 and assigns member2
  await chair.reload();
  const r1 = item(chair, 1);
  await r1.getByText("أنشئ مهمة تنفيذ").click();
  const taskTitle = `تعيين مدير الأملاك (${stamp})`;
  await r1.getByLabel("المهمة").fill(taskTitle);
  const opt = await r1.getByLabel("المكلّف").locator("option", { hasText: "خالد" }).first().getAttribute("value");
  await r1.getByLabel("المكلّف").selectOption(opt!);
  await r1.getByLabel("الموعد").fill("2026-11-15");
  await r1.getByRole("button", { name: "أنشئ المهمة" }).click();
  await expect(chair.getByText(/أُنشئت مهمة تنفيذ للقرار RES-\d{6}/)).toBeVisible({ timeout: T });

  await chair.goto(`/app/w/${C}/tasks`);
  await expect(chair.getByRole("link", { name: taskTitle })).toBeVisible();
  await shot(chair, "tasks");
  await chair.goto(`/app/w/${C}/governance#resolutions`);
  await expect(chair.locator("#resolutions").getByText("المهام 0/1").first()).toBeVisible();
  await shot(chair, "home-after");

  await m2.goto("/app/tasks");
  await expect(m2.getByRole("heading", { level: 1, name: "مهامي" })).toBeVisible();
  const card = m2.getByTestId("task-card").filter({ hasText: taskTitle });
  await expect(card).toBeVisible();
  await card.getByRole("link", { name: taskTitle }).click();
  await m2.waitForURL(/\/tasks\/[0-9a-f-]{36}$/);
  await expect(m2.getByText(/القرار RES-\d{6}/).first()).toBeVisible();
  await m2.getByLabel("تعليق").fill("بدأت التواصل مع المرشحين (اختبار)");
  await m2.getByRole("button", { name: "أضف التعليق" }).click();
  await expect(m2.getByText("أُضيف التعليق.")).toBeVisible({ timeout: T });
  await m2.getByLabel("الحالة").selectOption("in_progress");
  await m2.getByRole("button", { name: "حدّث" }).click();
  await expect(m2.getByText("حُدّثت المهمة.")).toBeVisible({ timeout: T });
  await shot(m2, "task-detail");
  void users;
});

test("non-members cannot open board meetings", async ({ browser }) => {
  const { waqfs } = demo();
  const outsider = await as(browser, "outsider");
  await outsider.goto(`/app/w/${waqfs.C}/governance`);
  await expect(outsider).toHaveURL(/\/app\?notfound=1/, { timeout: T });
});
