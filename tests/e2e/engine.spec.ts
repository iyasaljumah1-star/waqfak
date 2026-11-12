import { existsSync, readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs, passWaqfData } from "./helpers";

/**
 * The processing core (owner's order of 2026-11-01), end to end on the LOCAL environment:
 * submission → independent worker → rules → knowledge base → model (mock provider: synthetic data only) → document →
 * verification → the system administrator's review → final approval → release to the client. Plus: missing data asked
 * of the client and resumed, blocked outputs, no access before approval (UI, files, deliveries, RLS, links), only the
 * super admin approves (UI and database trigger), concurrent and duplicate submission, retry and failure, the processing
 * and audit log, and no sensitive data in errors, notifications or model calls.
 *
 * Requires: the server and `scripts/worker.ts` running with ENGINE_LLM_PROVIDER=mock. The engine flag and the service list
 * are switched on for this suite only (local database) and restored afterwards.
 */

const ex = expect.configure({ timeout: 30_000 });
const SERVICE = "C01";
const MARKER = "ملاحظة-اختبار-0551234567-1012345678";

function envLine(key: string) {
  return readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith(`${key}=`))!.slice(key.length + 1).trim();
}
async function withClient<T>(url: string, fn: (c: pg.Client) => Promise<T>): Promise<T> {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return await fn(c); } finally { await c.end(); }
}
const sql = <T = Record<string, unknown>>(q: string, p: unknown[] = []) => withClient(envLine("DATABASE_OWNER_URL"), async (c) => (await c.query(q, p)).rows as T[]);
/** The application role under a user's RLS context, as the web process uses it. */
const asUserDb = <T = Record<string, unknown>>(userId: string, q: string, p: unknown[] = []) =>
  withClient((process.env.SYSTEM_DATABASE_URL ?? envLine("DATABASE_URL")), async (c) => {
    await c.query("begin");
    try {
      await c.query("select set_config('app.user_id', $1, true), set_config('app.global_access', 'off', true)", [userId]);
      return (await c.query(q, p)).rows as T[];
    } finally { await c.query("rollback"); }
  });

async function until<T>(fn: () => Promise<T | null | undefined | false>, what: string, ms = 60_000): Promise<T> {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > end) throw new Error(`timed out waiting for ${what}`);
    await new Promise((r) => setTimeout(r, 750));
  }
}
const lastRun = (id: string) => sql<{ status: string; outcome: { status: string; blockers?: string[] }; rules: { id: string; version: string }[]; sources: { code: string }[]; model: { provider: string; calls: number } | null }>(
  "select status, outcome, rules, sources, model from processing_runs where request_id = $1 order by started_at desc limit 1", [id]).then((r) => r[0]);
const reqRow = (id: string) => sql<{ status: string; processing_mode: string; number: string }>("select status, processing_mode, number from service_requests where id = $1", [id]).then((r) => r[0]);
/** A run that ended blocked fails the wait at once, with its reasons (no silent timeout). */
async function untilStatus(id: string, status: string) {
  return until(async () => {
    const r = await reqRow(id);
    if (r.status === status) return r;
    const run = await lastRun(id);
    if (run?.status === "blocked" && status !== "blocked") throw new Error(`processing blocked: ${JSON.stringify(run.outcome.blockers)}`);
    return null;
  }, `request ${id} → ${status}`);
}

const pages = new Map<string, Page>();
async function as(browser: Browser, key: string, viewport: { width: number; height: number } | null): Promise<Page> {
  const cached = pages.get(key);
  if (cached) return cached;
  const file = `/tmp/claude-0/e2e-engine-${key}-${demo().users[key].id}.json`;
  const opts = viewport ? { viewport } : {};
  if (existsSync(file)) {
    const ctx = await browser.newContext({ ...opts, storageState: file });
    const page = await ctx.newPage();
    if ((await page.request.get("/api/files/00000000-0000-4000-8000-000000000000")).status() !== 401) { pages.set(key, page); return page; }
    await ctx.close();
  }
  const ctx = await browser.newContext(opts);
  const page = await ctx.newPage();
  await loginAs(page, key);
  await ctx.storageState({ path: file });
  pages.set(key, page);
  return page;
}

/** Fills and opens the C01 form up to its review step (with or without a registered waqf). */
async function openC01(page: Page, waqf: string | null, goal = "") {
  await page.goto(waqf ? `/app/requests/new?service=${SERVICE}&waqf=${waqf}` : `/app/requests/new?service=${SERVICE}`);
  if (!waqf) await page.getByRole("radio", { name: /لا يوجد لدي وقف قائم/ }).check();
  await page.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
  await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
  const id = page.url().match(/requests\/([0-9a-f-]{36})/)![1];
  await page.getByRole("radio", { name: waqf ? "ناظر الوقف" : "الواقف أو من يريد إنشاء الوقف" }).check();
  await page.getByRole("button", { name: "التالي" }).click();
  await passWaqfData(page);
  await page.getByRole("checkbox", { name: "الحوكمة والنظارة" }).check();
  if (goal) await page.getByLabel(/ملاحظة إضافية/).fill(goal);
  await page.getByRole("button", { name: /المراجعة والإرسال/ }).click();
  await page.getByLabel(/أقر بأن البيانات والمستندات/).check();
  return id;
}

test.describe.configure({ mode: "serial" });

test.describe("processing core: automatic processing, final approval, release", () => {
  let reqId = "";
  let outputText = "";
  let flagBefore: boolean;
  let servicesBefore: unknown;

  test.beforeAll(async () => {
    const [f] = await sql<{ enabled: boolean }>("select enabled from feature_flags where key = 'engine.enabled'");
    const [s] = await sql<{ value: unknown }>("select value from settings where key = 'engine.services'");
    flagBefore = f.enabled;
    servicesBefore = s.value;
    await sql("update feature_flags set enabled = true where key = 'engine.enabled'");
    await sql("update settings set value = $1::jsonb where key = 'engine.services'", [JSON.stringify([SERVICE])]);
    const [real] = await sql<{ enabled: boolean }>("select enabled from feature_flags where key = 'engine.llm_real_data'");
    expect(real.enabled).toBe(false); // real-data processing stays off throughout
    await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [demo().users.nazir.id]);
  });
  test.afterAll(async () => {
    await sql("update feature_flags set enabled = $1 where key = 'engine.enabled'", [flagBefore]);
    await sql("update settings set value = $1::jsonb where key = 'engine.services'", [JSON.stringify(servicesBefore)]);
  });

  test("1 · the client submits and gets only the confirmation; the worker processes the request on its own", async ({ browser, viewport }) => {
    const page = await as(browser, "nazir", viewport);
    reqId = await openC01(page, demo().waqfs.A, MARKER);
    await page.getByRole("button", { name: "طلب النتيجة" }).click();
    await page.waitForURL(/\?created=1/);
    const conf = page.getByTestId("submitted-confirmation");
    await ex(conf).toContainText("تم إرسال طلبك بنجاح ✓");
    await ex(conf).toContainText(/تم تسجيل طلبك برقم: REQ-\d+/);
    await ex(conf).toContainText("سيتم معالجة طلبك وإشعارك عند اكتمال المراجعة والاعتماد النهائي");
    expect((await reqRow(reqId)).processing_mode).toBe("engine");
    // the client leaves: processing does not depend on the page
    await page.goto("/app");
    await untilStatus(reqId, "quality_review");
  });

  test("6 · nothing of the output reaches the client before approval: UI, files, deliveries, RLS, links, events", async ({ browser, viewport }) => {
    const naz = await as(browser, "nazir", viewport);
    const nazirId = demo().users.nazir.id;
    const [v] = await sql<{ sections: { blocks: { type: string; text?: string }[] }[]; output_id: string }>(
      "select v.sections, v.output_id from output_versions v join outputs o on o.id = v.output_id and v.version = o.current_version where o.request_id = $1", [reqId]);
    outputText = v.sections.flatMap((s) => s.blocks).find((b) => b.type === "specialist" && (b.text ?? "").length > 40)!.text!.slice(0, 40);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}`);
    await ex(naz.getByTestId("client-phase")).toContainText("قيد المراجعة والاعتماد النهائي");
    await ex(naz.getByTestId("deliverable")).toHaveCount(0);
    await ex(naz.locator("body")).not.toContainText(outputText);
    // direct links: the admin review, the output editor, the file of any output document, a delivery
    for (const url of [`/admin/review/${reqId}`, `/admin/requests/${reqId}/outputs/${v.output_id}`]) {
      const res = await naz.request.get(url);
      expect(await res.text()).not.toContain(outputText);
    }
    const docs = await sql<{ id: string }>("select id from documents where request_id = $1 and doc_type = 'deliverable'", [reqId]);
    for (const d of docs) expect([403, 404]).toContain((await naz.request.get(`/api/files/${d.id}`)).status());
    const dels = await sql<{ id: string }>("select id from deliverables where request_id = $1", [reqId]);
    expect(dels).toHaveLength(0);
    expect([403, 404]).toContain((await naz.request.get(`/api/deliveries/${randomUUID()}`)).status());
    // the database itself, under the client's identity (RLS)
    expect(await asUserDb(nazirId, "select id from outputs where request_id = $1", [reqId])).toHaveLength(0);
    expect(await asUserDb(nazirId, "select output_id from output_versions where request_id = $1", [reqId])).toHaveLength(0);
    expect(await asUserDb(nazirId, "select id from processing_runs where request_id = $1", [reqId])).toHaveLength(0);
    expect(await asUserDb(nazirId, "select id from processing_steps where request_id = $1", [reqId])).toHaveLength(0);
    expect(await asUserDb(nazirId, "select id from request_events where request_id = $1 and internal", [reqId])).toHaveLength(0);
    expect(await asUserDb(nazirId, "select id from deliverables where request_id = $1", [reqId])).toHaveLength(0);
    // the client's notifications carry no output and no link to one
    const notes = await sql<{ title_ar: string; body_ar: string | null; link: string | null }>("select title_ar, body_ar, link from notifications where user_id = $1 and created_at > now() - interval '1 hour'", [nazirId]);
    for (const n of notes) {
      expect(`${n.title_ar} ${n.body_ar ?? ""}`).not.toContain(outputText);
      expect(n.link ?? "").not.toMatch(/\/api\/files|\/outputs\//);
    }
  });

  test("3/4 · the review screen shows the rules, sources, model, verification and a complete document", async ({ browser, viewport }) => {
    const run = await lastRun(reqId);
    expect(run.status).toBe("ready");
    expect(run.rules).toEqual([{ id: "core.common", version: "1.0.0" }]);
    expect(run.sources.map((s) => s.code).some((c) => ["NAZARA-REG", "NAZIR-GUIDE"].includes(c))).toBe(true);
    expect(run.model?.provider).toBe("mock");
    // complete: every analysis block written and sourced, no placeholder, no blocking gap
    const [v] = await sql<{ sections: { removed?: boolean; blocks: { type: string; text?: string; refs?: unknown[] }[] }[]; gaps: { severity: string }[] }>(
      "select v.sections, v.gaps from output_versions v join outputs o on o.id = v.output_id and v.version = o.current_version where o.request_id = $1", [reqId]);
    const spec = v.sections.filter((s) => !s.removed).flatMap((s) => s.blocks).filter((b) => b.type === "specialist");
    expect(spec.length).toBeGreaterThan(0);
    for (const b of spec) {
      expect((b.text ?? "").trim().length).toBeGreaterThan(20);
      expect(b.text).not.toMatch(/يُستكمل|TODO|\[تعارض/);
      expect((b.refs ?? []).length).toBeGreaterThan(0);
    }
    expect(v.gaps.filter((g) => g.severity === "blocking")).toHaveLength(0);

    const admin = await as(browser, "admin", viewport);
    await admin.goto("/admin/review");
    const number = (await reqRow(reqId)).number;
    await ex(admin.getByTestId("review-list-ready")).toContainText(number);
    await admin.goto(`/admin/review/${reqId}`);
    const rec = admin.getByTestId("processing-record");
    await ex(rec).toContainText("core.common@1.0.0");
    await ex(rec).toContainText("mock");
    await ex(rec).toContainText(/NAZARA-REG|NAZIR-GUIDE/);
    await ex(admin.getByTestId("verification")).toContainText("اجتاز التحقق");
    await ex(admin.getByTestId("review-output")).toContainText(outputText);
  });

  test("7 · only the super admin approves: an operations manager cannot, in the UI or in the database", async ({ browser, viewport }) => {
    const ops = await as(browser, "ops", viewport);
    await ops.goto(`/admin/review/${reqId}`);
    await ex(ops.getByText("الاعتماد النهائي لمدير النظام الأعلى وحده.")).toBeVisible();
    await ex(ops.getByRole("button", { name: "اعتمد وأتح للعميل" })).toHaveCount(0);
    // the legacy approval route refuses engine requests too
    const [o] = await sql<{ id: string }>("select id from outputs where request_id = $1", [reqId]);
    await ops.goto(`/admin/requests/${reqId}/outputs/${o.id}`);
    await ex(ops.getByRole("button", { name: /^اعتمد/ })).toHaveCount(0);
    // the database trigger: approving an engine output needs outputs.final_approve
    const opsId = demo().users.ops.id;
    const err = await withClient((process.env.SYSTEM_DATABASE_URL ?? envLine("DATABASE_URL")), async (c) => {
      await c.query("begin");
      try {
        await c.query("select set_config('app.user_id', $1, true), set_config('app.global_access', 'on', true)", [opsId]);
        await c.query("update outputs set status = 'approved', approved_by = $2, approved_at = now() where id = $1", [o.id, opsId]);
        return null;
      } catch (e) { return (e as Error).message; } finally { await c.query("rollback"); }
    });
    expect(err).toBeTruthy();
    expect((await reqRow(reqId)).status).toBe("quality_review");
  });

  test("final approval by the super admin releases the approved document to the client; correction requests are separate", async ({ browser, viewport }) => {
    const admin = await as(browser, "admin", viewport);
    await admin.goto(`/admin/review/${reqId}`);
    await admin.getByRole("button", { name: "اعتمد وأتح للعميل" }).click();
    await ex(admin.getByText("أكّد أنك راجعت المخرج كاملًا قبل اعتماده.")).toBeVisible(); // refused without the confirmation
    expect((await reqRow(reqId)).status).toBe("quality_review");
    await admin.getByLabel(/راجعت المخرج كاملًا/).check();
    await admin.getByRole("button", { name: "اعتمد وأتح للعميل" }).click();
    await untilStatus(reqId, "completed");
    const [d] = await sql<{ status: string; document_id: string }>("select status, document_id from deliverables where request_id = $1", [reqId]);
    expect(d.status).toBe("approved");
    const audits = await sql<{ action: string }>("select action from audit_logs where entity_id = $1", [reqId]);
    expect(audits.map((a) => a.action)).toEqual(expect.arrayContaining(["engine.ready", "outputs.final_approved"]));

    const naz = await as(browser, "nazir", viewport);
    await naz.goto(`/app/requests/${reqId}?t=${Date.now()}`);
    await ex(naz.getByTestId("client-phase")).toContainText("معتمد");
    await ex(naz.getByTestId("deliverable")).toContainText("معتمد");
    expect((await naz.request.get(`/api/files/${d.document_id}?disposition=inline`)).status()).toBe(200);
    await naz.getByTestId("correction-form").getByLabel(/ما الذي يحتاج إلى تصحيح/).fill("اسم الوقف في الصفحة الأولى يحتاج تصحيحًا.");
    await naz.getByRole("button", { name: "أرسل طلب التصحيح" }).click();
    await ex(naz.getByText(/وصل طلب التصحيح إلى مدير النظام/)).toBeVisible();
    expect((await reqRow(reqId)).status).toBe("completed"); // the approved document is not reopened
    const [t] = await sql<{ n: number }>("select count(*)::int n from tasks where request_id = $1 and kind = 'correction_request'", [reqId]);
    expect(t.n).toBe(1);
  });

  test("9 · the processing record and the audit log trace every step", async () => {
    const steps = await sql<{ step: string; status: string }>(
      "select s.step, s.status from processing_steps s join processing_runs r on r.id = s.run_id where r.request_id = $1 and r.status = 'ready' order by s.seq", [reqId]);
    expect(steps.map((s) => s.step)).toEqual(["intake", "documents", "rules", "workflow", "document", "verify", "handoff"]);
    const [job] = await sql<{ status: string; attempts: number }>("select status, attempts from processing_jobs where request_id = $1 order by created_at limit 1", [reqId]);
    expect(job).toMatchObject({ status: "succeeded", attempts: 1 });
    // the client's approval is not a closing step of an engine request (owner's decision 3)
    const [st] = await sql<{ status: string }>("select status from request_stages where request_id = $1 and stage_key = 'client_review'", [reqId]);
    if (st) expect(st.status).toBe("skipped");
  });

  test("10 · no sensitive data in job errors, the processing record, notifications or logs", async () => {
    const hits = await sql<{ n: number }>(`select
      (select count(*) from processing_steps where summary::text like '%' || $2 || '%' and request_id = $1::uuid)
    + (select count(*) from processing_runs where (outcome::text || coalesce(error, '')) like '%' || $2 || '%' and request_id = $1)
    + (select count(*) from processing_jobs where coalesce(last_error, '') like '%' || $2 || '%' and request_id = $1)
    + (select count(*) from notifications where (title_ar || ' ' || coalesce(body_ar, '')) like '%' || $2 || '%')
    + (select count(*) from audit_logs where coalesce(after::text, '') like '%' || $2 || '%' and entity_id = $1::text) as n`, [reqId, "0551234567"]);
    expect(Number(hits[0].n)).toBe(0);
    for (const log of ["/tmp/worker.log", "/tmp/waqfak-prod.log"]) if (existsSync(log)) expect(readFileSync(log, "utf8")).not.toContain("0551234567");
  });

  test("5/11 · real data never reaches the model: a request without a demonstration waqf is blocked with its reasons", async ({ browser, viewport }) => {
    const page = await as(browser, "nazir", viewport);
    const id = await openC01(page, null);
    await page.getByRole("button", { name: "طلب النتيجة" }).click();
    await page.waitForURL(/\?created=1/);
    await until(async () => (await lastRun(id))?.status === "blocked" && true, "blocked run");
    const run = await lastRun(id);
    expect(run.model).toBeNull(); // no model call at all
    expect(JSON.stringify(run.outcome.blockers)).toContain("البيانات الحقيقية");
    expect((await reqRow(id)).status).not.toBe("quality_review");
    expect(await sql("select id from deliverables where request_id = $1", [id])).toHaveLength(0);
    // the administrator is told (never silent), the client is not shown a result
    const notes = await sql("select id from notifications where link = $1", [`/admin/review/${id}`]);
    expect(notes.length).toBeGreaterThan(0);
    await page.goto(`/app/requests/${id}?t=${Date.now()}`);
    await ex(page.getByTestId("client-phase")).toContainText("قيد المعالجة");
    const admin = await as(browser, "admin", viewport);
    await admin.goto(`/admin/review/${id}`);
    await ex(admin.getByTestId("review-blocked")).toContainText("البيانات الحقيقية");
  });

  test("2 · missing data: the client is asked by field, answers, and processing resumes to the review", async ({ browser, viewport }) => {
    // a submitted request whose data no longer satisfies the form (as when a required answer is withdrawn on correction)
    const page = await as(browser, "nazir", viewport);
    const id = await openC01(page, demo().waqfs.A);
    await page.getByRole("button", { name: "طلب النتيجة" }).click();
    await page.waitForURL(/\?created=1/);
    await untilStatus(id, "quality_review");
    // reset the request to before processing with the applicant's capacity missing, then process it again
    await sql(`update service_requests set status = 'submitted', intake = jsonb_set(intake, '{answers}', (intake->'answers') - 'capacity') where id = $1`, [id]);
    await sql("update outputs set status = 'returned' where request_id = $1", [id]);
    await sql("insert into processing_jobs (request_id, waqf_id, reason, kind) select id, waqf_id, 'اختبار: إعادة المعالجة', 'process' from service_requests where id = $1", [id]);
    await untilStatus(id, "awaiting_client");
    const [item] = await sql<{ id: string; title: string; field_key: string; kind: string }>("select id, title, field_key, kind from request_items where request_id = $1 and status = 'open'", [id]);
    expect(item).toMatchObject({ kind: "data", field_key: "capacity" });
    await page.goto(`/app/requests/${id}?t=${Date.now()}`);
    await ex(page.getByTestId("client-phase")).toContainText("مطلوب منك استكمال");
    const li = page.locator("li", { hasText: item.title }).first();
    await li.getByLabel(/ردك/).fill("ناظر الوقف");
    await li.getByRole("button", { name: /أرسل الرد/ }).click();
    await untilStatus(id, "quality_review");
    const [r] = await sql<{ cap: string }>("select intake->'answers'->>'capacity' cap from service_requests where id = $1", [id]);
    expect(r.cap).toBe("nazir");
  });

  test("8 · concurrent and duplicate submission create one request and one job; retries back off; failures end visibly", async ({ browser, viewport }) => {
    const page = await as(browser, "nazir", viewport);
    const id = await openC01(page, demo().waqfs.A);
    const second = await page.context().newPage();
    await second.goto(page.url());
    await second.getByRole("button", { name: /المراجعة والإرسال/ }).first().click();
    await second.getByLabel(/أقر بأن البيانات والمستندات/).check();
    await Promise.all([
      page.getByRole("button", { name: "طلب النتيجة" }).click(),
      second.getByRole("button", { name: "طلب النتيجة" }).click(),
    ]);
    await page.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?/);
    await second.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\?/);
    // one of the two submissions created the request, the other was told it was already sent
    expect([page.url(), second.url()].filter((u) => u.includes("created=1"))).toHaveLength(1);
    expect([page.url(), second.url()].filter((u) => u.includes("already=1"))).toHaveLength(1);
    const jobs = await sql<{ n: number }>("select count(*)::int n from processing_jobs where request_id = $1", [id]);
    expect(jobs[0].n).toBe(1);
    const [{ n: events }] = await sql<{ n: number }>("select count(*)::int n from request_events where request_id = $1 and to_status = 'submitted'", [id]);
    expect(events).toBe(1);
    // re-submitting the same request is answered with «already submitted», nothing new is created
    await second.goto(`/app/requests/${id}/intake`);
    await second.waitForURL(new RegExp(`/app/requests/${id}(\\?|$)`)); // a submitted request has no form any more
    await ex(second.getByRole("button", { name: "طلب النتيجة" })).toHaveCount(0);
    await second.close();
    await untilStatus(id, "quality_review");
    // one active job per request, enforced by the database
    await sql("insert into processing_jobs (request_id, waqf_id, reason) values ($1, null, 'a')", [id]);
    const dup = await sql("insert into processing_jobs (request_id, waqf_id, reason) values ($1, null, 'b')", [id]).then(() => null, (e: Error) => e.message);
    expect(dup).toMatch(/pj_one_active_uq|duplicate/);
    await until(async () => (await sql<{ n: number }>("select count(*)::int n from processing_jobs where request_id = $1 and status in ('queued','running')", [id]))[0].n === 0 && true, "job drained");
    // a failing job: retried with a delay, error kept without personal data, given up after its attempts, reported
    const ghost = randomUUID();
    const [job] = await sql<{ id: string }>("insert into processing_jobs (request_id, waqf_id, reason) values ($1, null, 'اختبار فشل 0551234567') returning id", [ghost]);
    for (let a = 1; a <= 3; a++) {
      const j = await until(async () => {
        const [x] = await sql<{ status: string; attempts: number; last_error: string | null; run_after: Date }>("select status, attempts, last_error, run_after from processing_jobs where id = $1", [job.id]);
        return x.attempts === a && x.status !== "running" ? x : null;
      }, `attempt ${a}`);
      expect(j.last_error ?? "").not.toMatch(/\d{6,}/);
      if (a < 3) {
        expect(j.status).toBe("queued");
        expect(new Date(j.run_after).getTime()).toBeGreaterThan(Date.now() + 10_000); // backed off, not hammered
        await sql("update processing_jobs set run_after = now() where id = $1", [job.id]); // fast-forward the clock
      } else expect(j.status).toBe("dead");
    }
    const dead = await sql("select id from audit_logs where action = 'engine.job_dead' and entity_id = $1", [ghost]);
    expect(dead).toHaveLength(1);
    // a job left «running» by a crashed worker is taken over
    const [stale] = await sql<{ id: string }>("insert into processing_jobs (request_id, waqf_id, reason, status, attempts, locked_at, locked_by) values ($1, null, 'stale', 'running', 1, now() - interval '11 minutes', 'crashed') returning id", [id]);
    await until(async () => (await sql<{ status: string }>("select status from processing_jobs where id = $1", [stale.id]))[0].status === "succeeded" && true, "stale job retaken");
  });
});
