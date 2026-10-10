import { expect, test, type Page } from "@playwright/test";
import { demo, loginAs } from "./helpers";

const A = () => demo().waqfs.A;
const B = () => demo().waqfs.B;

async function askQ(page: Page, q: string) {
  const before = await page.getByTestId("ai-answer").count();
  await page.getByLabel("سؤالك").fill(q);
  await page.getByRole("button", { name: "أرسل السؤال" }).click();
  await expect(page.getByTestId("ai-answer")).toHaveCount(before + 1, { timeout: 30_000 });
  return page.getByTestId("ai-answer").last();
}

test.describe("assistant — nazir on waqf A", () => {
  test("answers from waqf data, cites the library, refuses fatwa, records feedback", async ({ page }, info) => {
    await loginAs(page, "nazir");
    await page.goto(`/app/w/${A()}/assistant`);
    await expect(page.getByRole("heading", { name: "المساعد الذكي" })).toBeVisible();
    await expect(page.getByText("يعمل المساعد بمحرك داخلي")).toBeVisible();

    // 1) upcoming obligations: real data with deep links into the compliance tab
    await page.getByRole("button", { name: "ما الالتزامات القادمة على وقفي؟" }).click();
    const ob = page.getByTestId("ai-answer").last();
    await expect(ob).toHaveAttribute("data-intent", "obligations", { timeout: 30_000 });
    await expect(ob).toContainText("التزامات مفتوحة");
    await expect(ob).toContainText("تحديث سجل المستفيد الحقيقي");
    const obLink = ob.locator(`a[href^="/app/w/${A()}/compliance#i-"]`).first();
    await expect(obLink).toBeVisible();
    await expect(ob.getByTestId("ai-disclosure")).toHaveText(/إجابة آلية مستندة إلى المصادر المذكورة؛ وللرأي المهني في حالتك اطلب استشارة موقّعة/);
    await ob.getByRole("button", { name: /عرض المصادر/ }).click();
    await expect(ob.getByTestId("ai-sources")).toContainText("سجل الالتزامات النظامية لوقفك");

    // 2) general question: extractive answer with library citation
    const kn = await askQ(page, "ما مهمات ناظر الوقف؟");
    await expect(kn).toHaveAttribute("data-intent", "knowledge");
    await expect(kn.locator("blockquote").first()).toBeVisible();
    await kn.getByRole("button", { name: /عرض المصادر/ }).click();
    await expect(kn.getByTestId("ai-sources").locator('a[href^="/library/"]').first()).toBeVisible();
    await kn.getByRole("button", { name: "الإجابة مفيدة" }).click();
    await expect(kn.getByText("شكرًا، سجلنا تقييمك.")).toBeVisible();

    // 3) fatwa request: refusal + route to a human specialist (sharia consultation C07)
    const rf = await askQ(page, "ما حكم الوقف على النفس؟");
    await expect(rf).toHaveAttribute("data-refused", "true");
    await expect(rf.getByTestId("ai-refusal")).toContainText("فتوى");
    const route = rf.getByRole("link", { name: "اطلب استشارة شرعية" });
    await expect(route).toHaveAttribute("href", `/app/requests/new?service=C07&waqf=${A()}`);
    await expect(rf.getByTestId("ai-disclosure")).toBeVisible();

    await page.screenshot({ path: `test-results/ai-assistant-${info.project.name}.png`, fullPage: true });
  });

  test("assessment explainer and request status come from structured data", async ({ page }) => {
    await loginAs(page, "nazir");
    await page.goto(`/app/w/${A()}/assistant`);
    const as = await askQ(page, "ما نتيجة آخر تقييم؟");
    await expect(as).toHaveAttribute("data-intent", "assessment");
    await expect(as).toContainText("الدرجة العامة");
    await expect(as.getByRole("link", { name: "افتح تقرير التقييم كاملًا" })).toHaveAttribute("href", /^\/app\/assessments\//);
    const rq = await askQ(page, "ما حالة طلباتي؟");
    await expect(rq).toHaveAttribute("data-intent", "requests");
    await expect(rq.locator('a[href^="/app/requests/"]').first()).toBeVisible();
  });

  test("document assist suggests fields that need human confirmation", async ({ page }) => {
    await loginAs(page, "nazir");
    await page.goto(`/app/w/${A()}/assistant`);
    await page.getByLabel("الوثيقة").selectOption({ label: "شهادة تسجيل الوقف (تجريبي)" });
    await page.getByRole("button", { name: "اقترح البيانات" }).click();
    const list = page.getByTestId("assist-suggestions");
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list).toContainText("نوع الوثيقة");
    await expect(list).toContainText("مقترح — بانتظار مراجعتك");
    await list.getByRole("button", { name: /ارفض/ }).first().click();
    await expect(list).toContainText("مرفوض");
  });

  test("API validates input and masks nothing it returns from the knowledge base", async ({ page }) => {
    await loginAs(page, "nazir");
    const bad = await page.request.post("/api/ai/ask", { data: { waqfId: A(), question: "" } });
    expect(bad.status()).toBe(400);
    const okRes = await page.request.post("/api/ai/ask", { data: { waqfId: A(), question: "رقمي 0551234567 ما مهلة تسجيل الوقف؟" } });
    expect(okRes.status()).toBe(200);
    const body = await okRes.json();
    expect(body.disclosure).toContain("استشارة موقّعة");
    expect(body.citations.length).toBeGreaterThan(0);
  });
});

test.describe("assistant — access control", () => {
  test("anonymous API call is rejected", async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
    const r = await ctx.post("/api/ai/ask", { data: { waqfId: demo().waqfs.A, question: "ما الالتزامات القادمة؟" } });
    expect(r.status()).toBe(401);
    await ctx.dispose();
  });

  test("outsider cannot use the assistant on waqf A", async ({ page }) => {
    await loginAs(page, "outsider");
    await page.goto(`/app/w/${A()}/assistant`);
    await expect(page).toHaveURL(/\/app\?notfound=1/, { timeout: 60_000 });
    const r = await page.request.post("/api/ai/ask", { data: { waqfId: A(), question: "ما الالتزامات القادمة؟" } });
    expect(r.status()).toBe(403);
    const x = await page.request.post("/api/ai/extract", { data: { waqfId: A(), documentId: "00000000-0000-4000-8000-000000000000" } });
    expect(x.status()).toBe(403);
  });

  test("beneficiary-only member has no assistant access", async ({ page }) => {
    await loginAs(page, "beneficiary");
    await page.goto(`/app/w/${B()}/assistant`);
    // requireWaqf sends beneficiary-only members to their own entitlement view
    await expect(page).toHaveURL(new RegExp(`/app/b/${B()}`), { timeout: 60_000 });
    const r = await page.request.post("/api/ai/ask", { data: { waqfId: B(), question: "ما الالتزامات القادمة؟" } });
    expect(r.status()).toBe(403);
  });
});
