import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { deflateRawSync } from "node:zlib";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * Owner's corrective order (15 Oct 2026): previews of every output at every stage, and direct approval by the system
 * administrator. Synthetic data only. Scenarios:
 *  1. a request with an incomplete draft: the preview shows it and lists what is missing;
 *  2. an output returned for changes: its current and earlier versions are previewed and compared;
 *  3. previewing never changes a status (request, output, tasks);
 *  4. a new draft is created, saved and previewed before approval (by the assigned employee);
 *  5. the system administrator approves an invoice he is not assigned to and did not prepare;
 *  6. the system administrator approves a quote and a contract he prepared himself (recorded as direct approval);
 *  7. a request assigned to an employee is reviewed and approved by the administrator without changing the assignment;
 *  8. the employees' usual rights are unchanged (no approval for emp1; ops cannot approve what he prepared — server-side);
 *  9. a written separation policy (switched on in the settings with its reference) binds everyone, the administrator
 *     included; switching it off is audited;
 * 10. every action is in the audit log with the actor's roles at the time.
 * Desktop only (shared demo records).
 */

const shots = "/tmp/claude-0/shots";
const ex = expect.configure({ timeout: 25_000 });
mkdirSync(shots, { recursive: true });

const envLine = (k: string) => readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${k}=`))!.slice(k.length + 1).trim();
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = new pg.Client({ connectionString: envLine("DATABASE_OWNER_URL") });
  await db.connect();
  try { return (await db.query(q, params)).rows as T[]; } finally { await db.end(); }
}

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-pva-${key}-${demo().users[key].id}.json`;
  if (existsSync(file)) {
    const ctx = await browser.newContext({ storageState: file });
    const page = await ctx.newPage();
    if ((await page.request.get("/api/files/00000000-0000-4000-8000-000000000000")).status() !== 401) { pages.set(key, page); return page; }
    await ctx.close();
  }
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  pages.set(key, page);
  return page;
}
const go = (page: Page, url: string) => {
  const [path, hash] = url.split("#");
  return page.goto(`${path}${path.includes("?") ? "&" : "?"}t=${Date.now()}${hash ? `#${hash}` : ""}`);
};
const status = async (id: string) => (await sql<{ status: string }>("select status from service_requests where id = $1", [id]))[0].status;
const outStatus = async (id: string) => (await sql<{ status: string }>("select status from outputs where id = $1", [id]))[0].status;
async function nextStep(page: Page, reqId: string, label: RegExp) {
  await go(page, `/admin/requests/${reqId}`);
  const btn = page.getByTestId("next-step");
  await ex(btn).toContainText(label);
  await btn.click();
  const msg = page.getByTestId("execution-panel").locator('[role="status"], [role="alert"]').first();
  await ex(msg).toBeVisible();
  expect(await msg.getAttribute("role"), await msg.innerText()).toBe("status");
}
async function advance(page: Page, until: () => Promise<boolean>) {
  for (let i = 0; i < 20 && !(await until()); i++) {
    const nb = page.getByRole("button", { name: "التالي" });
    if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
    await page.waitForTimeout(400);
  }
}
async function signWithOtp(page: Page, phone: string) {
  const norm = `+966${phone.replace(/\D/g, "").replace(/^0/, "")}`;
  await sql("delete from rate_limits where key = $1 or key like 'otp:ip:%'", [`otp:target:${norm}`]);
  await page.getByRole("button", { name: "أرسل رمز التوقيع" }).first().click();
  const code = (await page.getByTestId("demo-otp").innerText()).trim();
  await page.getByLabel("رمز التوقيع").fill(code);
  await page.getByLabel(/قرأت نص العقد كاملًا/).check();
  await page.getByRole("button", { name: "وقّع العقد" }).click();
  await page.waitForURL(/\?signed=1/);
}
async function assignTo(page: Page, reqId: string, who: string) {
  await go(page, `/admin/requests/${reqId}`);
  const select = page.getByLabel("الموظف");
  const value = await select.locator("option", { hasText: who }).first().getAttribute("value");
  await select.selectOption(value!);
  await page.getByRole("button", { name: "أسند", exact: true }).click();
}
const lastAudit = async <T = Record<string, unknown>>(action: string, entityId: string) =>
  (await sql<{ after: T; before: unknown; actor_user_id: string; actor_roles: string[] | null }>("select after, before, actor_user_id, actor_roles from audit_logs where action = $1 and entity_id = $2 order by id desc limit 1", [action, entityId]))[0];

/** A minimal Word file (zip with [Content_Types].xml and word/document.xml). */
function docx(paragraphs: string[]) {
  const files: Record<string, string> = {
    "[Content_Types].xml": `<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    "word/document.xml": `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs.map((p) => `<w:p><w:r><w:t>${p}</w:t></w:r></w:p>`).join("")}</w:body></w:document>`,
  };
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const comp = deflateRawSync(data);
    const n = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(2, 8); end.writeUInt16LE(2, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const TEST_COMPANY = {
  nameAr: "شركة وقفك (بيانات اختبار)", legalForm: "شركة ذات مسؤولية محدودة", crNumber: "0000000000", nationalAddress: "عنوان اختبار — الرياض",
  signatoryName: "مفوّض اختبار", signatoryTitle: "المدير العام (اختبار)", iban: "SA0000000000000000000000", bankName: "بنك اختبار",
};
const ledgerTag = "اختبار آلي — معاينة المخرجات";
const POLICY_REF = "سياسة الاعتمادات المالية الداخلية رقم 1/2026 (اختبار آلي)";

test.describe.serial("previews of every output, and direct approval by the system administrator", () => {
  test.setTimeout(480_000);
  const U = () => demo().users;
  const A = () => demo().waqfs.A;
  let originalCompany = "";
  let originalSeparation: string | null = null;

  test.beforeAll(async () => {
    const [row] = await sql<{ value: unknown }>("select value from settings where key = 'company.profile'");
    originalCompany = JSON.stringify(row?.value ?? {});
    await sql("update settings set value = value || $1::jsonb where key = 'company.profile'", [JSON.stringify(TEST_COMPANY)]);
    const [sep] = await sql<{ value: unknown }>("select value from settings where key = 'approvals.separation'");
    originalSeparation = sep ? JSON.stringify(sep.value) : null;
    await sql("delete from settings where key = 'approvals.separation'");
  });
  test.afterAll(async () => {
    await sql("delete from ledger_entries where description = $1", [ledgerTag]);
    await sql("update settings set value = $1::jsonb where key = 'company.profile'", [originalCompany]);
    if (originalSeparation) await sql("insert into settings (key, value) values ('approvals.separation', $1::jsonb) on conflict (key) do update set value = excluded.value", [originalSeparation]);
    else await sql("delete from settings where key = 'approvals.separation'");
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("previews: live preview with gaps, a saved draft, a returned output and its versions, a Word file — nothing changes status", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    // the client asks for a financial opinion (an output with independent approval)
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=C09&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    const reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("المسألة أو السؤال").fill("هل يجوز تحميل مصروفات صيانة الأصل على غلة السنة الحالية كاملة؟ (اختبار آلي)");
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(client, () => confirm.isVisible());
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });
    expect(await status(reqId)).toBe("submitted");
    const tasksBefore = JSON.stringify(await sql("select kind, status from tasks where request_id = $1 order by kind", [reqId]));

    // 1) & 3) the output has no saved draft yet: the administrator previews it from the current data — nothing is stored
    const admin = await as(browser, "admin");
    await go(admin, `/admin/requests/${reqId}#outputs`);
    const card = admin.getByTestId("output-C09.main");
    await ex(card).toContainText("لم تُحفظ مسودة");
    await card.getByTestId("preview-C09.main").click();
    await admin.waitForURL(/\/outputs\/preview\?key=C09\.main/);
    await ex(admin.getByTestId("live-preview-banner")).toContainText("لم تُحفظ مسودة بعد");
    await ex(admin.getByTestId("output-gaps")).toContainText("يكتبه المختص");
    await ex(admin.getByTestId("output-gaps")).toContainText("لا قيود مالية مسجلة للفترة"); // a real gap of the waqf's data, not filled
    await ex(admin.getByTestId("live-preview")).toContainText("تحميل مصروفات صيانة الأصل");
    await admin.screenshot({ path: `${shots}/preview-live.png`, fullPage: true });
    const livePdf = await admin.request.get(`/admin/requests/${reqId}/outputs/preview/pdf?key=C09.main`);
    expect(livePdf.status()).toBe(200);
    expect(livePdf.headers()["content-type"]).toContain("application/pdf");
    expect((await livePdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    expect(await sql("select 1 from outputs where request_id = $1", [reqId])).toHaveLength(0);
    expect(await status(reqId)).toBe("submitted");
    expect(JSON.stringify(await sql("select kind, status from tasks where request_id = $1 order by kind", [reqId]))).toBe(tasksBefore);
    expect((await sql("select 1 from audit_logs where action = 'outputs.preview' and entity_id = $1", [reqId])).length).toBeGreaterThan(0);

    // 7) the request is assigned to an employee; 4) the employee previews, saves the draft (version 1) and previews it
    await assignTo(admin, reqId, "موظف أول");
    await ex.poll(async () => (await sql<{ a: string | null }>("select assigned_to_user_id as a from service_requests where id = $1", [reqId]))[0].a).toBe(U().emp1.id);
    const emp = await as(browser, "emp1");
    await go(emp, `/admin/requests/${reqId}/outputs/preview?key=C09.main`);
    await emp.getByRole("button", { name: "احفظها مسودة (النسخة 1)" }).click();
    await emp.waitForURL(/\/outputs\/[0-9a-f-]{36}$/);
    const outputId = emp.url().match(/outputs\/([0-9a-f-]{36})/)![1];
    await ex(emp.getByTestId("draft-incomplete")).toContainText("مسودة غير مكتملة");
    await ex(emp.getByTestId("output-gaps")).toContainText("لم يُكتب");
    const v1pdf = await emp.request.get(`/admin/requests/${reqId}/outputs/${outputId}/pdf?v=1`);
    expect(v1pdf.status()).toBe(200);
    expect((await v1pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    expect(await outStatus(outputId)).toBe("draft");
    expect(await status(reqId)).toBe("triage"); // assignment moved it to triage; previews did not move anything
    await go(emp, `/admin/requests/${reqId}#outputs`);
    await ex(emp.getByTestId("output-C09.main")).toContainText("مسودة غير مكتملة");
    await ex(emp.getByTestId("preview-C09.main")).toBeVisible();

    // the missing data is recorded where it belongs (synthetic ledger entries for the last fiscal year), the draft is
    // regenerated (version 2); the specialist writes the analysis (version 3) and sends it for review
    const fy = new Date().getFullYear() - 1;
    await sql(`insert into ledger_entries (waqf_id, entry_date, account_code, description, debit, credit) values
      ($1, $2, '1100', $3, 4200, 0), ($1, $2, '4100', $3, 0, 4200)`, [A(), `${fy}-06-15`, ledgerTag]);
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}`);
    await emp.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(emp.getByTestId("output-versions").locator("li")).toHaveCount(2);
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(emp.getByTestId("output-gaps")).not.toContainText("لا قيود مالية مسجلة للفترة");
    for (const t of await emp.locator('textarea[name^="spec:"]').all()) await t.fill("رأي المختص المبدئي (اختبار آلي).");
    await emp.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(emp.getByTestId("output-versions").locator("li")).toHaveCount(3);
    await emp.getByRole("button", { name: "أرسلها للمراجعة والاعتماد" }).click();
    await ex.poll(() => outStatus(outputId)).toBe("in_review");

    // 2) the administrator returns it; the returned output shows its current and earlier versions
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await admin.locator("#retnote").fill("أضف مرجع المعيار المحاسبي (اختبار آلي).");
    await admin.getByRole("button", { name: "أعده للتعديل" }).click();
    await ex.poll(() => outStatus(outputId)).toBe("returned");
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(emp.getByText("أعاده المراجع للتعديل")).toBeVisible();
    await ex(emp.getByText("أضف مرجع المعيار المحاسبي")).toBeVisible();
    const versions = emp.getByTestId("output-versions");
    await ex(versions.getByRole("link", { name: "معاينة" })).toHaveCount(3);
    await ex(versions.getByRole("link", { name: "PDF" })).toHaveCount(3);
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}?v=1`);
    await ex(emp.getByText("تعرض النسخة 1 (ليست الحالية)")).toBeVisible();
    await ex(emp.getByText("يكتبه المختص").first()).toBeVisible(); // version 1 still has the unwritten part
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}?a=1&b=3`);
    await ex(emp.getByTestId("output-diff")).toContainText("رأي المختص المبدئي");
    expect((await emp.request.get(`/admin/requests/${reqId}/outputs/${outputId}/pdf?v=1`)).status()).toBe(200);
    expect(await outStatus(outputId)).toBe("returned"); // 3) viewing changed nothing
    await emp.screenshot({ path: `${shots}/preview-returned.png`, fullPage: true });

    // the employee corrects it (version 3) and resubmits
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}`);
    for (const t of await emp.locator('textarea[name^="spec:"]').all()) await t.fill("رأي المختص مع مرجع المعيار المحاسبي (اختبار آلي).");
    await emp.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(emp.getByTestId("output-versions").locator("li")).toHaveCount(4);
    await emp.getByRole("button", { name: "أرسلها للمراجعة والاعتماد" }).click();
    await ex.poll(() => outStatus(outputId)).toBe("in_review");
    // 8) the employee cannot approve (no review right); nothing offers it to him
    await go(emp, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(emp.getByRole("button", { name: "اعتمد المخرج" })).toHaveCount(0);

    // 8) ops (no direct approval) who edits the output becomes a preparer and may not approve it — refused by the server too
    const ops = await as(browser, "ops");
    await go(ops, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(ops.getByRole("button", { name: "اعتمد المخرج" })).toBeVisible(); // not a preparer yet
    await sql("update outputs set submitted_by = $1 where id = $2", [U().ops.id, outputId]); // ops submitted it in another tab
    await ops.getByLabel("التوقيع: اسم المستشار وصفته").fill("مستشار مالي (اختبار آلي)");
    await ops.getByRole("button", { name: "اعتمد المخرج" }).click();
    await ex(ops.getByText("هذا المخرج يتطلب اعتمادًا مستقلًا").first()).toBeVisible();
    expect(await outStatus(outputId)).toBe("in_review");
    await go(ops, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(ops.getByTestId("approve-blocked")).toContainText("يتطلب اعتمادًا مستقلًا");
    await sql("update outputs set submitted_by = $1 where id = $2", [U().emp1.id, outputId]);

    // 7) the administrator approves the employee's work; the assignment stays as it is
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await admin.getByLabel("التوقيع: اسم المستشار وصفته").fill("مستشار مالي (اختبار آلي)");
    await admin.getByRole("button", { name: "اعتمد المخرج" }).click();
    await ex.poll(() => outStatus(outputId)).toBe("approved");
    const [appr] = await sql<{ approved_by: string; self_approved: boolean; a: string }>("select o.approved_by, o.self_approved, r.assigned_to_user_id as a from outputs o join service_requests r on r.id = o.request_id where o.id = $1", [outputId]);
    expect(appr).toEqual({ approved_by: U().admin.id, self_approved: false, a: U().emp1.id });
    const aud = await lastAudit<{ version: number }>("outputs.approve", outputId);
    expect(aud.actor_user_id).toBe(U().admin.id);
    expect(aud.actor_roles).toContain("super_admin");
    expect(aud.after.version).toBe(4);

    // Word file: the request's document is previewed as text (sandboxed HTML), not downloaded blind
    const up = await admin.request.post("/api/files", {
      multipart: { file: { name: "مسودة-صياغة.docx", mimeType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", buffer: docx(["البند الأول: نص الصياغة الجاري إعدادها (اختبار آلي).", "البند الثاني: ما ينقص يُستكمل."]) }, requestId: reqId, title: "مسودة صياغة (Word)" },
    });
    expect(up.status(), await up.text()).toBe(201);
    const docId = (await up.json()).id as string;
    const view = await admin.request.get(`/api/files/${docId}?disposition=inline`);
    expect(view.status()).toBe(200);
    expect(view.headers()["content-type"]).toContain("text/html");
    expect(view.headers()["content-security-policy"]).toContain("sandbox");
    const html = await view.text();
    expect(html).toContain("البند الأول: نص الصياغة الجاري إعدادها");
    expect(html).not.toContain("<script");
    const dl = await admin.request.get(`/api/files/${docId}`);
    expect(dl.headers()["content-disposition"]).toContain("attachment");
    // a client who is not a party cannot open it
    const outsider = await as(browser, "waqif");
    expect((await outsider.request.get(`/api/files/${docId}?disposition=inline`)).status()).toBeGreaterThanOrEqual(403);
    await sql("update service_requests set status = 'cancelled', assigned_to_user_id = null where id = $1", [reqId]);
  });

  test("direct approval: quote and contract the administrator prepared, an invoice he is not assigned to; a written policy binds everyone", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const client = await as(browser, "nazir");
    await client.goto(`/app/requests/new?service=C06&waqf=${A()}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    const reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "ناظر الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("عدد المستفيدين").fill("8");
    await client.getByLabel("الدورية").selectOption("annual");
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    await advance(client, () => confirm.isVisible());
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });

    const admin = await as(browser, "admin");
    await nextStep(admin, reqId, /ابدأ الفرز/);
    await nextStep(admin, reqId, /سجّل التحقق/);
    await nextStep(admin, reqId, /اقبل الطلب/);
    // 7) assigned to an employee
    await assignTo(admin, reqId, "موظف أول");
    await ex.poll(async () => (await sql<{ a: string | null }>("select assigned_to_user_id as a from service_requests where id = $1", [reqId]))[0].a).toBe(U().emp1.id);

    // the employee prepares the quote; 8) he has no approval right
    const emp = await as(browser, "emp1");
    await go(emp, `/admin/requests/${reqId}#quote`);
    const ed = emp.getByTestId("quote-editor");
    await ed.getByLabel("سعر وحدة البند 1").fill("2000");
    await ed.getByLabel("وصف الدفعة 1").fill("عند توقيع العقد");
    await ed.getByLabel("نسبة الدفعة 1").fill("100");
    await ed.getByTestId("term-1").getByRole("checkbox", { name: "شرط للبدء" }).uncheck();
    await ed.getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex.poll(async () => (await sql("select 1 from quotes where request_id = $1 and status = 'draft'", [reqId])).length).toBe(1);
    const [{ id: quoteId }] = await sql<{ id: string }>("select id from quotes where request_id = $1", [reqId]);
    await go(emp, `/admin/requests/${reqId}#quote`);
    await ex(emp.getByRole("button", { name: /^اعتمد العرض/ })).toHaveCount(0);
    await ex(emp.getByText("يعتمده زميل يملك صلاحية اعتماد العروض").first()).toBeVisible();

    // 8) ops (no direct approval): the button shows while someone else prepared it; once he edits the draft (in another
    // tab) the server refuses his approval
    const ops = await as(browser, "ops");
    await go(ops, `/admin/requests/${reqId}#quote`);
    await ex(ops.getByRole("button", { name: "اعتمد العرض", exact: true })).toBeVisible();
    const opsTab = await ops.context().newPage();
    await go(opsTab, `/admin/requests/${reqId}#quote`);
    await opsTab.getByTestId("quote-editor").getByLabel("سعر وحدة البند 1").fill("2100");
    await opsTab.getByTestId("quote-editor").getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex.poll(async () => (await sql<{ p: string }>("select prepared_by as p from quotes where id = $1", [quoteId]))[0].p).toBe(U().ops.id);
    await opsTab.close();
    await ops.getByRole("button", { name: "اعتمد العرض", exact: true }).click();
    // the refusal (or, once the page refreshes, the same rule as a note in place of the button)
    await ex(ops.getByText(/يعتمد العرض شخص غير من أعدّه|أعددتَ هذا العرض: يعتمده زميل/).first()).toBeVisible();
    expect((await sql<{ status: string }>("select status from quotes where id = $1", [quoteId]))[0].status).toBe("draft");
    expect(await sql("select 1 from audit_logs where action = 'quotes.approve' and entity_id = $1", [quoteId])).toHaveLength(0);
    await go(ops, `/admin/requests/${reqId}#quote`);
    await ex(ops.getByRole("button", { name: /^اعتمد العرض/ })).toHaveCount(0);

    // the administrator edits the draft (he becomes its preparer) — 9) first a written policy is switched on in the settings
    await go(admin, `/admin/requests/${reqId}#quote`);
    await admin.getByTestId("quote-editor").getByLabel("سعر وحدة البند 1").fill("2200");
    await admin.getByTestId("quote-editor").getByRole("button", { name: "احفظ مسودة العرض" }).click();
    await ex.poll(async () => (await sql<{ p: string }>("select prepared_by as p from quotes where id = $1", [quoteId]))[0].p).toBe(U().admin.id);
    await go(admin, `/admin/requests/${reqId}#quote`);
    const directBtn = admin.getByRole("button", { name: "اعتمد العرض (اعتماد مباشر مسجّل)" });
    await ex(directBtn).toBeVisible();
    const settings = await admin.context().newPage();
    await go(settings, "/admin/settings#separation");
    const sep = settings.getByTestId("separation-policy");
    await sep.locator("summary", { hasText: "عدّل السياسة" }).click();
    await sep.locator("fieldset", { hasText: "اعتماد عروض الأسعار" }).getByRole("checkbox").check();
    await sep.locator("#ref_quote").fill(POLICY_REF);
    await sep.locator("#sep-reason").fill("اعتماد سياسة الاعتمادات المالية الداخلية (اختبار آلي).");
    await sep.getByRole("button", { name: "احفظ السياسة" }).click();
    await ex(settings.getByText("حُفظت سياسة الفصل بين المهام.")).toBeVisible();
    const sAud = await lastAudit<{ quote: { enforced: boolean; reference: string } }>("settings.separation_policy", "approvals.separation");
    expect(sAud.after.quote).toEqual({ enforced: true, reference: POLICY_REF });
    expect(sAud.actor_roles).toContain("super_admin");
    // the page opened before the policy still shows the button: the server refuses with the policy's reference
    await directBtn.click();
    await ex(admin.getByText(POLICY_REF).first()).toBeVisible();
    expect((await sql<{ status: string }>("select status from quotes where id = $1", [quoteId]))[0].status).toBe("draft");
    await go(admin, `/admin/requests/${reqId}#quote`);
    await ex(admin.getByRole("button", { name: /^اعتمد العرض/ })).toHaveCount(0);
    await ex(admin.getByText(/يلزم أن يعتمده شخص غير من أعدّه بموجب سياسة معتمدة/).first()).toBeVisible();
    await admin.screenshot({ path: `${shots}/approval-policy-enforced.png`, fullPage: false });
    // the policy is switched off again (audited with its reason)
    await go(settings, "/admin/settings#separation");
    await settings.getByTestId("separation-policy").locator("summary", { hasText: "عدّل السياسة" }).click();
    await settings.getByTestId("separation-policy").locator("fieldset", { hasText: "اعتماد عروض الأسعار" }).getByRole("checkbox").uncheck();
    await settings.locator("#sep-reason").fill("إلغاء السياسة بعد انتهاء الاختبار (اختبار آلي).");
    await settings.getByRole("button", { name: "احفظ السياسة" }).click();
    await ex(settings.getByText("حُفظت سياسة الفصل بين المهام.")).toBeVisible();
    await settings.close();

    // 6) the administrator approves the quote he prepared, directly; the assignment does not change
    await go(admin, `/admin/requests/${reqId}#quote`);
    await admin.getByRole("button", { name: "اعتمد العرض (اعتماد مباشر مسجّل)" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from quotes where id = $1", [quoteId]))[0].status).toBe("approved");
    const qa = await lastAudit<{ approvalMode: string; status: string; request: string }>("quotes.approve", quoteId);
    expect(qa.after).toMatchObject({ approvalMode: "direct_self", status: "approved" });
    expect(qa.before).toMatchObject({ status: "draft", preparedBy: U().admin.id });
    expect(qa.actor_roles).toContain("super_admin");
    expect((await sql<{ a: string }>("select assigned_to_user_id as a from service_requests where id = $1", [reqId]))[0].a).toBe(U().emp1.id);
    await admin.getByRole("button", { name: "أرسل العرض للعميل" }).click();
    await ex.poll(() => status(reqId)).toBe("quote");
    await go(client, `/app/requests/${reqId}#quote`);
    await client.getByRole("button", { name: "أقبل العرض" }).click();
    await ex.poll(() => status(reqId)).toBe("awaiting_contract");

    // 6) the contract: previewed before preparation, prepared and approved directly by the administrator
    await go(admin, `/admin/requests/${reqId}#contract`);
    await admin.getByRole("link", { name: /معاينة نص العقد/ }).click();
    await admin.waitForURL(/contract-preview/);
    await ex(admin.getByTestId("contract-preview-banner")).toContainText("ليست عقدًا");
    await ex(admin.getByTestId("contract-preview-gaps")).toContainText("أطراف العميل وصفاتهم");
    expect(await sql("select 1 from contracts where request_id = $1", [reqId])).toHaveLength(0);
    await go(admin, `/admin/requests/${reqId}#contract`);
    const form = admin.getByTestId("contract-prepare");
    await form.getByLabel(/سند الصفة/).first().fill("صك النظارة رقم 000 (اختبار)");
    await form.getByRole("button", { name: "أعدّ مسودة العقد" }).click();
    await ex.poll(async () => (await sql("select 1 from contracts where request_id = $1", [reqId])).length).toBe(1);
    const [{ id: contractId, number: kNumber }] = await sql<{ id: string; number: string }>("select id, number from contracts where request_id = $1", [reqId]);
    await go(admin, `/admin/requests/${reqId}#contract`);
    const kPdf = await admin.request.get(`/app/requests/${reqId}/contract/${contractId}`);
    expect(kPdf.status()).toBe(200);
    expect((await kPdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    await ex(admin.getByTestId(`contract-pdf-${kNumber}`)).toContainText("معاينة PDF (مسودة)");
    await admin.getByRole("button", { name: "اعتمد العقد (اعتماد مباشر مسجّل)" }).click();
    await ex(admin.getByText("معتمد داخليًا — لم يُرسل").first()).toBeVisible();
    const ka = await lastAudit<{ approvalMode: string }>("contracts.approve", contractId);
    expect(ka.after.approvalMode).toBe("direct_self");
    expect(ka.actor_roles).toContain("super_admin");
    await admin.getByRole("button", { name: "أرسل للتوقيع" }).click();
    await ex(admin.getByText("مرسل للتوقيع").first()).toBeVisible();
    await go(client, `/app/requests/${reqId}#contract`);
    await signWithOtp(client, U().nazir.phone);
    await go(admin, `/admin/requests/${reqId}#contract`);
    await signWithOtp(admin, U().admin.phone);
    await ex.poll(async () => (await sql<{ s: string }>("select status as s from contracts where id = $1", [contractId]))[0].s).toBe("signed");

    // 5) the employee prepares the invoice of the installment; the administrator (finance, not assigned) approves it
    await go(emp, `/admin/requests/${reqId}#billing`);
    await emp.getByRole("button", { name: /أعدّ مسودة (فاتورة أولية|الفاتورة)/ }).first().click();
    await ex.poll(async () => (await sql("select 1 from invoices where request_id = $1 and status = 'draft'", [reqId])).length).toBe(1);
    const [{ id: invId }] = await sql<{ id: string }>("select id from invoices where request_id = $1", [reqId]);
    await go(emp, `/admin/requests/${reqId}#billing`);
    await ex(emp.getByRole("button", { name: /^اعتمد الفاتورة/ })).toHaveCount(0); // 8) no finance right
    await go(admin, `/admin/requests/${reqId}#billing`);
    await admin.getByRole("button", { name: "اعتمد الفاتورة", exact: true }).click();
    await ex.poll(async () => (await sql<{ s: string }>("select status as s from invoices where id = $1", [invId]))[0].s).toBe("approved");
    const [inv] = await sql<{ approved_by: string; created_by: string; self_approved: boolean }>("select approved_by, created_by, self_approved from invoices where id = $1", [invId]);
    expect(inv).toEqual({ approved_by: U().admin.id, created_by: U().emp1.id, self_approved: false });
    const ia = await lastAudit<{ status: string }>("billing.invoice_approve", invId);
    expect(ia.after.status).toBe("approved");
    expect(ia.actor_roles).toContain("super_admin");
    // the invoice preview (before sending) works for the team, the client does not see the unsent invoice
    expect((await admin.request.get(`/app/billing/${invId}/pdf`)).status()).toBe(200);
    expect((await client.request.get(`/app/billing/${invId}/pdf`)).status()).toBeGreaterThanOrEqual(400);
    expect((await sql<{ a: string }>("select assigned_to_user_id as a from service_requests where id = $1", [reqId]))[0].a).toBe(U().emp1.id);

    // 10) the audit page shows the actor's roles at the time
    const [{ id: auditId }] = await sql<{ id: string }>("select id::text from audit_logs where action = 'quotes.approve' and entity_id = $1 order by id desc limit 1", [quoteId]);
    await go(admin, `/admin/audit/${auditId}`);
    await ex(admin.getByText("أدواره وقت التنفيذ")).toBeVisible();
    await ex(admin.getByText("مسؤول النظام الأعلى").first()).toBeVisible();
    await ex(admin.getByText("direct_self").first()).toBeVisible();
    await sql("update service_requests set status = 'cancelled', assigned_to_user_id = null where id = $1", [reqId]);
  });
});
