import { expect, test, type Page } from "@playwright/test";
import { uniquePhone } from "./helpers";

/**
 * Public website E2E: home (no horizontal scroll), services → detail → request CTA, library article,
 * FAQ search, contact form, the five tools, legal pages, 404, sitemap/robots.
 */

const shot = (page: Page, name: string) => page.screenshot({ path: `test-results/site-${name}-${test.info().project.name}.png`, fullPage: true });

async function noHorizontalScroll(page: Page) {
  const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
  expect(sw, "page must not scroll horizontally").toBeLessThanOrEqual(iw);
}

test("home renders with paths, journey, catalog and library", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText("غرسٌ يبقى أصله");
  await expect(page.getByRole("link", { name: /أنا واقف/ })).toBeVisible();
  await expect(page.getByRole("heading", { name: "رحلة الوقف، من الفكرة إلى الاستدامة" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "فهرس الخدمات" })).toBeVisible();
  await expect(page.getByRole("link", { name: /التأسيس والتصميم/ })).toBeVisible();
  await expect(page.locator('script[type="application/ld+json"]').first()).toBeAttached();
  await noHorizontalScroll(page);
  await shot(page, "home");

  // Skip link moves focus to main
  await page.keyboard.press("Tab");
  const skip = page.getByRole("link", { name: "تخطَّ إلى المحتوى" });
  await expect(skip).toBeFocused();
  await skip.press("Enter");
  await expect(page).toHaveURL(/#main$/);
});

test("navigation works on this viewport", async ({ page }, info) => {
  await page.goto("/");
  if (info.project.name === "mobile") {
    await page.getByRole("button", { name: "افتح القائمة" }).click();
    const sheet = page.getByRole("navigation", { name: "القائمة الرئيسية للجوال" });
    await expect(sheet).toBeVisible();
    await sheet.getByRole("link", { name: "المكتبة" }).click();
  } else {
    await page.getByRole("button", { name: "لمن نخدم" }).click();
    await expect(page.getByRole("link", { name: /الناظر والمجلس/ })).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("navigation", { name: "القائمة الرئيسية" }).getByRole("link", { name: "المكتبة" }).click();
  }
  await expect(page).toHaveURL(/\/library$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1, name: "المكتبة" })).toBeVisible();
});

test("services: filter, open a service, CTA goes to request form", async ({ page }) => {
  await page.goto("/services");
  await expect(page.getByRole("heading", { level: 2, name: "التأسيس والتصميم" })).toBeVisible();
  await page.getByRole("group", { name: "تصفية الخدمات" }).getByRole("link", { name: "المستفيد" }).click();
  await expect(page).toHaveURL(/audience=beneficiary/, { timeout: 30_000 });
  await expect(page.getByRole("link", { name: "استشارة قانونية" })).toBeVisible();
  await expect(page.getByRole("link", { name: "صياغة وثيقة الوقف" })).toHaveCount(0);
  await noHorizontalScroll(page);

  await page.goto("/services");
  await page.getByRole("link", { name: "صياغة وثيقة الوقف" }).click();
  await expect(page).toHaveURL(/\/services\/T03$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("صياغة وثيقة الوقف");
  await expect(page.getByText("عرض سعر بعد الدراسة").first()).toBeVisible();
  const cta = page.getByRole("link", { name: "اطلب الخدمة" });
  await expect(cta).toHaveAttribute("href", "/app/requests/new?service=T03");
  await noHorizontalScroll(page);
  await shot(page, "service");
  await cta.click();
  await expect(page).toHaveURL(/\/(login|app\/requests\/new)/, { timeout: 30_000 }); // anonymous visitors are asked to sign in

  // License-gated service is labeled and cannot be requested
  await page.goto("/services/N01");
  await expect(page.getByText("تُتاح بعد اعتماد الترخيص").first()).toBeVisible();
  await expect(page.getByRole("link", { name: "اطلب الخدمة" })).toHaveCount(0);
});

test("packages and audience pages render from the catalog", async ({ page }) => {
  await page.goto("/packages");
  await expect(page.getByRole("heading", { level: 2, name: "امتثال" })).toBeVisible();
  await expect(page.getByRole("heading", { name: /باقة ناظر/ })).toBeVisible();
  for (const who of ["waqif", "nazir", "beneficiary", "entities"]) {
    await page.goto(`/for/${who}`);
    await expect(page.getByRole("heading", { name: "خدمات تناسبك" })).toBeVisible();
  }
  await noHorizontalScroll(page);
});

test("library: search, filter and read an article with sanitized markdown", async ({ page }) => {
  await page.goto("/library?q=الموازنة");
  await expect(page.getByRole("status")).toContainText("نتائج البحث");
  await page.waitForLoadState("networkidle");
  await page.goto("/library?kind=guide", { waitUntil: "domcontentloaded" });
  const first = page.locator("article h2 a").first();
  const title = (await first.innerText()).trim();
  await first.click();
  await expect(page).toHaveURL(/\/library\/[a-z0-9-]+$/, { timeout: 30_000 });
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(title);
  const prose = page.locator(".prose-waqf").first();
  await expect(prose.locator("h2").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "المراجع" })).toBeVisible();
  await expect(prose.locator("script, iframe, style")).toHaveCount(0);
  await noHorizontalScroll(page);
  await shot(page, "article");

  // A guide with a table renders it as a real table
  await page.goto("/library/governance-by-waqf-size");
  await expect(page.locator(".prose-waqf table").first()).toBeVisible();
  await page.goto("/regulations");
  await expect(page.getByRole("link", { name: /لائحة تنظيم أعمال النظارة/ }).first()).toBeVisible();
});

test("faq search filters questions", async ({ page }) => {
  await page.goto("/faq");
  await expect(page.locator('script[type="application/ld+json"]')).toBeAttached();
  const box = page.getByLabel("ابحث في الأسئلة");
  await box.fill("الثلث");
  await expect(page.getByRole("status")).toContainText("نتيجة للبحث عن «الثلث»");
  const questions = page.locator("details summary");
  await expect(questions.first()).toContainText(/الثلث|ثلث/);
  await box.fill("كلمةلاوجودلها");
  await expect(page.getByText("لا يوجد سؤال يطابق بحثك")).toBeVisible();
  await box.fill("");
  await page.getByRole("button", { name: "المستفيد", exact: true }).click();
  await questions.first().click();
  await expect(page.locator("details[open] p").first()).toBeVisible();
});

test("glossary has letter index and term anchors", async ({ page }) => {
  await page.goto("/glossary");
  await expect(page.getByRole("navigation", { name: "حروف الهجاء" })).toBeVisible();
  const term = page.locator("dl > div[id]").first();
  const id = await term.getAttribute("id");
  await page.goto(`/glossary#${id}`);
  await expect(page.locator(`[id="${id}"]`)).toBeInViewport();
});

test("contact form validates and submits", async ({ page }) => {
  await page.goto("/contact?topic=service&service=T03");
  await expect(page.getByText("رسالتك بخصوص")).toBeVisible();
  await page.getByRole("button", { name: "أرسل الرسالة" }).click();
  await expect(page.getByText("راجع الحقول المظللة.")).toBeVisible();

  await page.getByLabel("الاسم").fill("زائر اختبار (تجريبي)");
  await page.getByLabel("رقم الجوال").fill(uniquePhone());
  await page.getByLabel("رسالتك").fill("أريد معرفة مدة صياغة وثيقة الوقف وما تحتاجونه مني. (رسالة تجريبية)");
  await page.getByLabel(/أوافق على معالجة بياناتي/).check();
  await page.waitForTimeout(2600); // the form rejects instant (bot-like) submissions
  await page.getByRole("button", { name: "أرسل الرسالة" }).click();
  await expect(page.getByRole("heading", { name: "أُرسلت رسالتك" })).toBeVisible({ timeout: 20_000 });
});

test("tools compute indicative results", async ({ page }) => {
  await page.goto("/tools");
  await expect(page.getByRole("link", { name: /تصنيف نوع الوقف/ })).toBeVisible();
  const result = page.getByTestId("tool-result");

  // 1) waqf type
  await page.goto("/tools/waqf-type");
  await expect(page.getByText("تحسب الأداة نتيجة تقديرية")).toBeVisible();
  await page.getByLabel(/أشخاص معيّنون/).check();
  await page.getByLabel(/بوصف كالفقر أو الحاجة/).check();
  await expect(result).toHaveText("وقف عام (خيري)");
  await page.getByLabel(/الاثنان معًا/).check();
  await expect(result).toHaveText("وقف مشترك");

  // 2) size
  await page.goto("/tools/waqf-size");
  await page.getByLabel("إجمالي قيمة الأصول الموقوفة").fill("75,000,000");
  await expect(result).toHaveText("وقف متوسط");
  await expect(page.getByRole("cell", { name: /قوائم مالية مدققة/ })).toBeVisible();
  await page.getByLabel("إجمالي قيمة الأصول الموقوفة").fill("250000000");
  await expect(result).toHaveText("وقف كبير");

  // 3) registration deadline: Sun 2026-01-04 + 30 business days (Fri/Sat off) = Sun 2026-02-15
  await page.goto("/tools/registration-deadline");
  await page.getByLabel("تاريخ توثيق الوقف لدى الجهة المختصة").fill("2026-01-04");
  await expect(result).toContainText("15");
  await expect(result).toContainText("فبراير");
  await expect(page.getByText("30 يوم عمل تعادل هنا")).toBeVisible();

  // 4) one third: net 900k → third 300k; 400k bequest exceeds by 100k
  await page.goto("/tools/will-third");
  await page.getByLabel("إجمالي الأموال المتوقعة في التركة").fill("1000000");
  await page.getByLabel("الديون").fill("100000");
  await page.getByLabel("قيمة ما توصي بوقفه").fill("400000");
  await expect(result).toContainText("تتجاوز الثلث");
  await expect(result).toContainText("100,000");
  await page.getByLabel("قيمة ما توصي بوقفه").fill("250000");
  await expect(result).toContainText("في حدود الثلث");

  // 5) nazir readiness
  await page.goto("/tools/nazir-readiness");
  await expect(result).toHaveText("0٪");
  await page.getByLabel(/مسجلة لدى الهيئة/).check();
  await page.getByLabel(/حساب بنكي مستقل/).check();
  await expect(result).not.toHaveText("0٪");
  await noHorizontalScroll(page);
  await shot(page, "tool-readiness");
});

test("legal and about pages render from content", async ({ page }) => {
  for (const p of ["terms", "privacy", "cookies", "ai", "accessibility", "disclaimer"]) {
    await page.goto(`/legal/${p}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.locator(".prose-waqf h2").first()).toBeVisible();
  }
  await page.goto("/about");
  await expect(page.getByRole("heading", { name: "بيانات الشركة والتراخيص" })).toBeVisible();
  await expect(page.getByText("تُتاح خدمات النظارة بعد اعتماده")).toBeVisible();
});

test("404, sitemap and robots", async ({ page, request }) => {
  const r = await page.goto("/no-such-page-xyz");
  expect(r?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "لم نجد هذه الصفحة" })).toBeVisible();
  const r2 = await page.goto("/library/no-such-article");
  expect(r2?.status()).toBe(404);

  const sm = await request.get("/sitemap.xml");
  expect(sm.ok()).toBeTruthy();
  const xml = await sm.text();
  expect(xml).toContain("/services/T03");
  expect(xml).toContain("/library/");
  const rb = await (await request.get("/robots.txt")).text();
  expect(rb).toContain("Disallow: /app");
  expect(rb).toContain("Disallow: /admin");
  expect(rb).toContain("Disallow: /api");
});
