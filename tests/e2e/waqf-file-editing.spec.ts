import { expect as baseExpect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { demo, loginAs, uniquePhone } from "./helpers";

/**
 * Order of 2026-10-24: a waqf file is completed and corrected after it is created (by its founder while no nazir holds it
 * on the platform, and by the team's file editors), changes of a documented file go to review, and the homes keep
 * complete waqfs, files being completed and service requests apart.
 */
const expect = baseExpect.configure({ timeout: 30_000 });
const T = 60_000;
const pdf = (s: string) => Buffer.from(`%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n% ${s}\ntrailer << /Root 1 0 R >>\n%%EOF`);
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_OWNER_URL="));
  const c = new pg.Client({ connectionString: line!.slice("DATABASE_OWNER_URL=".length).trim() });
  await c.connect();
  try { return (await c.query(q, params)).rows as T[]; } finally { await c.end(); }
}
const open = async (page: Page, summary: string) => {
  const d = page.locator("details").filter({ has: page.locator("summary", { hasText: summary }) }).last();
  if (!(await d.getAttribute("open"))) await d.locator("summary").click();
  return d;
};

test.describe.serial("waqf file editing and the separation of waqfs from requests", () => {
  test.skip(({ isMobile }) => isMobile, "data steps run once on desktop; the homes are checked on mobile below");
  let client: Page;
  let waqfId = "";
  // the documented test waqf is archived afterwards: other suites (tests/compliance-engine.test.ts) count the documented
  // waqfs of each size in the shared database
  test.afterAll(async () => { if (waqfId) await sql("update waqfs set archived_at = now() where id = $1", [waqfId]); });

  test("a founder registers an existing waqf: it is a file being completed, not a waqf yet", async ({ browser }) => {
    test.setTimeout(240_000);
    client = await (await browser.newContext()).newPage();
    await client.goto("/signup");
    await client.getByLabel("الاسم الكامل").fill("واقف تحرير الملف (تجريبي)");
    await client.getByLabel("رقم الجوال").fill(uniquePhone());
    await client.getByLabel(/قرأت/).check();
    await client.getByRole("button", { name: "أنشئ الحساب" }).click();
    await client.waitForURL(/\/verify/, { timeout: T });
    await client.getByLabel("رمز التحقق").fill((await client.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim());
    await client.getByRole("button", { name: "تحقّق" }).click();
    await client.waitForURL(/\/app/, { timeout: T });

    await client.goto("/app/waqfs/new");
    const f = client.locator("main form").first();
    await f.locator('[name="name"]').fill("وقف اختبار التحرير الآلي (تجريبي)");
    await f.locator('[name="deedNo"]').fill(`44${String(Date.now()).slice(-8)}`);
    await f.locator('[name="deedDate"]').fill("2024-03-10");
    await f.locator('[name="documentedOn"]').fill("2024-03-10");
    await f.locator('[name="legalType"]').selectOption("public");
    await f.locator('[name="nazirMode"]').selectOption("individual");
    await f.locator('[name="assetBand"]').selectOption("lt5");
    await f.locator('[name="myRole"]').selectOption("founder");
    await f.getByRole("button").last().click();
    await client.waitForURL(/\/app\/w\/[0-9a-f-]{36}/, { timeout: T });
    waqfId = client.url().match(/\/app\/w\/([0-9a-f-]{36})/)![1];
    await expect(client.getByTestId("establishing-founder")).toBeVisible();
    await expect(client.getByTestId("file-incomplete")).toContainText("لا أصول موقوفة مسجلة");

    await client.goto("/app");
    await expect(client.getByTestId("in-progress-waqfs")).toContainText("وقف اختبار التحرير الآلي");
    await expect(client.getByTestId("no-complete-waqfs")).toBeVisible();
    await expect(client.getByTestId("my-waqfs-count")).toHaveText("(0)");
  });

  test("the founder adds terms, a masraf, an asset and a nazir to the same file; each change is saved and reviewed", async () => {
    test.setTimeout(240_000);
    await client.goto(`/app/w/${waqfId}/deed`);
    let d = await open(client, "أضف شرطًا");
    await d.getByLabel("الفئة").selectOption({ index: 1 });
    await d.getByLabel("النص كما ورد").fill("يُقدَّم الأحوج فالأحوج (اختبار آلي).");
    await d.getByRole("button", { name: /احفظ|أضف|سجّل/ }).click();
    await expect(client.getByText(/أُحيل التعديل إلى فريق «وقفك» لمراجعته/).first()).toBeVisible({ timeout: T });

    await client.goto(`/app/w/${waqfId}/beneficiaries`);
    d = client.getByTestId("add-class");
    await d.locator("summary").click();
    await d.getByLabel(/المصرف أو وصف المستحقين/).fill("الفقراء والمساكين (اختبار آلي)");
    for (const s of await d.locator("select").all()) if (!(await s.inputValue())) await s.selectOption({ index: 1 });
    const tier = d.getByLabel(/^الطبقة/);
    if (!(await tier.inputValue())) await tier.fill("1");
    await d.getByRole("button", { name: /احفظ|أضف|سجّل/ }).click();
    await expect(client.getByText(/أُضيف المصرف/).first()).toBeVisible({ timeout: T });

    await client.goto(`/app/w/${waqfId}/assets?add=1`);
    d = client.getByTestId("add-asset");
    await d.getByLabel(/^نوع الأصل/).selectOption({ label: "نقد" });
    await d.getByLabel(/^وصف المبلغ/).fill("نقد موقوف (اختبار آلي)");
    for (const l of ["العملة", "مكان المبلغ"]) {
      const s = d.getByLabel(new RegExp(`^${l}`));
      if ((await s.evaluate((e) => e.tagName)) === "SELECT") { if (!(await s.inputValue())) await s.selectOption({ index: 1 }); } else if (!(await s.inputValue())) await s.fill("حساب بنكي");
    }
    await d.getByLabel(/^المبلغ/).fill("50000");
    await d.getByRole("button", { name: /احفظ|أضف|سجّل/ }).last().click();
    await expect(client.getByText(/أُضيف الأصل/).first()).toBeVisible({ timeout: T });

    await client.goto(`/app/w/${waqfId}/parties`);
    d = client.getByTestId("appoint-trustee");
    await d.locator("summary").click();
    await d.getByLabel(/^الاسم/).fill("ناظر الاختبار الآلي");
    await d.getByRole("button", { name: "سجّل التعيين" }).click();
    await expect(client.getByText(/سُجّل التعيين/).first()).toBeVisible({ timeout: T });
    // correct the nazir in place (not a new appointment)
    await client.reload();
    const edit = client.locator("[data-testid^='edit-trustee-']").first();
    await edit.locator("summary").click();
    await edit.getByLabel("التخصص").fill("إدارة أوقاف (اختبار آلي)");
    await edit.getByRole("button", { name: "احفظ التعديل" }).click();
    await expect(client.getByText(/حُفظت بيانات الناظر/).first()).toBeVisible({ timeout: T });
    expect((await sql<{ n: number }>("select count(*)::int n from trustees where waqf_id = $1", [waqfId]))[0].n).toBe(1);

    // saved and retrievable; one review per change, with the previous value kept in the audit trail
    await client.goto(`/app/w/${waqfId}`);
    await expect(client.getByTestId("file-reviews")).toContainText("بانتظار مراجعة الفريق");
    const reviews = await sql<{ n: number }>("select count(*)::int n from tasks where waqf_id = $1 and kind = 'file_review' and status = 'todo'", [waqfId]);
    expect(reviews[0].n).toBe(5);
    const upd = await sql<{ before: { specialty: string | null }; after: { specialty: string } }>("select before, after from audit_logs where waqf_id = $1 and action = 'waqf.trustee_updated'", [waqfId]);
    expect(upd[0].before.specialty).toBeNull();
    expect(upd[0].after.specialty).toBe("إدارة أوقاف (اختبار آلي)");
  });

  test("with its deed in the vault the file is complete: listed under «الأوقاف», requests stay apart", async () => {
    test.setTimeout(240_000);
    await client.goto(`/app/w/${waqfId}/documents?upload=waqf_deed#upload`);
    await client.getByLabel("عنوان الوثيقة").fill("صك الوقف (اختبار آلي)");
    await client.getByTestId("document-file-input").setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: pdf("editing deed") });
    await client.getByRole("button", { name: "ارفع الوثيقة" }).click();
    await expect(client.getByRole("status").filter({ hasText: "رُفعت" })).toBeVisible({ timeout: T });
    await client.goto(`/app/w/${waqfId}`);
    await expect(client.getByTestId("file-incomplete")).toHaveCount(0);

    // a request for the waqf and one with no waqf: both under «الخدمات والطلبات», neither counted as a waqf
    await client.goto(`/app/requests/new?service=T04&waqf=${waqfId}`);
    const reg = client.getByRole("radio", { name: /وقف مسجل في منصة/ });
    if (await reg.count()) await reg.check();
    await client.getByLabel("اختر الوقف المسجل").selectOption(waqfId);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/intake$/, { timeout: T });
    await client.goto("/app/requests/new?service=T01");
    await client.getByRole("radio", { name: /لا يوجد لدي وقف قائم بعد/ }).check();
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/intake$/, { timeout: T });

    await client.goto("/app");
    await expect(client.getByTestId("my-waqfs-count")).toHaveText("(1)");
    await expect(client.locator("#my-waqfs-section")).toContainText("وقف اختبار التحرير الآلي");
    await expect(client.getByTestId("in-progress-waqfs")).toHaveCount(0);
    const reqs = client.getByTestId("home-requests");
    await expect(reqs).toContainText("غير مرتبط بوقف");
    await expect(reqs).toContainText("الوقف: وقف اختبار التحرير الآلي");
    await expect(client.locator("#my-waqfs-section")).not.toContainText("REQ-");
    // the waqf's status does not follow its requests, nor the reverse
    expect((await sql<{ s: string }>("select status s from waqfs where id = $1", [waqfId]))[0].s).toBe("documented");
    expect((await sql<{ s: string }>("select status s from service_requests where waqf_id = $1", [waqfId])).map((r) => r.s)).toEqual(["draft"]);
  });

  test("the team's file editor corrects the file; another editor reviews; nobody reviews their own change", async ({ browser }) => {
    test.setTimeout(240_000);
    const admin = await (await browser.newContext()).newPage();
    await loginAs(admin, "admin");
    await admin.goto(`/admin/waqfs/${waqfId}`);
    await expect(admin.getByTestId("open-file")).toContainText("استكمال ملف الوقف وتعديله");
    await admin.goto(`/app/w/${waqfId}`);
    await expect(admin.getByTestId("staff-editor")).toBeVisible();
    await admin.goto(`/app/w/${waqfId}/deed`);
    const d = await open(admin, "أضف شرطًا");
    await d.getByLabel("الفئة").selectOption({ index: 2 });
    await d.getByLabel("النص كما ورد").fill("شرط أضافه فريق «وقفك» (اختبار آلي).");
    await d.getByRole("button", { name: /احفظ|أضف|سجّل/ }).click();
    await expect(admin.getByText(/أُحيل التعديل إلى فريق «وقفك» لمراجعته/).first()).toBeVisible({ timeout: T });
    // the founder's changes: approve one, return one with a reason
    await admin.goto(`/admin/waqfs/${waqfId}#file-reviews`);
    const pending = admin.locator("[data-testid^='file-review-']").filter({ hasText: "بانتظار المراجعة" });
    const own = pending.filter({ hasText: "فريق «وقفك»" }).or(pending.filter({ hasText: "مدير المنصة" }));
    await expect(own.first().locator("form")).toHaveCount(0);
    const asset = pending.filter({ hasText: "الأصول الموقوفة" }).first();
    await asset.getByRole("button", { name: "اعتمد التعديل" }).click();
    await expect(admin.locator("[data-testid^='file-review-']").filter({ hasText: "الأصول الموقوفة" }).first()).toContainText("اعتُمد", { timeout: T });
    const terms = admin.locator("[data-testid^='file-review-']").filter({ hasText: "الوثيقة والشروط" }).filter({ hasText: "واقف تحرير الملف" }).first();
    await terms.locator("textarea").fill("اذكر رقم البند في صك الوقف لهذا الشرط.");
    await terms.getByRole("button", { name: "يحتاج تصحيحًا" }).click();
    await expect(admin.locator("[data-testid^='file-review-']").filter({ hasText: "اذكر رقم البند" }).first()).toBeVisible({ timeout: T });
    // another editor reviews the admin's own change
    const ops = await (await browser.newContext()).newPage();
    await loginAs(ops, "ops");
    await ops.goto(`/admin/waqfs/${waqfId}#file-reviews`);
    const mine = ops.locator("[data-testid^='file-review-']").filter({ hasText: "مدير المنصة" }).filter({ hasText: "بانتظار المراجعة" }).first();
    await mine.getByRole("button", { name: "اعتمد التعديل" }).click();
    await expect(ops.locator("[data-testid^='file-review-']").filter({ hasText: "مدير المنصة" }).first()).toContainText("اعتُمد", { timeout: T });
    // the founder is told and sees the result without staff names
    await client.goto(`/app/w/${waqfId}`);
    await expect(client.getByTestId("file-reviews")).toContainText("اذكر رقم البند");
    await expect(client.getByTestId("file-reviews")).not.toContainText("مدير العمليات");
  });

  test("a staff member without the file-editor right, and another client, cannot edit the file", async ({ browser }) => {
    const emp = await (await browser.newContext()).newPage();
    await loginAs(emp, "emp1");
    await emp.goto(`/app/w/${waqfId}/deed`);
    await expect(emp.locator("summary", { hasText: "أضف شرطًا" })).toHaveCount(0);
    const outsider = await (await browser.newContext()).newPage();
    await loginAs(outsider, "outsider");
    await outsider.goto(`/app/w/${waqfId}/deed`);
    await expect(outsider).not.toHaveURL(new RegExp(`/app/w/${waqfId}/deed`));
    expect(demo().waqfs.A).toBeTruthy();
  });
});
