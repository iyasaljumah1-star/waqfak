import { expect as baseExpect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { demo, loginAs, uniquePhone } from "./helpers";

/** Same flow as helpers.signup, with waits sized for a busy dev server (the shared helper uses 5s URL waits). */
async function signupSlow(page: Page, name: string) {
  await page.goto("/signup");
  await page.getByLabel("الاسم الكامل").fill(name);
  await page.getByLabel("رقم الجوال").fill(uniquePhone());
  await page.getByLabel(/قرأت/).check();
  await page.getByRole("button", { name: "أنشئ الحساب" }).click();
  await page.waitForURL(/\/verify/, { timeout: 90_000 });
  const code = (await page.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim();
  await page.getByLabel("رمز التحقق").fill(code);
  await page.getByRole("button", { name: "تحقّق" }).click();
  await page.waitForURL(/\/app/, { timeout: 90_000 });
}

const expect = baseExpect.configure({ timeout: 30_000 });
const shot = (name: string, project: string) => `test-results/waqf-file-${project}-${name}.png`;

test.describe("waqf file & establish wizard", () => {
  test.use({ navigationTimeout: 120_000 });
  test("scenario 2: signup → establish wizard → save → resume → finish → request a service", async ({ page }, info) => {
    test.setTimeout(300_000);
    await signupSlow(page, "واقف اختبار (تجريبي)");
    await page.goto("/app/establish");
    await page.getByRole("button", { name: "ابدأ وقفًا جديدًا" }).click();
    await page.waitForURL(/\/app\/establish\/[0-9a-f-]{36}\?step=1/);
    const draftId = page.url().match(/establish\/([0-9a-f-]{36})/)![1];

    // 1. classification first
    await page.getByLabel(/ذريتي أو أقاربي/).check();
    await page.getByLabel("لا، لهم جميعًا").check();
    await page.getByLabel("نعم", { exact: true }).check();
    await expect(page.getByTestId("computed-type")).toContainText("خاص");
    await page.screenshot({ path: shot("wizard-step1", info.project.name), fullPage: true });
    await page.getByRole("button", { name: "التالي" }).click();
    await page.waitForURL(/step=2/);

    // 2. founder (name prefilled from the account)
    await expect(page.locator('input[name="name"]')).toHaveValue("واقف اختبار (تجريبي)");
    await page.getByRole("button", { name: "التالي" }).click();
    await page.waitForURL(/step=3/);

    // 3. assets — then save and leave
    const step3 = page.getByTestId("wizard-step-3");
    await step3.locator('select[name="a.category"]').first().selectOption("real_estate");
    await step3.locator('input[name="a.title"]').first().fill("عمارة سكنية للاختبار (تجريبي)");
    await step3.locator('input[name="a.value"]').first().fill("2500000");
    await expect(step3).toContainText("صغير");
    await page.getByRole("button", { name: "احفظ واخرج" }).click();
    await page.waitForURL(/\/app\/establish\?saved=/);

    // leave, then resume from the drafts list
    await page.goto("/app");
    await page.goto("/app/establish");
    await page.locator(`a[href^="/app/establish/${draftId}"]`).click();
    await page.waitForURL(new RegExp(`${draftId}\\?step=3`));
    await expect(page.locator('input[name="a.title"]').first()).toHaveValue("عمارة سكنية للاختبار (تجريبي)");
    await page.getByRole("button", { name: "التالي" }).click();
    await page.waitForURL(/step=4/);

    // 4. beneficiaries & conditions — missing final destination is refused
    const step4 = page.getByTestId("wizard-step-4");
    await step4.locator('input[name="c.name"]').first().fill("أولاد الواقف ذكورًا وإناثًا");
    await step4.locator('select[name="c.divisionRule"]').first().selectOption("male_double");
    await page.getByRole("button", { name: "التالي" }).click();
    await expect(page.getByRole("alert").filter({ hasText: "جهة بر دائمة" })).toBeVisible();
    await page.getByLabel("المآل إذا انقطع المستحقون").fill("الفقراء والمساكين");
    await page.getByRole("button", { name: "التالي" }).click();
    await page.waitForURL(/step=5/);

    // 5. nazara
    await page.getByLabel("صيغة النظارة").selectOption("founder");
    await page.getByRole("button", { name: "التالي" }).click();
    await page.waitForURL(/step=6/);

    // 6. revenue allocation (> 100% is refused)
    await page.getByLabel("عمارة الأصول وصيانتها (%)").fill("80");
    await page.getByLabel("الاحتياطي (%)").fill("30");
    await expect(page.getByText("يتجاوز 100%").first()).toBeVisible();
    await page.getByLabel("الاحتياطي (%)").fill("5");
    await page.getByRole("button", { name: "التالي" }).click();
    await page.waitForURL(/step=7/);

    // 7. review → name → finish
    await page.getByLabel("اسم الوقف كما تريده في الوثيقة").fill("وقف الاختبار الأهلي (تجريبي)");
    await page.getByRole("button", { name: "احفظ الاسم" }).click();
    await page.waitForURL(/step=7/);
    await expect(page.getByTestId("deed-draft")).toContainText("مسودة استرشادية تتطلب مراجعة قانونية وشرعية");
    await expect(page.getByTestId("deed-draft")).toContainText("للذكر مثل حظ الأنثيين");
    await page.getByRole("button", { name: "اعتمد المسودة وأنشئ ملف الوقف" }).click();
    await page.waitForURL(/done=1/);
    await expect(page.getByText("اعتُمدت المسودة ونُقلت بياناتها إلى ملف الوقف")).toBeVisible();
    await page.screenshot({ path: shot("wizard-done", info.project.name), fullPage: true });

    // the waqf file now exists with the founder as nazir
    await page.goto(`/app/w/${draftId}/beneficiaries`);
    await expect(page.getByTestId("beneficiary-class").first()).toContainText("أولاد الواقف");

    // request the documentation service
    await page.goto(`/app/establish/${draftId}?step=7`);
    await page.getByTestId("request-documentation").click();
    await page.waitForURL(/\/app\/requests\/new\?service=T03/);
    await expect(page.getByLabel("الوقف")).toHaveValue(draftId);
    await page.getByLabel("تفاصيل الطلب").fill("صياغة نهائية لوثيقة الوقف من مسودة المعالج (اختبار آلي).");
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?created=1/);
  });

  test("nazir adds an asset and a beneficiary class on waqf A", async ({ page }, info) => {
    test.setTimeout(180_000);
    await loginAs(page, "nazir");
    const A = demo().waqfs.A;
    const title = `مستودع اختبار ${Date.now()} (تجريبي)`;
    await page.goto(`/app/w/${A}/assets`);
    await page.getByTestId("add-asset").locator("summary").click();
    const form = page.getByTestId("add-asset-form");
    await form.getByLabel("وصف الأصل").fill(title);
    await form.getByLabel("النوع").selectOption("real_estate");
    await form.getByLabel("القيمة السوقية (ريال)").fill("1200000");
    await form.getByRole("button", { name: "أضف الأصل" }).click();
    await expect(form.getByRole("status")).toContainText("أُضيف الأصل", { timeout: 30_000 });
    await expect(page.getByRole("link", { name: title }).first()).toBeVisible();
    await page.screenshot({ path: shot("assets", info.project.name), fullPage: true });

    const cls = `فئة اختبار ${Date.now()}`;
    await page.goto(`/app/w/${A}/beneficiaries`);
    await page.getByTestId("add-class").locator("summary").click();
    const cf = page.getByTestId("add-class-form");
    await cf.getByLabel("المصرف أو وصف المستحقين").fill(cls);
    await cf.getByRole("button", { name: "أضف المصرف" }).click();
    await expect(cf.getByRole("status")).toContainText("أُضيف المصرف", { timeout: 30_000 });
    await expect(page.getByTestId("beneficiary-class").filter({ hasText: cls })).toBeVisible();
  });

  test("beneficial-owner fields are masked", async ({ page }, info) => {
    await loginAs(page, "nazir");
    await page.goto(`/app/w/${demo().waqfs.A}/beneficiaries`);
    const reg = page.getByTestId("bo-register");
    await expect(reg).toContainText("5678");
    await expect(reg.locator('[data-masked="true"]').first()).toBeVisible();
    const html = await page.content();
    expect(html).not.toContain("1012345678");
    expect(html).not.toContain("شارع 1");
    await reg.scrollIntoViewIfNeeded();
    await page.screenshot({ path: shot("bo-masked", info.project.name), fullPage: true });
  });

  test("beneficiary-only user cannot open the beneficiary register of waqf B", async ({ page }) => {
    await loginAs(page, "beneficiary");
    const B = demo().waqfs.B;
    await page.goto(`/app/w/${B}/beneficiaries`);
    await page.waitForURL(new RegExp(`/app/b/${B}`));
    expect(page.url()).not.toContain("/beneficiaries");
  });
});
