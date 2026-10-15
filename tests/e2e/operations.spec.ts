import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * Service flows as one operating system (docs/SERVICE-FLOWS-AUDIT.md):
 *  1. a full service cycle executed by an authorized manager directly (no assignment): tasks created from the flow,
 *     executor ≠ responsible recorded, output drafted from data → edited → regenerated (edits kept) → compared →
 *     submitted → self-approved under its policy → released to the client only after quality review → closed;
 *  2. isolation: the client never reads drafts or task history (RLS), unassigned staff cannot open the request;
 *  3. corporate nazara: two requests on the same waqf share one nazara file (no duplicate), both visible both ways;
 *     cancelling one informs the file without changing it; rejecting the file rejects the open request;
 *  4. a request sent «with no waqf» opens its waqf file once (idempotent) and both sides show the link.
 * Desktop only (shared state on demo records).
 */

const shots = "/tmp/claude-0/shots";
const ex = expect.configure({ timeout: 25_000 });
mkdirSync(shots, { recursive: true });

function ownerDb() {
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_OWNER_URL="));
  return new pg.Client({ connectionString: line!.slice("DATABASE_OWNER_URL=".length).trim() });
}
function appDb() {
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_URL="));
  return new pg.Client({ connectionString: line!.slice("DATABASE_URL=".length).trim() });
}
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const db = ownerDb();
  await db.connect();
  try {
    return (await db.query(q, params)).rows as T[];
  } finally {
    await db.end();
  }
}
/** Runs a query as the application role for a given user (RLS applies). */
async function asUser<T = Record<string, unknown>>(userId: string, q: string, params: unknown[] = []): Promise<T[]> {
  const db = appDb();
  await db.connect();
  try {
    await db.query("begin");
    await db.query("select set_config('app.user_id', $1, true)", [userId]);
    const r = (await db.query(q, params)).rows as T[];
    await db.query("rollback");
    return r;
  } finally {
    await db.end();
  }
}

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string, viewport: { width: number; height: number } | null): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-ops-${key}-${demo().users[key].id}.json`;
  const opts = viewport ? { viewport } : {};
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const page = await ctx.newPage();
    const res = await page.request.get("/api/files/00000000-0000-4000-8000-000000000000");
    if (res.status() !== 401) {
      pages.set(key, page);
      return page;
    }
    await ctx.close();
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  pages.set(key, page);
  return page;
}

const go = (page: Page, url: string) => page.goto(`${url}${url.includes("?") ? "&" : "?"}t=${Date.now()}`);

/** Fills the service form wizard up to submission (radio answers by label), returns the request id. */
async function submitRequest(page: Page, service: string, waqf: string, answers: (p: Page) => Promise<void>) {
  await page.goto(`/app/requests/new?service=${service}&waqf=${waqf}`);
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
  const id = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
  await page.getByRole("radio", { name: "ناظر الوقف" }).check();
  await page.getByRole("button", { name: "التالي" }).click();
  await answers(page);
  const confirm = page.getByLabel(/أقر بأن البيانات والمستندات/);
  for (let i = 0; i < 5 && !(await confirm.isVisible()); i++) await page.getByRole("button", { name: "التالي" }).click();
  await confirm.check();
  await page.getByRole("button", { name: "أرسل الطلب" }).click();
  await page.waitForURL(/\?created=1/, { timeout: 30_000 });
  return id;
}

async function act(page: Page, name: string | RegExp) {
  await page.getByRole("button", typeof name === "string" ? { name, exact: true } : { name }).first().click();
}

test.describe.serial("service flows as one operating system", () => {
  test.setTimeout(300_000);
  const A = () => demo().waqfs.A;
  const U = () => demo().users;
  let reqId = "";
  let outputId = "";
  const created: { waqfs: string[]; requests: string[] } = { waqfs: [], requests: [] };

  test.beforeAll(async () => {
    // no open nazara file may be left on waqf A by earlier runs of this suite
    await sql("update nazara_engagements set status = 'rejected', decision = 'rejected', decision_reason = 'تنظيف اختبار آلي' where waqf_id = $1 and status not in ('rejected','ended')", [A()]);
    await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [U().nazir.id]);
  });

  test.afterAll(async () => {
    for (const p of pages.values()) await p.context().close();
    pages.clear();
    for (const r of created.requests) await sql("update service_requests set waqf_id = null where id = $1", [r]);
    for (const w of created.waqfs) {
      await sql("delete from request_links where entity_id = $1 or waqf_id = $1", [w]);
      for (const t of ["waqf_memberships", "waqf_keys", "waqf_timeline_events", "obligation_instances"]) await sql(`delete from ${t} where waqf_id = $1`, [w]);
      await sql("delete from waqfs where id = $1", [w]);
    }
  });

  test("an authorized manager executes the whole service cycle directly, without assigning anyone", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const nazir = await as(browser, "nazir", viewport);
    reqId = await submitRequest(nazir, "G01", A(), async (p) => {
      await p.getByRole("group", { name: /هل للوقف مجلس نظارة/ }).getByRole("radio", { name: "نعم" }).check();
    });
    const [intake] = await sql<{ status: string; assignee_user_id: string | null }>("select status, assignee_user_id from tasks where request_id = $1 and kind = 'intake'", [reqId]);
    expect(intake).toMatchObject({ status: "todo", assignee_user_id: null });

    const admin = await as(browser, "admin", viewport);
    await go(admin, `/admin/requests/${reqId}`);
    await ex(admin.getByTestId("task-intake")).toBeVisible();
    await act(admin, "بدء الفرز");
    await ex(admin.getByRole("button", { name: "تحققت من البيانات والمستندات", exact: true })).toBeVisible();
    await act(admin, "تحققت من البيانات والمستندات");
    await ex(admin.getByRole("button", { name: "اقبل الطلب للخدمة", exact: true })).toBeVisible();
    await act(admin, "اقبل الطلب للخدمة");
    await ex.poll(async () => (await sql<{ status: string }>("select status from tasks where request_id = $1 and kind = 'intake'", [reqId]))[0].status).toBe("done");

    // start work (a paid service started by operations as a package) → execution tasks appear, once
    await go(admin, `/admin/requests/${reqId}`);
    await act(admin, "بدء التنفيذ");
    await ex(admin.getByTestId("task-stage-analysis")).toBeVisible();
    const kinds = await sql<{ kind: string; n: number }>("select kind, count(*)::int n from tasks where request_id = $1 group by kind order by kind", [reqId]);
    expect(kinds).toEqual([{ kind: "intake", n: 1 }, { kind: "prepare_output", n: 1 }, { kind: "review_output", n: 1 }, { kind: "stage", n: 2 }]);

    // the manager completes the stage task himself → the workflow moves to the next stage; executor ≠ responsible recorded
    await admin.getByTestId("task-stage-analysis").getByRole("button", { name: "أكملها بنفسي" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from request_stages where request_id = $1 and stage_key = 'drafting'", [reqId]))[0].status).toBe("active");
    const [ev] = await sql<{ direct: boolean; actor_user_id: string; owner_user_id: string | null }>("select direct, actor_user_id, owner_user_id from task_events e join tasks t on t.id = e.task_id where t.request_id = $1 and t.stage_key = 'analysis' and e.action = 'complete'", [reqId]);
    expect(ev).toMatchObject({ direct: true, actor_user_id: U().admin.id, owner_user_id: null });

    // output drafted from the platform's data
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByTestId("output-G01.main").getByRole("button", { name: "احفظ مسودة من بيانات الطلب" }).click();
    await ex(admin.getByTestId("output-G01.main").getByRole("link", { name: /معاينة وتحرير/ })).toBeVisible();
    await ex.poll(async () => (await sql("select 1 from outputs where request_id = $1", [reqId])).length).toBe(1);
    [{ id: outputId }] = await sql<{ id: string }>("select id from outputs where request_id = $1", [reqId]);
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await ex(admin.getByTestId("section-waqf")).toContainText("وقف النور التعليمي");
    await ex(admin.getByTestId("section-governance")).toContainText("سياسة تعارض مصالح");
    await ex(admin.getByTestId("output-gaps")).toContainText("لم يُكتب");

    // submission is not offered while the specialist parts are empty, and the reason is shown
    await ex(admin.getByTestId("submit-blocked")).toContainText("لم يُكتب");
    await ex(admin.getByRole("button", { name: "أرسلها للمراجعة والاعتماد" })).toBeDisabled();

    // edit: write the specialist parts, correct a value, add a section → new version (history kept)
    for (const t of await admin.locator('textarea[name^="spec:"]').all()) await t.fill("نص كتبه المختص في الاختبار الآلي.");
    await admin.locator('input[name="new_title"]').fill("ملاحظات المراجع");
    await admin.locator('textarea[name="new_body"]').fill("قسم أضافه المراجع.");
    await act(admin, "احفظ نسخة جديدة");
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(2);

    // regeneration after edits needs confirmation and keeps the human text
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await admin.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(admin.getByText(/النسخة الحالية فيها تعديلات بشرية/)).toBeVisible();
    await admin.getByLabel(/أؤكد إعادة التوليد/).check();
    await admin.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(admin.getByTestId("output-versions").locator("li")).toHaveCount(3);
    const [v3] = await sql<{ origin: string; sections: unknown }>("select origin, sections from output_versions where output_id = $1 and version = 3", [outputId]);
    expect(v3.origin).toBe("regenerated");
    expect(JSON.stringify(v3.sections)).toContain("نص كتبه المختص في الاختبار الآلي.");
    expect(JSON.stringify(v3.sections)).toContain("قسم أضافه المراجع.");
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}?a=1&b=2`);
    await ex(admin.getByTestId("output-diff")).toContainText("ملاحظات المراجع");
    // a version cannot be rewritten
    await expect(sql("update output_versions set note = 'x' where output_id = $1", [outputId])).rejects.toThrow(/append-only/);

    // submit → approve (self-approval of a self_allowed output by an authorized manager, recorded)
    await go(admin, `/admin/requests/${reqId}/outputs/${outputId}`);
    await act(admin, "أرسلها للمراجعة والاعتماد");
    await ex(admin.getByText("بانتظار المراجعة").first()).toBeVisible();
    await act(admin, "اعتمد المخرج");
    await ex(admin.getByText(/معتمد — النسخة 3/)).toBeVisible();
    const [o] = await sql<{ status: string; self_approved: boolean; deliverable_id: string | null; document_id: string | null }>("select status, self_approved, deliverable_id, document_id from outputs where id = $1", [outputId]);
    expect(o).toMatchObject({ status: "approved", self_approved: true, document_id: null });
    expect(o.deliverable_id).toBeTruthy();
    const taskStates = await sql<{ kind: string; status: string }>("select kind, status from tasks where request_id = $1 and output_key = 'G01.main' order by kind", [reqId]);
    expect(taskStates).toEqual([{ kind: "prepare_output", status: "done" }, { kind: "review_output", status: "done" }]);
    await admin.screenshot({ path: `${shots}/output-approved-desktop.png`, fullPage: true });

    // the client does not see the work while it is in preparation (UI and database)
    await go(nazir, `/app/requests/${reqId}`);
    await ex(nazir.getByRole("heading", { level: 1 })).toBeVisible();
    await ex(nazir.getByText("بانتظار اعتمادك")).toHaveCount(0);
    await ex(nazir.getByText(/أُعدّت مسودة|أُعيد توليد|النسخة 3/)).toHaveCount(0);
    expect(await asUser(U().nazir.id, "select id from outputs where request_id = $1", [reqId])).toHaveLength(0);
    expect(await asUser(U().nazir.id, "select id from task_events where request_id = $1", [reqId])).toHaveLength(0);
    expect(await asUser(U().nazir.id, "select id from output_versions where request_id = $1", [reqId])).toHaveLength(0);

    // last stage → quality review → to the client (four-eyes satisfied by the recorded self-approval policy)
    await go(admin, `/admin/requests/${reqId}`);
    await act(admin, "إرسال لمراجعة الجودة");
    await ex(admin.getByRole("button", { name: "اعتماد الجودة وإرسال للعميل" })).toBeVisible();
    await act(admin, "اعتماد الجودة وإرسال للعميل");
    await ex.poll(async () => (await sql<{ document_id: string | null }>("select document_id from outputs where id = $1", [outputId]))[0].document_id, { timeout: 60_000 }).toBeTruthy();
    const [rel] = await sql<{ document_id: string; status: string }>("select d.document_id, r.status from deliverables d join service_requests r on r.id = d.request_id where d.output_id = $1", [outputId]);
    expect(rel.status).toBe("awaiting_client_approval");
    // internal steps are recorded for the team (task events, audit), not in the client's request history
    const audits = await sql<{ action: string; after: Record<string, unknown> }>("select action, after from audit_logs where entity_id = any($1::text[]) order by id", [[outputId, reqId]]);
    expect(audits.find((a) => a.action === "outputs.approve")?.after).toMatchObject({ selfApproved: true, policy: "self_allowed" });
    expect(audits.find((a) => a.action === "requests.transition.awaiting_client_approval")?.after).toMatchObject({ selfApprovalQA: true });
    const clientEvents = await sql<{ note: string }>("select note from request_events where request_id = $1", [reqId]);
    expect(clientEvents.map((e) => e.note).join("\n")).not.toMatch(/أُعدّت مسودة|أُعيد توليد|اعتُمد المخرج/);

    // the client now receives the approved PDF and approves the work
    await go(nazir, `/app/requests/${reqId}`);
    await ex(nazir.getByText("بانتظار اعتمادك")).toBeVisible();
    const pdf = await nazir.request.get(`/api/files/${rel.document_id}`);
    expect(pdf.status()).toBe(200);
    expect((await pdf.body()).subarray(0, 4).toString()).toBe("%PDF");
    await act(nazir, "أعتمد المخرجات");
    await ex.poll(async () => (await sql<{ status: string }>("select status from service_requests where id = $1", [reqId]))[0].status).toBe("completed");
    await go(admin, `/admin/requests/${reqId}`);
    await act(admin, "إغلاق الطلب");
    await ex.poll(async () => (await sql<{ status: string }>("select status from service_requests where id = $1", [reqId]))[0].status).toBe("closed");
  });

  test("staff not assigned cannot open the request; the dashboard lists real work with direct links", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const emp = await as(browser, "emp1", viewport);
    await go(emp, `/admin/requests/${reqId}`);
    await ex(emp.getByRole("heading", { name: "لم نجد ما طلبته" })).toBeVisible();
    await ex(emp.getByTestId("outputs")).toHaveCount(0);
    // the PDF route of outputs is staff-and-access only
    const nazir = await as(browser, "nazir", viewport);
    expect((await nazir.request.get(`/admin/requests/${reqId}/outputs/${outputId}/pdf`)).status()).not.toBe(200);

    const admin = await as(browser, "admin", viewport);
    await go(admin, "/admin");
    await ex(admin.getByRole("heading", { name: "ما ينتظر الإجراء" })).toBeVisible();
    await admin.screenshot({ path: `${shots}/admin-queues-desktop.png`, fullPage: true });
    // filters on the request list
    await go(admin, `/admin/requests?tab=all&service=G01&status=closed`);
    await ex(admin.getByRole("link", { name: (await sql<{ number: string }>("select number from service_requests where id = $1", [reqId]))[0].number })).toBeVisible();
  });

  test("two nazara requests on one waqf share one file; cancelling one informs it; rejecting the file rejects the other", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const nazir = await as(browser, "nazir", viewport);
    const n01 = async () => submitRequest(nazir, "N01", A(), async (p) => {
      await p.getByRole("radio", { name: "الواقف يريد تعيين «وقفك»" }).check();
      await p.getByRole("checkbox", { name: "اختيار الواقف" }).check();
      await p.getByRole("button", { name: "التالي" }).click();
      await p.getByTestId("table-assets").getByRole("button", { name: /أضف صفًا/ }).click();
      await p.locator("#q-assets-0-type").selectOption({ index: 1 });
      await p.locator("#q-assets-0-description").fill("أصل تجريبي (اختبار آلي)");
      await p.getByRole("group", { name: /حساب بنكي باسمه/ }).getByRole("radio", { name: "نعم" }).check();
      await p.getByRole("group", { name: /قوائم أو بيانات مالية/ }).getByRole("radio", { name: "لا" }).check();
      await p.getByRole("group", { name: /دعاوى أو مطالبات/ }).getByRole("radio", { name: "لا" }).check();
      for (let i = 0; i < 20 && !(await p.getByTestId("slot-svc_waqf_deed").isVisible()); i++) {
        const nb = p.getByRole("button", { name: "التالي" });
        if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
        await p.waitForTimeout(400); // the wizard saves the step before moving on
      }
      const slot = p.getByTestId("slot-svc_waqf_deed");
      await slot.waitFor({ timeout: 15_000 });
      await slot.getByTestId("document-file-input").setInputFiles({ name: "deed.pdf", mimeType: "application/pdf", buffer: Buffer.from("%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF") });
      await ex(slot.getByText("أُرفق")).toBeVisible({ timeout: 30_000 });
    });
    const first = await n01();
    const second = await n01();
    const engs = await sql<{ id: string; number: string; request_id: string }>("select id, number, request_id from nazara_engagements where waqf_id = $1 and status not in ('rejected','ended')", [A()]);
    expect(engs).toHaveLength(1);
    const links = await sql<{ request_id: string; relation: string }>("select request_id, relation from request_links where entity_type = 'nazara_engagement' and entity_id = $1 order by relation", [engs[0].id]);
    expect(links).toEqual([{ request_id: first, relation: "origin" }, { request_id: second, relation: "related" }]);

    // both ways: the request shows its nazara file, the file shows both requests
    const admin = await as(browser, "admin", viewport);
    await go(admin, `/admin/requests/${second}`);
    await ex(admin.getByTestId("request-links")).toContainText(`ملف النظارة ${engs[0].number}`);
    await ex(admin.getByTestId("request-links")).toContainText("مرتبط بملف قائم");
    await go(admin, `/admin/nazara/${engs[0].id}`);
    await ex(admin.getByTestId("nazara-request-link")).toHaveCount(2);

    // the nazara study output is drafted from the file and the waqf data (while the request is under study)
    await go(admin, `/admin/requests/${first}`);
    await act(admin, "بدء الفرز");
    await ex(admin.getByTestId("output-N01.main").getByRole("button", { name: "احفظ مسودة من بيانات الطلب" })).toBeVisible();
    await admin.getByTestId("output-N01.main").getByRole("button", { name: "احفظ مسودة من بيانات الطلب" }).click();
    await ex.poll(async () => JSON.stringify((await sql<{ sections: unknown }>("select v.sections from output_versions v join outputs o on o.id = v.output_id where o.request_id = $1", [first]))[0]?.sections ?? "")).toContain(`ملف النظارة ${engs[0].number}`);
    // uploaded is not verified: the deed is verified document by document before the intake check
    await admin.getByTestId("docslot-svc_waqf_deed").getByRole("button", { name: "تحققت منه" }).click();
    await ex(admin.getByTestId("docslot-svc_waqf_deed")).toContainText("متحقق منه");
    // N01 acceptance goes through the nazara file decision, not the request button
    await act(admin, "تحققت من البيانات والمستندات");
    await ex(admin.getByRole("button", { name: "اقبل الطلب للخدمة", exact: true })).toBeVisible();
    await act(admin, "اقبل الطلب للخدمة");
    await ex(admin.getByText(/يُقبل طلب النظارة باعتماد قبول ملف النظارة/)).toBeVisible();

    // the client cancels the second request → the file is informed, not changed
    await go(nazir, `/app/requests/${second}`);
    await nazir.getByRole("button", { name: "إلغاء الطلب" }).click();
    await nazir.getByLabel("السبب أو الملاحظة").fill("لم نعد بحاجة إلى طلب ثانٍ (اختبار آلي).");
    await nazir.getByRole("button", { name: "إلغاء الطلب" }).last().click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from service_requests where id = $1", [second]))[0].status).toBe("cancelled");
    const [closedEv] = await sql<{ note: string }>("select note from nazara_events where engagement_id = $1 and action = 'request_closed'", [engs[0].id]);
    expect(closedEv.note).toMatch(/يبقى الملف مرتبطًا بطلب مفتوح آخر/);
    expect((await sql<{ status: string }>("select status from nazara_engagements where id = $1", [engs[0].id]))[0].status).toBe("intake");

    // the nazara manager rejects the file → the open request is rejected by rule, with the reason
    await go(admin, `/admin/nazara/${engs[0].id}`);
    await admin.locator("details", { has: admin.locator("summary", { hasText: "رفض الطلب" }) }).first().locator("summary").click();
    await admin.getByLabel("سبب الرفض").fill("رفض اختباري: الملف لا يستوفي المتطلبات (اختبار آلي).");
    await admin.getByRole("button", { name: "ارفض الطلب" }).click();
    await ex.poll(async () => (await sql<{ status: string }>("select status from service_requests where id = $1", [first]))[0].status).toBe("rejected");
    const [rej] = await sql<{ reject_reason: string }>("select reject_reason from service_requests where id = $1", [first]);
    expect(rej.reject_reason).toMatch(/رُفض ملف النظارة/);
    expect((await sql<{ status: string }>("select status from tasks where request_id = $1 and kind = 'intake'", [first]))[0].status).toBe("cancelled");
  });

  test("a request with no waqf opens its waqf file once, and both sides show the link", async ({ browser, viewport }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");
    const [svc] = await sql<{ id: string }>("select id from services where code = 'T01'");
    const [r] = await sql<{ id: string; number: string }>(
      `insert into service_requests (number, service_id, waqf_id, requester_user_id, status, priority, intake, submitted_at)
       values ('REQ-T' || floor(random()*1e9)::text, $1, null, $2, 'submitted', 'normal', $3::jsonb, now()) returning id, number`,
      [svc.id, U().nazir.id, JSON.stringify({ answers: { capacity: "waqif", waqfName: "وقف اختبار من طلب" } })],
    );
    created.requests.push(r.id);
    const admin = await as(browser, "admin", viewport);
    await go(admin, `/admin/requests/${r.id}`);
    await ex(admin.getByTestId("request-links")).toContainText("غير مرتبط بملف وقف");
    await ex(admin.getByLabel("اسم الوقف")).toHaveValue("وقف اختبار من طلب");
    await act(admin, "افتح ملف الوقف من الطلب");
    await ex(admin.getByTestId("request-links")).toContainText("نشأ عن هذا الطلب");
    const [w] = await sql<{ waqf_id: string }>("select waqf_id from service_requests where id = $1", [r.id]);
    created.waqfs.push(w.waqf_id);
    expect((await sql("select 1 from request_links where request_id = $1 and entity_type = 'waqf' and relation = 'origin'", [r.id]))).toHaveLength(1);
    const [m] = await sql<{ role_key: string }>("select role_key from waqf_memberships where waqf_id = $1 and user_id = $2", [w.waqf_id, U().nazir.id]);
    expect(m.role_key).toBe("founder");
    // the creation form is gone (no second waqf), and the waqf file points back to its origin request
    await ex(admin.getByRole("button", { name: "افتح ملف الوقف من الطلب" })).toHaveCount(0);
    await go(admin, `/admin/waqfs/${w.waqf_id}`);
    await ex(admin.getByText("فتح الملف")).toBeVisible();
    await ex(admin.getByRole("link", { name: r.number, exact: true })).toBeVisible();
    // the operations center of the waqf lists the open request too (two-way)
    await ex(admin.getByTestId(`center-req:${r.id}`)).toBeVisible();
  });

  test("mobile: dashboard queues, request workspace and output editor fit the screen", async ({ browser, viewport }, info) => {
    test.skip(info.project.name !== "mobile", "mobile layout check");
    const [o] = await sql<{ id: string; request_id: string }>("select id, request_id from outputs order by created_at desc limit 1");
    test.skip(!o, "no output yet (desktop suite creates one)");
    const admin = await as(browser, "admin", viewport);
    for (const [url, name] of [["/admin", "queues"], [`/admin/requests/${o.request_id}`, "request"], [`/admin/requests/${o.request_id}/outputs/${o.id}`, "output"]] as const) {
      await go(admin, url);
      await ex(admin.getByRole("heading", { level: 1 })).toBeVisible();
      const overflow = await admin.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
      expect(overflow, url).toBeLessThanOrEqual(1);
      await admin.screenshot({ path: `${shots}/ops-${name}-mobile.png`, fullPage: false });
    }
  });
});
