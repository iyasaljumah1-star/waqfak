import "dotenv/config";
import { mkdirSync } from "node:fs";
import { Client } from "pg";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { demo, loginAs, signup, passWaqfData } from "./helpers";

/**
 * Corporate nazara (Waqfak as legal-entity nazir) and account administration, end to end:
 *  - N01 request opens the intake; checklist; acceptance; appointment; licence gate; practice activation on a demo waqf;
 *    waqf-level isolation of the nazara team; draft → approved periodic report (maker-checker); ending and handover.
 *  - Admin edits a client's data; full phone for holders of admin.pii.view, masked otherwise; a direct server-action
 *    call without the permission is refused; changes are audited.
 * Runs once (desktop): it changes shared demo state and restores it.
 */

const SHOTS = "test-results-shots/nazara";
mkdirSync(SHOTS, { recursive: true });

async function sql(text: string, params: unknown[] = []) {
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

const C = () => demo().waqfs.C; // وقف الإحسان الصحي (تجريبي): board-run, chair can request services
const B = () => demo().waqfs.B;

async function resetWaqf(waqfId: string) {
  await sql("update waqf_memberships set status='ended', ends_at=now() where waqf_id=$1 and role_key in ('nazara_reviewer') or (waqf_id=$1 and user_id in (select user_id from nazara_team where waqf_id=$1))", [waqfId]);
  await sql("delete from tasks where waqf_id=$1 and source_type='nazara'", [waqfId]);
  await sql("delete from reports where waqf_id=$1 and kind like 'nazara_%'", [waqfId]);
  await sql("delete from trustee_appointments where trustee_id in (select id from trustees where waqf_id=$1 and kind='legal_entity')", [waqfId]);
  await sql("delete from trustees where waqf_id=$1 and kind='legal_entity'", [waqfId]);
  await sql("delete from waqf_timeline_events where waqf_id=$1 and type like 'nazara_%'", [waqfId]);
  await sql("delete from nazara_engagements where waqf_id=$1", [waqfId]);
  await sql("update service_requests set status='cancelled' where waqf_id=$1 and service_id=(select id from services where code='N01') and status not in ('closed','cancelled','rejected')", [waqfId]);
  await sql("update waqfs set waqfak_role='none', is_demo=true where id=$1", [waqfId]);
}

async function grantRole(userKey: string, role: string) {
  await sql("insert into user_roles (user_id, role_id) select $1, id from roles where key=$2 on conflict do nothing", [demo().users[userKey].id, role]);
}
async function revokeRole(userKey: string, role: string) {
  await sql("delete from user_roles where user_id=$1 and role_id=(select id from roles where key=$2)", [demo().users[userKey].id, role]);
}

async function as(browser: Browser, key: string, viewport: { width: number; height: number } | null) {
  const ctx = await browser.newContext(viewport ? { viewport } : {});
  const page = await ctx.newPage();
  await loginAs(page, key);
  return page;
}

/** Opens a collapsed action (<details>) by its title; leaves it open if it already is. */
async function openAction(page: Page, title: string) {
  const details = page.locator("details", { has: page.locator("summary", { hasText: title }) }).first();
  if (!(await details.evaluate((d) => (d as HTMLDetailsElement).open))) await details.locator("summary").first().click();
}

test.describe.serial("corporate nazara", () => {
  test.describe.configure({ timeout: 300_000 });
  test.beforeAll(async () => {
    await resetWaqf(C());
    await resetWaqf(B());
    await grantRole("emp1", "nazara_officer");
  });
  test.afterAll(async () => {
    await resetWaqf(C());
    await resetWaqf(B());
    await revokeRole("emp1", "nazara_officer");
  });

  test("public catalog takes N01 requests and states the licence condition", async ({ page }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    await page.goto("/services/N01");
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("تولي النظارة (ناظر اعتباري)");
    await expect(page.getByText(/بعد اعتماد ترخيص الهيئة العامة للأوقاف للناظر الاعتباري/).first()).toBeVisible();
    await expect(page.getByRole("link", { name: "اطلب الخدمة" })).toBeVisible();
  });

  test("a client's N01 request opens the nazara intake", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const page = await as(browser, "chair", viewport);
    await page.goto("/app/requests/new?service=N01");
    await expect(page.getByText("كيف تسير خدمة تولي النظارة")).toBeVisible();
    // N01 runs on the waqf's file: only a registered waqf is offered
    await expect(page.getByRole("radio", { name: /غير مسجل/ })).toHaveCount(0);
    await page.getByLabel("اختر الوقف المسجل").selectOption(C());
    await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await page.waitForURL(/\/intake$/, { timeout: 30_000 });
    await page.getByRole("radio", { name: "عضو مجلس النظارة" }).check();
    await page.getByRole("button", { name: "التالي" }).click();
    await passWaqfData(page);
    await page.getByRole("radio", { name: "الواقف يريد تعيين «وقفك»" }).check();
    await page.getByRole("checkbox", { name: "اختيار الواقف" }).check();
    await page.getByRole("button", { name: "التالي" }).click();
    await page.getByTestId("table-assets").getByRole("button", { name: /أضف صفًا/ }).click();
    await page.locator("#q-assets-0-type").selectOption({ index: 1 });
    await page.locator("#q-assets-0-description").fill("أصل تجريبي (اختبار آلي)");
    await page.getByRole("group", { name: /حساب بنكي باسمه/ }).getByRole("radio", { name: "نعم" }).check();
    await page.getByRole("group", { name: /قوائم أو بيانات مالية/ }).getByRole("radio", { name: "لا" }).check();
    await page.getByRole("group", { name: /دعاوى أو مطالبات/ }).getByRole("radio", { name: "لا" }).check();
    for (let i = 0; i < 20 && !(await page.getByTestId("slot-svc_waqf_deed").isVisible()); i++) {
      const nb = page.getByRole("button", { name: "التالي" });
      if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
      await page.waitForTimeout(400); // the wizard saves the step before moving on
    }
    await page.getByTestId("slot-svc_waqf_deed").getByTestId("document-file-input").setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF") });
    await expect(page.getByTestId("slot-svc_waqf_deed").getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    await page.getByRole("button", { name: "التالي" }).click();
    await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
    await page.getByRole("button", { name: "أرسل الطلب" }).click();
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?created=1/, { timeout: 30_000 });
    const [e] = await sql("select status, request_id from nazara_engagements where waqf_id=$1", [C()]);
    expect(e.status).toBe("intake");
    expect(e.request_id).toBeTruthy();
    // the overview of the waqf tells its members
    await page.goto(`/app/w/${C()}`);
    await expect(page.getByText(/نظارة «وقفك» على الوقف: استلام الطلب/)).toBeVisible();
    await page.context().close();
  });

  test("intake → acceptance → licence gate → practice activation", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const page = await as(browser, "admin", viewport);
    await page.goto("/admin/nazara");
    await expect(page.getByRole("heading", { level: 1, name: "النظارة الاعتبارية" })).toBeVisible();
    await expect(page.getByText("ترخيص الناظر الاعتباري غير مفعّل")).toBeVisible();
    await page.getByRole("link", { name: "وقف الإحسان الصحي (تجريبي)" }).click();
    await page.waitForURL(/\/admin\/nazara\/[0-9a-f-]{36}$/);
    const engUrl = page.url();

    // team: emp1 (nazara officer) leads, ops (ops manager) is a member
    await page.getByLabel("الموظف").selectOption({ label: "موظف أول (تجريبي)" });
    await page.getByLabel("الدور").selectOption("lead");
    await page.getByRole("button", { name: "أضف إلى الفريق" }).click();
    await expect(page.getByText("مسؤول الملف ·")).toBeVisible({ timeout: 20_000 });
    await page.getByLabel("الموظف").selectOption({ label: "مدير العمليات (تجريبي)" });
    await page.getByLabel("الدور").selectOption("member");
    await page.getByRole("button", { name: "أضف إلى الفريق" }).click();
    await expect(page.getByText("عضو الفريق ·")).toBeVisible({ timeout: 20_000 });
    const [mem] = await sql("select role_key from waqf_memberships where waqf_id=$1 and user_id=$2 and status='active'", [C(), demo().users.emp1.id]);
    expect(mem.role_key).toBe("nazara_reviewer"); // read-only study access before acceptance

    await openAction(page, "بدء الدراسة");
    await page.getByRole("button", { name: "ابدأ الدراسة" }).click();
    await expect(page.getByText("قيد الدراسة").first()).toBeVisible({ timeout: 20_000 });

    // acceptance is refused while required items are missing
    await openAction(page, "اعتماد قبول النظارة");
    await page.getByRole("button", { name: "اعتمد القبول" }).click();
    await expect(page.getByText(/لا يُعتمد القبول وفي قائمة الاستلام بنود مطلوبة/)).toBeVisible({ timeout: 20_000 });

    // receive every required item (one marked not applicable with its reason)
    const required = await sql("select x->>'key' as key, x->>'label' as label from nazara_engagements e, jsonb_array_elements(e.checklist) x where e.waqf_id=$1 and (x->>'required')::boolean", [C()]);
    for (const [i, it] of required.entries()) {
      const li = page.locator("li", { hasText: it.label }).first();
      await li.locator("summary", { hasText: "تحديث البند" }).click();
      if (i === 0) {
        await li.getByLabel("الحالة").selectOption("not_applicable");
        await li.getByLabel("ملاحظة").fill("الوثيقة لدى الجهة المختصة (اختبار)");
      } else {
        await li.getByLabel("الحالة").selectOption("received");
      }
      await li.getByRole("button", { name: "احفظ البند" }).click();
      await expect(li.getByText(i === 0 ? "لا ينطبق" : "استُلم", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    }

    await openAction(page, "اعتماد قبول النظارة");
    await page.getByRole("button", { name: "اعتمد القبول" }).click();
    await expect(page.getByText("مقبولة، بانتظار المباشرة").first()).toBeVisible({ timeout: 20_000 });

    // appointment decision (م4/6)
    await page.getByLabel("رقم القرار").fill("TEST-NZ-1");
    await page.getByLabel("تاريخه").fill("2026-10-01");
    await page.getByLabel("جهة القرار").selectOption("competent_authority");
    await page.getByLabel("الصلاحيات").fill("إدارة شؤون الوقف وحماية أصوله وتمثيله وفق شرط الواقف (اختبار).");
    await page.getByLabel("الأتعاب").fill("وفق شرط الواقف (اختبار)");
    await page.getByLabel("المسؤوليات").fill("تنفيذ شرط الواقف والتزامات الناظر النظامية (اختبار).");
    await page.getByRole("button", { name: "احفظ قرار التعيين" }).click();
    await expect(page.getByText("حُفظ قرار التعيين.")).toBeVisible({ timeout: 20_000 });

    // licence gate: the same waqf treated as real cannot be started without the GAA licence
    await sql("update waqfs set is_demo=false where id=$1", [C()]);
    await page.reload();
    await expect(page.getByText("المباشرة متوقفة على الترخيص")).toBeVisible();
    await expect(page.locator("summary", { hasText: "مباشرة النظارة" })).toHaveCount(0);
    await sql("update waqfs set is_demo=true where id=$1", [C()]);
    await page.reload();

    await openAction(page, "مباشرة النظارة (تجريبية)");
    await page.getByRole("button", { name: "باشر النظارة" }).click();
    await expect(page.getByText("نظارة قائمة").first()).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("نظارة تجريبية").first()).toBeVisible();
    await expect(page.getByRole("heading", { name: "متابعة التشغيل" })).toBeVisible();
    await page.screenshot({ path: `${SHOTS}/engagement-active.png`, fullPage: true });

    const [w] = await sql("select waqfak_role, nazir_mode from waqfs where id=$1", [C()]);
    expect(w).toEqual({ waqfak_role: "nazir", nazir_mode: "legal_entity" });
    const tr = await sql("select status from trustees where waqf_id=$1 and kind='legal_entity'", [C()]);
    expect(tr.map((t) => t.status)).toEqual(["active"]);
    const [lead] = await sql("select role_key from waqf_memberships where waqf_id=$1 and user_id=$2 and status='active'", [C(), demo().users.emp1.id]);
    expect(lead.role_key).toBe("nazir");
    const tasks = await sql("select title, due_on from tasks where waqf_id=$1 and source_type='nazara'", [C()]);
    expect(tasks.length).toBe(3);
    expect(tasks.every((t) => t.due_on)).toBe(true);
    const [eng] = await sql("select is_practice from nazara_engagements where waqf_id=$1", [C()]);
    expect(eng.is_practice).toBe(true);
    expect(engUrl).toContain("/admin/nazara/");
    await page.context().close();
  });

  test("the nazara team reaches only its waqf; staff without a nazara role cannot open the board", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    // an engagement on another waqf without emp1 in its team
    const admin = await as(browser, "admin", viewport);
    await admin.goto("/admin/nazara?f=all");
    await admin.getByLabel("الوقف").selectOption(B());
    await admin.getByRole("button", { name: "افتح ملف النظارة" }).click();
    await admin.waitForURL(/\/admin\/nazara\/[0-9a-f-]{36}$/, { timeout: 30_000 });
    const otherEng = admin.url().split("/").pop()!;
    await admin.context().close();

    const officer = await as(browser, "emp1", viewport);
    await officer.goto("/admin/nazara?f=all");
    await expect(officer.getByRole("link", { name: "وقف الإحسان الصحي (تجريبي)" })).toBeVisible();
    await expect(officer.getByRole("link", { name: "وقف آل سالم الأهلي (تجريبي)" })).toHaveCount(0);
    await officer.goto(`/admin/nazara/${otherEng}`);
    await expect(officer.getByRole("heading", { level: 1, name: "لم نجد ما طلبته" })).toBeVisible();
    await expect(officer.getByText("وقف آل سالم الأهلي (تجريبي)")).toHaveCount(0);
    // runs the waqf it is nazir of (operational file), and nothing else
    await officer.goto(`/app/w/${C()}/tasks`);
    await expect(officer.getByText(/تحديث سجل المستفيد الحقيقي بملاك «وقفك»/)).toBeVisible();
    await officer.goto(`/app/w/${B()}`);
    await officer.waitForURL(/notfound=1/, { timeout: 30_000 });
    await officer.context().close();

    const plain = await as(browser, "emp2", viewport);
    await plain.goto("/admin/nazara");
    await plain.waitForURL(/\/admin\?denied=1/, { timeout: 30_000 });
    await plain.context().close();
  });

  test("periodic report: draft from real data, approved by someone other than its preparer, then visible to the waqf", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const [{ id: engId }] = await sql("select id from nazara_engagements where waqf_id=$1 and status='active'", [C()]);
    const officer = await as(browser, "emp1", viewport);
    await officer.goto(`/admin/nazara/${engId}`);
    await officer.getByLabel("من", { exact: true }).fill("2026-01-01");
    await officer.getByRole("button", { name: "أعدّ المسودة" }).click();
    await expect(officer.getByText(/أُعدّت مسودة التقرير RPT-/)).toBeVisible({ timeout: 30_000 });
    await expect(officer.getByText("مسودة", { exact: true }).first()).toBeVisible();
    await expect(officer.getByRole("button", { name: "اعتمد", exact: true })).toHaveCount(0); // officer cannot approve
    const pdf = await officer.request.get(await officer.locator('a[href*="/reports/"]', { hasText: "PDF" }).first().getAttribute("href") as string);
    expect(pdf.status()).toBe(200);
    expect(pdf.headers()["content-type"]).toContain("application/pdf");
    const csv = await officer.request.get(await officer.locator('a[href*="format=csv"]').first().getAttribute("href") as string);
    expect(await csv.text()).toContain("تقرير النظارة الدوري");
    await officer.context().close();

    // a draft is not offered to the waqf's members
    const chair = await as(browser, "chair", viewport);
    await chair.goto(`/app/w/${C()}/reports`);
    await expect(chair.getByRole("heading", { name: "مخرجات النظارة" })).toHaveCount(0);

    const admin = await as(browser, "admin", viewport);
    await admin.goto(`/admin/nazara/${engId}`);
    await admin.getByRole("button", { name: "اعتمد", exact: true }).click();
    // the approve form leaves with the draft; the row now shows the approved state
    await expect(admin.getByText("معتمد", { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    await expect(admin.getByRole("button", { name: "اعتمد", exact: true })).toHaveCount(0);
    const [rep] = await sql("select status, approved_by from reports where waqf_id=$1 and kind='nazara_periodic'", [C()]);
    expect(rep.status).toBe("approved");
    expect(rep.approved_by).toBe(demo().users.admin.id);
    await admin.context().close();

    await chair.goto(`/app/w/${C()}/reports`);
    await expect(chair.getByRole("heading", { name: "مخرجات النظارة" })).toBeVisible();
    const dl = await chair.request.get(`/app/w/${C()}/reports/${(await sql("select id from reports where waqf_id=$1 and kind='nazara_periodic'", [C()]))[0].id}/download`);
    expect(dl.status()).toBe(200);
    await chair.context().close();
  });

  test("ending: handover list from the records, then closing ends the team's access", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const [{ id: engId }] = await sql("select id from nazara_engagements where waqf_id=$1 and status='active'", [C()]);
    const admin = await as(browser, "admin", viewport);
    await admin.goto(`/admin/nazara/${engId}`);
    await openAction(admin, "بدء إنهاء النظارة والتسليم");
    await admin.getByLabel("سبب الانتهاء").selectOption("resignation");
    await admin.getByLabel("التفاصيل والمرجع").fill("استقالة مقبولة من الجهة المختصة (اختبار آلي).");
    await admin.getByLabel("الناظر البديل (إن عُرف)").fill("ناظر بديل (تجريبي)");
    await admin.getByRole("button", { name: "ابدأ الإنهاء" }).click();
    await expect(admin.getByText("قيد الإنهاء والتسليم").first()).toBeVisible({ timeout: 20_000 });

    // closing is refused while items are pending
    await openAction(admin, "إقفال النظارة");
    await admin.getByRole("button", { name: "أقفل النظارة" }).click();
    await expect(admin.getByText(/بنود تسليم لم تُستكمل/)).toBeVisible({ timeout: 20_000 });

    const items = await sql("select x->>'label' as label from nazara_engagements e, jsonb_array_elements(e.handover) x where e.id=$1", [engId]);
    expect(items.length).toBe(9);
    for (const it of items) {
      const li = admin.locator("li", { hasText: it.label }).first();
      await li.getByRole("button", { name: "سُلّم", exact: true }).click();
      await expect(li.getByRole("button", { name: "إلغاء التسليم" })).toBeVisible({ timeout: 20_000 });
    }
    await admin.getByRole("button", { name: "أعدّ محضر التسليم" }).click();
    await expect(admin.getByText(/أُعدّ محضر تسليم الوقف RPT-/)).toBeVisible({ timeout: 20_000 });
    await openAction(admin, "إقفال النظارة");
    await admin.getByRole("button", { name: "أقفل النظارة" }).click();
    await expect(admin.getByText("منتهية").first()).toBeVisible({ timeout: 20_000 });
    await admin.screenshot({ path: `${SHOTS}/engagement-ended.png`, fullPage: true });
    await admin.context().close();

    const [w] = await sql("select waqfak_role from waqfs where id=$1", [C()]);
    expect(w.waqfak_role).toBe("none");
    const active = await sql("select 1 from waqf_memberships where waqf_id=$1 and user_id=$2 and status='active'", [C(), demo().users.emp1.id]);
    expect(active.length).toBe(0);
    const officer = await as(browser, "emp1", viewport);
    await officer.goto(`/app/w/${C()}`);
    await officer.waitForURL(/notfound=1/, { timeout: 30_000 });
    await officer.context().close();
  });

  test("dashboard renders on phones without horizontal scroll", async ({ browser, viewport }, info) => {
    test.skip(info.project.name !== "mobile", "layout check on the phone viewport");
    const page = await as(browser, "admin", viewport);
    await page.goto("/admin/nazara?f=all");
    await expect(page.getByRole("heading", { level: 1, name: "النظارة الاعتبارية" })).toBeVisible();
    const { sw, iw } = await page.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    expect(sw).toBeLessThanOrEqual(iw);
    await page.context().close();
  });
});

test.describe.serial("account administration", () => {
  test.describe.configure({ timeout: 180_000 });
  let phone = "";
  let userId = "";
  test.beforeAll(async () => {
    await grantRole("emp2", "system_admin"); // admin.users without admin.clients.edit / admin.pii.view
  });
  test.afterAll(async () => {
    await revokeRole("emp2", "system_admin");
  });

  test("admin edits a client's data; full phone for PII holders; audited; phone change re-verifies", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "creates a user; desktop only");
    const client = await browser.newPage();
    phone = await signup(client, "عميل تعديل (تجريبي)");
    await client.context().close();
    const [u] = await sql("select id from users where phone=$1", [`+966${phone.slice(1)}`]);
    userId = u.id;

    const admin = await as(browser, "admin", viewport);
    await admin.goto(`/admin/users/${userId}`);
    await expect(admin.getByText(`+966${phone.slice(1)}`)).toBeVisible(); // full number for admin.pii.view
    await admin.getByLabel("الاسم الكامل").fill("عميل معدّل (تجريبي)");
    await admin.getByRole("button", { name: "احفظ التعديلات" }).click();
    await expect(admin.getByText("حُفظت البيانات.")).toBeVisible({ timeout: 20_000 });
    await admin.reload();
    await expect(admin.getByLabel("الاسم الكامل")).toHaveValue("عميل معدّل (تجريبي)");

    // a new phone needs a reason; then sessions end and the number must be re-verified
    const newPhone = `05${String(Date.now() + 7).slice(-8)}`;
    await admin.getByLabel("رقم الجوال").fill(newPhone);
    await admin.getByRole("button", { name: "احفظ التعديلات" }).click();
    await expect(admin.getByText(/يتطلب سببًا واضحًا/)).toBeVisible({ timeout: 20_000 });
    await admin.getByLabel("سبب التعديل").fill("طلب العميل تغيير رقمه بعد التحقق من هويته (اختبار).");
    await admin.getByRole("button", { name: "احفظ التعديلات" }).click();
    await expect(admin.getByText(/أُنهيت جلسات الحساب/)).toBeVisible({ timeout: 20_000 });
    const [after] = await sql("select phone, phone_verified_at from users where id=$1", [userId]);
    expect(after.phone).toBe(`+966${newPhone.slice(1)}`);
    expect(after.phone_verified_at).toBeNull();
    const audits = await sql("select before, after from audit_logs where entity_id=$1 and action='admin.user.profile_updated' order by at", [userId]);
    expect(audits.length).toBe(2);
    expect(JSON.stringify(audits[1])).not.toContain(newPhone.slice(2)); // masked in the audit trail
    expect(audits[1].after.changed).toContain("phone");
    await admin.context().close();
  });

  test("without admin.pii.view the phone stays masked; without admin.clients.edit a direct action call is refused", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "depends on the previous test; desktop only");
    // capture the real server-action request from an authorised admin, without letting it through
    const admin = await as(browser, "admin", viewport);
    await admin.goto(`/admin/users/${userId}`);
    let captured: { url: string; headers: Record<string, string>; body: Buffer } | null = null;
    await admin.route(`**/admin/users/${userId}`, async (route) => {
      const req = route.request();
      if (req.method() === "POST" && req.headers()["next-action"]) {
        captured = { url: req.url(), headers: req.headers(), body: req.postDataBuffer()! };
        await route.abort();
      } else await route.continue();
    });
    await admin.getByLabel("الاسم الكامل").fill("محاولة تعديل غير مخولة");
    await admin.getByRole("button", { name: "احفظ التعديلات" }).click();
    await expect.poll(() => captured !== null).toBe(true);
    await admin.context().close();

    const staff = await as(browser, "emp2", viewport);
    await staff.goto(`/admin/users/${userId}`);
    await expect(staff.getByText(/•••••/).first()).toBeVisible();
    await expect(staff.getByRole("heading", { name: "تعديل بيانات الحساب" })).toHaveCount(0);
    const html = await staff.content();
    expect(html).not.toContain((await sql("select phone from users where id=$1", [userId]))[0].phone);

    const cap = captured as unknown as { url: string; headers: Record<string, string>; body: Buffer };
    const res = await staff.request.post(cap.url, {
      headers: { "next-action": cap.headers["next-action"], "content-type": cap.headers["content-type"], accept: "text/x-component", "next-router-state-tree": cap.headers["next-router-state-tree"] ?? "" },
      data: cap.body,
    });
    expect(await res.text()).toContain("ليست لديك صلاحية");
    const [u] = await sql("select full_name from users where id=$1", [userId]);
    expect(u.full_name).toBe("عميل معدّل (تجريبي)");
    await staff.context().close();
  });
});
