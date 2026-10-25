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
  let linkedReq = "";
  let freeReq = "";
  const created: string[] = [];
  // the documented test waqf is archived afterwards: other suites (tests/compliance-engine.test.ts) count the documented
  // waqfs of each size in the shared database
  test.afterAll(async () => { const ids = [waqfId, ...created].filter(Boolean); if (ids.length) await sql("update waqfs set archived_at = now() where id = any($1)", [ids]); });

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
    linkedReq = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.goto("/app/requests/new?service=T01");
    await client.getByRole("radio", { name: /لا يوجد لدي وقف قائم بعد/ }).check();
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/intake$/, { timeout: T });
    freeReq = client.url().match(/requests\/([0-9a-f-]{36})/)![1];

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

  test("a request with no waqf: submitted, processed and closed under «الخدمات والطلبات», never a waqf", async ({ browser }) => {
    test.setTimeout(420_000);
    const waqfsBefore = (await sql<{ n: number }>("select count(*)::int n from waqfs where created_by = (select requester_user_id from service_requests where id = $1)", [freeReq]))[0].n;
    await fillAndSubmit(client, freeReq);
    expect((await sql<{ s: string; w: string | null }>("select status s, waqf_id w from service_requests where id = $1", [freeReq]))[0]).toEqual({ s: "submitted", w: null });
    await client.goto("/app");
    await expect(client.getByTestId("home-requests")).toContainText("جلسة تصميم الوقف");
    const admin = await staff(browser, "admin");
    const ops = await staff(browser, "ops");
    await runTeam(admin, ops, freeReq);
    expect(await reqStatus(freeReq)).toBe("awaiting_client_approval");
    await clientApproves(client, freeReq);
    await closeRequest(admin, freeReq);
    expect(await reqStatus(freeReq)).toBe("closed");
    await client.goto("/app");
    const row = client.locator("[data-testid^='home-request-']").filter({ hasText: "جلسة تصميم الوقف" }).first();
    await expect(row).toContainText("غير مرتبط بوقف");
    await expect(row).toContainText("مغلق");
    await expect(client.locator("#my-waqfs-section")).not.toContainText("جلسة تصميم الوقف");
    // following and closing it created no waqf, and left the waqf counters as they were
    expect((await sql<{ n: number }>("select count(*)::int n from waqfs where created_by = (select requester_user_id from service_requests where id = $1)", [freeReq]))[0].n).toBe(waqfsBefore);
    await expect(client.getByTestId("my-waqfs-count")).toHaveText("(1)");
  });

  test("a request for the waqf runs its own lifecycle; its approved output is never changed by later edits of the file", async ({ browser }) => {
    test.setTimeout(480_000);
    await fillAndSubmit(client, linkedReq);
    const admin = await staff(browser, "admin");
    const ops = await staff(browser, "ops");
    await runTeam(admin, ops, linkedReq);
    await clientApproves(client, linkedReq);
    await closeRequest(admin, linkedReq);
    expect(await reqStatus(linkedReq)).toBe("closed");
    // closing the request did not change the waqf, nor its place under «الأوقاف»
    expect((await sql<{ s: string }>("select status s from waqfs where id = $1", [waqfId]))[0].s).toBe("documented");
    await client.goto("/app");
    await expect(client.getByTestId("my-waqfs-count")).toHaveText("(1)");
    const [out] = await sql<{ id: string; v: number; h: string; n: number }>(
      "select o.id, o.approved_version v, md5((select sections::text from output_versions x where x.output_id = o.id and x.version = o.approved_version)) h, (select count(*)::int from output_versions x where x.output_id = o.id) n from outputs o where o.request_id = $1 and o.status = 'approved'", [linkedReq]);
    expect(out).toBeTruthy();

    // the founder edits the file: saved, and put to review because an approved deed output used the waqf's data
    await client.goto(`/app/w/${waqfId}/deed`);
    const d = await open(client, "أضف شرطًا");
    await d.getByLabel("الفئة").selectOption({ index: 1 });
    await d.getByLabel("النص كما ورد").fill("شرط أُضيف بعد اعتماد تقرير المراجعة (اختبار آلي).");
    await d.getByRole("button", { name: /احفظ|أضف|سجّل/ }).click();
    await expect(client.getByText(/ولا يتغير أي مخرج معتمد/).first()).toBeVisible({ timeout: T });
    const [rv] = await sql<{ id: string; description: string; priority: string }>("select id, description, priority from tasks where waqf_id = $1 and kind = 'file_review' order by created_at desc limit 1", [waqfId]);
    expect(rv.description).toContain("استُخدمت في مخرج معتمد");
    expect(rv.priority).toBe("high");
    // the reviewer sees the value before and after (from the audit trail), asks for a correction with a reason
    await admin.goto(`/admin/waqfs/${waqfId}#file-reviews`);
    const card = admin.getByTestId(`file-review-${rv.id}`);
    await expect(card).toContainText("نص الشرط");
    await expect(card).toContainText("شرط أُضيف بعد اعتماد تقرير المراجعة");
    await card.getByRole("button", { name: "يحتاج تصحيحًا" }).click();
    await expect(card).toContainText("اكتب ما يلزم تصحيحه");
    await card.locator("textarea").fill("اربط الشرط ببند الصك، وقرر هل يلزم إصدار جديد لتقرير المراجعة.");
    await card.getByRole("button", { name: "يحتاج تصحيحًا" }).click();
    await expect(admin.getByTestId(`file-review-${rv.id}`)).toContainText("يحتاج تصحيحًا", { timeout: T });
    // the approved output is exactly as it was
    const [after] = await sql<{ v: number; h: string; n: number; s: string }>(
      "select o.status s, o.approved_version v, md5((select sections::text from output_versions x where x.output_id = o.id and x.version = o.approved_version)) h, (select count(*)::int from output_versions x where x.output_id = o.id) n from outputs o where o.id = $1", [out.id]);
    expect(after).toEqual({ s: "approved", v: out.v, h: out.h, n: out.n });
  });

  test("classification: complete, documented but missing data, wizard draft, establishment file, file with a request", async ({ browser }) => {
    test.setTimeout(300_000);
    // documented but missing its data (no assets, masarif or nazara), with a draft request on it
    const missing = await registerWaqf(client, "وقف موثق تنقصه البيانات (اختبار آلي)");
    created.push(missing);
    await client.goto(`/app/requests/new?service=T04&waqf=${missing}`);
    const reg = client.getByRole("radio", { name: /وقف مسجل في منصة/ });
    if (await reg.count()) await reg.check();
    await client.getByLabel("اختر الوقف المسجل").selectOption(missing);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/intake$/, { timeout: T });
    // an establishment file still in the wizard
    await client.goto("/app/establish");
    await client.getByRole("button", { name: "ابدأ وقفًا جديدًا" }).click();
    await client.waitForURL(/\/app\/establish\/[0-9a-f-]{36}/, { timeout: T });
    const draft = client.url().match(/establish\/([0-9a-f-]{36})/)![1];
    created.push(draft);

    await client.goto("/app");
    await expect(client.getByTestId("my-waqfs-count")).toHaveText("(1)");
    const prog = client.getByTestId("in-progress-waqfs");
    await expect(prog.getByTestId("in-progress-waqf")).toHaveCount(2);
    await expect(prog).toContainText("صك الوقف غير مرفوع في الوثائق");
    await expect(prog).toContainText("لم يُوثَّق الوقف بعد");
    await expect(client.locator("#my-waqfs-section")).not.toContainText("وقف موثق تنقصه البيانات");
    await expect(client.getByTestId("home-requests")).toContainText("الوقف: وقف موثق تنقصه البيانات");
    await client.goto("/app/waqfs");
    await expect(client.getByTestId("complete-waqfs")).toContainText("وقف اختبار التحرير الآلي");
    await expect(client.getByTestId("in-progress-waqfs")).toContainText("وقف موثق تنقصه البيانات");

    // the admin's lists and counters come from the same rule on the server
    const admin = await staff(browser, "admin");
    const name = (n: string) => `/admin/waqfs?q=${encodeURIComponent(n)}`;
    for (const [state, n, present] of [["complete", "وقف اختبار التحرير الآلي", true], ["in_progress", "وقف اختبار التحرير الآلي", false], ["complete", "وقف موثق تنقصه البيانات", false], ["in_progress", "وقف موثق تنقصه البيانات", true]] as const) {
      await admin.goto(`${name(n)}&state=${state}`);
      if (present) await expect(admin.locator("main tbody")).toContainText(n, { timeout: T });
      else await expect(admin.locator("main")).not.toContainText(n);
    }
    const [{ complete, total }] = await sql<{ complete: number; total: number }>(`
      select count(*) filter (where w.status in ('documented','registered','active','suspended')
        and exists (select 1 from documents d where d.waqf_id = w.id and d.doc_type = 'waqf_deed' and d.status = 'active' and d.archived_at is null)
        and exists (select 1 from assets a where a.waqf_id = w.id and a.archived_at is null)
        and exists (select 1 from beneficiary_classes c where c.waqf_id = w.id)
        and (exists (select 1 from trustees t where t.waqf_id = w.id and t.status = 'active')
          or exists (select 1 from body_memberships m join bodies b on b.id = m.body_id where b.waqf_id = w.id and b.kind = 'board' and coalesce(m.status,'active') = 'active' and (m.ends_on is null or m.ends_on >= current_date))))::int complete,
        count(*)::int total
      from waqfs w where w.archived_at is null and w.status <> 'ended' and not (w.creation_mode = 'bequest' and w.status = 'idea')`);
    await admin.goto("/admin");
    const tiles = admin.getByTestId("dash-waqfs");
    await expect(tiles.locator("a", { hasText: "الأوقاف المكتملة" })).toContainText(String(complete));
    await expect(tiles.locator("a", { hasText: "ملفات قيد التأسيس أو الاستكمال" })).toContainText(String(total - complete));
    // no duplicate files or requests were created along the way
    const dup = await sql<{ n: number }>("select count(*)::int n from (select name from waqfs where created_by = (select requester_user_id from service_requests where id = $1) group by name having count(*) > 1) x", [linkedReq]);
    expect(dup[0].n).toBe(0);
    const reqs = await sql<{ n: number }>("select count(*)::int n from service_requests where requester_user_id = (select requester_user_id from service_requests where id = $1)", [linkedReq]);
    expect(reqs[0].n).toBe(3);
  });
});

// ───────────── helpers for the request lifecycles ─────────────
async function staff(browser: import("@playwright/test").Browser, key: string) {
  const p = await (await browser.newContext()).newPage();
  await loginAs(p, key);
  return p;
}
const reqStatus = async (id: string) => (await sql<{ s: string }>("select status s from service_requests where id = $1", [id]))[0].s;

async function registerWaqf(client: Page, name: string) {
  await client.goto("/app/waqfs/new");
  const f = client.locator("main form").first();
  await f.locator('[name="name"]').fill(name);
  await f.locator('[name="deedNo"]').fill(`45${String(Date.now()).slice(-8)}`);
  await f.locator('[name="deedDate"]').fill("2024-03-10");
  await f.locator('[name="documentedOn"]').fill("2024-03-10");
  await f.locator('[name="legalType"]').selectOption("public");
  await f.locator('[name="nazirMode"]').selectOption("individual");
  await f.locator('[name="assetBand"]').selectOption("lt5");
  await f.locator('[name="myRole"]').selectOption("founder");
  await f.getByRole("button").last().click();
  await client.waitForURL(/\/app\/w\/[0-9a-f-]{36}/, { timeout: T });
  return client.url().match(/\/app\/w\/([0-9a-f-]{36})/)![1];
}

/** Answers each step of the intake (first choice, short texts, the deed PDF for document slots) and sends it. */
async function fillAndSubmit(p: Page, id: string) {
  await p.goto(`/app/requests/${id}/intake`);
  for (let i = 0; i < 15; i++) {
    if (await p.getByLabel(/أقر بأن البيانات والمستندات/).isVisible().catch(() => false)) break;
    const main = p.locator("main");
    for (const fs of await main.locator("fieldset").all()) {
      const r = fs.locator('input[type="radio"]');
      if ((await r.count()) && !(await fs.locator('input[type="radio"]:checked').count())) await r.first().check().catch(() => {});
    }
    const cb = main.locator('input[type="checkbox"]').first();
    if ((await cb.count()) && !(await main.locator('input[type="checkbox"]:checked').count())) await cb.check().catch(() => {});
    for (const ta of await main.locator("textarea").all()) if (!(await ta.inputValue())) await ta.fill("نص اختباري يصف المطلوب في هذه الخدمة بتفصيل كافٍ.");
    for (const inp of await main.locator('input[type="text"][required], input:not([type])[required]').all()) if (!(await inp.inputValue())) await inp.fill("4410000123");
    for (const d of await main.locator('input[type="date"][required]').all()) if (!(await d.inputValue())) await d.fill("2024-03-10");
    for (const s of await main.locator("select").all()) if (!(await s.inputValue())) await s.selectOption({ index: 1 }).catch(() => {});
    for (const f of await main.getByTestId("document-file-input").all()) { await f.setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: pdf("intake deed") }); await p.waitForTimeout(2500); }
    const next = p.getByRole("button", { name: "التالي" });
    if (!(await next.count())) break;
    await next.click();
    await p.waitForTimeout(1200);
  }
  await p.getByLabel(/أقر بأن البيانات والمستندات/).check();
  await p.getByRole("button", { name: "أرسل الطلب" }).click();
  await p.waitForURL(/\?created=1/, { timeout: T });
}

/**
 * The team's side through the execution panel: triage, documents verified, accepted, started as an operations package
 * (no quote), output drafted with the specialist's text, approved by another reviewer, stages, QA — until the client acts.
 */
async function runTeam(admin: Page, ops: Page, id: string) {
  for (let i = 0; i < 25; i++) {
    await admin.goto(`/admin/requests/${id}?t=${Date.now()}`);
    if ((await reqStatus(id)) === "awaiting_client_approval") return;
    const btn = admin.getByTestId("next-step");
    const link = admin.getByTestId("next-step-link");
    await expect(btn.or(link).first()).toBeVisible({ timeout: T });
    if (await btn.count()) {
      const label = await btn.innerText();
      if (/مراجعة الجودة|اعتمد الجودة/.test(label)) for (const ck of await admin.getByTestId("execution-panel").getByRole("checkbox").all()) await ck.check();
      await btn.click();
      await expect(admin.getByTestId("execution-panel").locator('[role="status"]').first()).toBeVisible({ timeout: T });
      continue;
    }
    const label = await link.innerText();
    if (/راجع المستندات/.test(label)) {
      for (const b of await admin.locator("[data-testid^='docslot-']").getByRole("button", { name: "تحققت منه" }).all()) { await b.click(); await admin.waitForTimeout(1500); }
      continue;
    }
    if (/أعدّ عرض السعر/.test(label)) { await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click(); await expect.poll(() => reqStatus(id)).toBe("in_progress"); continue; }
    const [o] = await sql<{ id: string }>("select id from outputs where request_id = $1 and status <> 'approved' order by created_at limit 1", [id]);
    if (/افتح المسودة/.test(label) && o) {
      await admin.goto(`/admin/requests/${id}/outputs/${o.id}`);
      for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("نص المختص (اختبار آلي).");
      await admin.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
      await expect(admin.getByTestId("output-versions").locator("li").nth(1)).toBeVisible({ timeout: T });
      continue;
    }
    if (/راجع واعتمد/.test(label) && o) {
      await ops.goto(`/admin/requests/${id}/outputs/${o.id}`);
      const sig = ops.getByLabel(/التوقيع/);
      if (await sig.count()) await sig.fill("مستشار تجريبي — مستشار");
      await ops.getByRole("button", { name: "اعتمد المخرج" }).click();
      await expect.poll(async () => (await sql<{ s: string }>("select status s from outputs where id = $1", [o.id]))[0].s).toBe("approved");
      continue;
    }
    throw new Error(`unexpected step: ${label}`);
  }
  throw new Error("the request did not reach the client");
}

async function clientApproves(p: Page, id: string) {
  await p.goto(`/app/requests/${id}`);
  await p.getByTestId("approval-ack").locator("input").check();
  await p.getByRole("button", { name: "أعتمد المخرجات" }).click();
  await expect.poll(() => reqStatus(id)).toBe("completed");
}
async function closeRequest(admin: Page, id: string) {
  await admin.goto(`/admin/requests/${id}?t=${Date.now()}`);
  const btn = admin.getByTestId("next-step");
  await expect(btn).toContainText("أغلق الطلب");
  await btn.click();
  await expect.poll(() => reqStatus(id)).toBe("closed");
}
