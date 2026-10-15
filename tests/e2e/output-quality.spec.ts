import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { demo, loginAs } from "./helpers";

/**
 * Output quality order — W01 (case of OUT-000004: the client answered «no waqf after death» while the bequests table
 * holds «waqf 10% of the estate after death»). Synthetic data only; nothing is sent outside the platform.
 *
 *  1 consistent complete request          → final state: no conflict, findings recorded, approved
 *  2 answer vs table conflict              → shown with both values and sources, clause not written, register row
 *  3 mandatory gap                         → waqf terms missing after «yes»: submission blocked, reason shown
 *  4 optional gap only                     → waqf name missing: listed, blocks nothing
 *  5 witness names without proof           → attestation check «needs a specialist», never a tick
 *  6 regenerate after a data change        → changed / unchanged / conflicts resolved, in the message and the version note
 *  7 regenerate with a manual edit         → the human clause is kept
 *  8 new version and compare               → word-level highlights
 *  9 submit while incomplete               → button disabled with its reasons
 * 10 approve with an open conflict         → refused on the server (stale page), audited
 * 11 API bypass                            → a form posted natively (no UI) is refused; the DB guard refuses a raw update
 * 12 unauthorized approval                 → the preparer without review rights is refused on the server
 * 13 PDF preview                           → no status, version or task change
 * 14 Arabic / print                        → the PDF text is Arabic and carries the gap report on a draft
 * 15 no client leak                        → the approved PDF has no checks, gap report or witness IDs
 * Desktop only (shared demo records).
 */

const shots = "/tmp/claude-0/shots";
const outDir = "/tmp/claude-0/output-quality";
const ex = expect.configure({ timeout: 25_000 });
mkdirSync(shots, { recursive: true });
mkdirSync(outDir, { recursive: true });

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
  const file = `/tmp/claude-0/e2e-oq-${key}-${demo().users[key].id}.json`;
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
const reqStatus = async (id: string) => (await sql<{ status: string }>("select status from service_requests where id = $1", [id]))[0].status;
const out = async (id: string) => (await sql<{ status: string; current_version: number }>("select status, current_version from outputs where id = $1", [id]))[0];
const yesNo = (p: Page, label: RegExp, v: "نعم" | "لا") => p.getByRole("group", { name: label }).getByRole("radio", { name: v }).check();

async function nextStep(page: Page, reqId: string, label: RegExp) {
  await go(page, `/admin/requests/${reqId}`);
  const btn = page.getByTestId("next-step");
  await ex(btn).toContainText(label);
  await btn.click();
  const msg = page.getByTestId("execution-panel").locator('[role="status"], [role="alert"]').first();
  await ex(msg).toBeVisible();
  expect(await msg.getAttribute("role"), await msg.innerText()).toBe("status");
}

/** The team corrects one answer from the request page (reason kept with the previous value); returns the message. */
async function correct(page: Page, reqId: string, field: string, fill: (ed: ReturnType<Page["getByTestId"]>) => Promise<void>, reason: string) {
  await go(page, `/admin/requests/${reqId}#intake`);
  await page.getByText("صحّح بيانات العميل أو أكملها").click();
  const ed = page.getByTestId("staff-intake-editor");
  await ed.locator("#edit-field").selectOption(field);
  await fill(ed);
  await ed.locator("#edit-reason").fill(reason);
  await ed.getByRole("button", { name: "احفظ التصحيح" }).click();
  const msg = ed.locator('[role="status"], [role="alert"]').first();
  await ex(msg).toBeVisible();
  return msg.innerText();
}

/** The waqf terms as the client gave them (re-entered after the answer «yes» is restored). */
async function fillTerms(page: Page, reqId: string) {
  await correct(page, reqId, "waqfNazir", (ed) => ed.locator("#q-waqfNazir").fill("ناظر تجريبي"), "قدّم العميل اسم الناظر في رده على البند (اختبار آلي).");
  await correct(page, reqId, "waqfSuccession", (ed) => ed.getByRole("radio", { name: "الأصلح فالأصلح من الموقوف عليهم" }).check(), "قدّم العميل طريقة الاستخلاف في رده (اختبار آلي).");
  await correct(page, reqId, "waqfMasarif", async (ed) => {
    await ed.getByRole("button", { name: /أضف صفًا/ }).click();
    await ed.locator("#q-waqfMasarif-0-beneficiary").fill("الفقراء والمساكين");
    await ed.locator("#q-waqfMasarif-0-share").fill("100");
  }, "قدّم العميل مصارف الوقف في رده (اختبار آلي).");
}

/** The server-rendered HTML of a form (as a script without the UI would post it). */
async function ssrForm(page: Page, url: string, button: string) {
  const html = await (await page.request.get(url)).text();
  return (html.match(/<form[\s\S]*?<\/form>/g) ?? []).find((f) => f.includes(button)) ?? null;
}
/** Posts a captured form natively (no client-side code, no disabled button): the server alone decides. */
async function nativePost(page: Page, formHtml: string, fill: Record<string, string> = {}) {
  await Promise.all([
    page.waitForLoadState("load"),
    page.evaluate(({ h, fill }) => {
      const d = document.createElement("div");
      d.innerHTML = h;
      document.body.appendChild(d);
      const f = d.querySelector("form")!;
      for (const [k, v] of Object.entries(fill)) f.querySelector<HTMLInputElement | HTMLTextAreaElement>(`[name="${k}"]`)?.setAttribute("value", v);
      for (const [k, v] of Object.entries(fill)) { const t = f.querySelector<HTMLTextAreaElement>(`textarea[name="${k}"]`); if (t) t.textContent = v; }
      HTMLFormElement.prototype.submit.call(f);
    }, { h: formHtml, fill }),
  ]);
  await page.waitForTimeout(1500);
}
/** PDF text for comparison: pdftotext splits Arabic words at kerning points and marks direction, so spaces,
 *  diacritics and direction marks are dropped on both sides before comparing. */
const flat = (s: string) => s.replace(/[\u200e\u200f\u202a-\u202e\u2066-\u2069\u064b-\u0652\s]/g, "");
const pdfText = (buf: Buffer, name: string) => {
  const f = `${outDir}/${name}.pdf`;
  writeFileSync(f, buf);
  return flat(execFileSync("pdftotext", ["-layout", f, "-"]).toString());
};

test.describe.serial("output quality: conflicts, checks, deficiency list, stages, versions (W01)", () => {
  test.setTimeout(420_000);
  const U = () => demo().users;
  const W = () => demo().waqfs;
  let reqId = "";
  let outputId = "";

  test.beforeAll(async () => {
    await sql("update service_requests set status = 'cancelled' where requester_user_id = $1 and status = 'draft'", [U().waqif.id]);
  });
  test.afterAll(async () => {
    // emp1 was assigned for this test only: hand the request back so the assignment grants no lasting waqf access
    if (reqId) await sql("update service_requests set assigned_to_user_id = $2 where id = $1", [reqId, U().ops.id]);
    for (const p of pages.values()) await p.context().close();
    pages.clear();
  });

  test("W01 from the conflicting answers to an approved, corrected will", async ({ browser }, info) => {
    test.skip(info.project.name === "mobile", "shared state; desktop only");

    // ── the client's answers reproduce OUT-000004: «no waqf» + a waqf row of 10% ──
    const client = await as(browser, "waqif");
    await client.goto(`/app/requests/new?service=W01&waqf=${W().B}`);
    await client.getByRole("button", { name: "ابدأ نموذج الطلب" }).click();
    await client.waitForURL(/\/app\/requests\/[0-9a-f-]{36}\/intake$/);
    reqId = client.url().match(/requests\/([0-9a-f-]{36})/)![1];
    await client.getByRole("radio", { name: "الواقف أو من يريد إنشاء الوقف" }).check();
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("رقم هوية الموصي").fill("1000000001");
    await client.getByRole("button", { name: "التالي" }).click();
    await yesNo(client, /هل لك وصية سابقة/, "لا");
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByRole("button", { name: /أضف صفًا/ }).first().click();
    await client.locator("#q-bequests-0-kind").selectOption("waqf");
    await client.locator("#q-bequests-0-recipient").fill("الفقراء والمساكين (اختبار آلي)");
    await client.locator("#q-bequests-0-relation").selectOption("entity");
    await client.locator("#q-bequests-0-basis").selectOption("share");
    await client.locator("#q-bequests-0-percent").fill("10");
    await client.getByRole("button", { name: "التالي" }).click();
    await yesNo(client, /هل في وصاياك وقف بعد الوفاة/, "لا");
    await client.getByRole("button", { name: "التالي" }).click();
    await client.getByLabel("الوصي (منفذ الوصية)").fill("منفذ تجريبي");
    await client.getByLabel("صفة الوصي").selectOption("heir");
    await client.getByRole("radio", { name: /بالإشهاد عليها الآن/ }).check();
    await client.getByTestId("table-witnesses").getByRole("button", { name: /أضف صفًا/ }).click();
    await client.locator("#q-witnesses-0-name").fill("شاهد تجريبي أول");
    await client.locator("#q-witnesses-0-id").fill("1000000002");
    await client.getByTestId("table-witnesses").getByRole("button", { name: /أضف صفًا/ }).click();
    await client.locator("#q-witnesses-1-name").fill("شاهد تجريبي ثان");
    await client.locator("#q-witnesses-1-id").fill("1000000003");
    const confirm = client.getByLabel(/أقر بأن البيانات والمستندات/);
    for (let i = 0; i < 20 && !(await confirm.isVisible()); i++) {
      const nb = client.getByRole("button", { name: "التالي" });
      if ((await nb.count()) && (await nb.isEnabled())) await nb.click();
      await client.waitForTimeout(400);
    }
    await confirm.check();
    await client.getByRole("button", { name: "أرسل الطلب" }).click();
    await client.waitForURL(/\?created=1/, { timeout: 30_000 });

    // intake → work started; the request is assigned to emp1 (test setup), who prepares the will
    const admin = await as(browser, "admin");
    await nextStep(admin, reqId, /ابدأ الفرز/);
    await nextStep(admin, reqId, /سجّل التحقق من البيانات والمستندات/);
    await nextStep(admin, reqId, /اقبل الطلب للخدمة/);
    await go(admin, `/admin/requests/${reqId}`);
    await admin.getByRole("button", { name: "بدء التنفيذ", exact: true }).click();
    await ex.poll(() => reqStatus(reqId)).toBe("in_progress");
    await sql("update service_requests set assigned_to_user_id = $2 where id = $1", [reqId, U().emp1.id]);
    const emp = await as(browser, "emp1");
    await nextStep(emp, reqId, /أنشئ مسودة «نص الوصية»/);
    [{ id: outputId }] = await sql<{ id: string }>("select id from outputs where request_id = $1", [reqId]);
    const page = `/admin/requests/${reqId}/outputs/${outputId}`;

    // ── 2 · the conflict: both values with their source; the clause is not written either way ──
    await go(emp, page);
    const conflict = emp.getByTestId("conflict-will:waqf_answer_vs_bequests");
    await ex(conflict).toContainText("«لا»");
    await ex(conflict).toContainText("وقف بعد الوفاة بنسبة 10٪ من التركة");
    await ex(conflict).toContainText("إجابة العميل في نموذج الطلب");
    await ex(conflict).toContainText("لا تُختار قيمة نيابة عنه");
    const clause = emp.getByTestId("clause-bequest:1");
    await ex(clause).toContainText("[تعارض يُحسم:");
    await ex(clause).not.toContainText("وقفًا بعد وفاتي");
    await ex(emp.getByTestId("output-stage")).toHaveAttribute("data-stage", "generated");
    await ex(emp.getByTestId("check-waqf_consistency")).toHaveAttribute("data-status", "failed");
    await ex(emp.getByTestId("req-waqf_consistency")).toHaveAttribute("data-status", "conflict");
    const [reg] = await sql<{ status: string; detected_by: string; sides: unknown }>("select status, detected_by, sides from data_conflicts where request_id = $1 and conflict_key = 'will:waqf_answer_vs_bequests'", [reqId]);
    expect(reg.status).toBe("open");
    expect(reg.detected_by).toBe(U().emp1.id);
    // ── 5 · witness names are not proof of attestation ──
    await ex(emp.getByTestId("check-attestation")).toHaveAttribute("data-status", "specialist");
    await ex(emp.getByTestId("check-attestation")).toContainText("إدخال الاسم لا يثبت حصول الإشهاد");
    await ex(emp.getByTestId("check-third_legal")).toHaveAttribute("data-status", "specialist");
    // ── 9 · submission disabled, with its reasons ──
    await ex(emp.getByTestId("submit-blocked")).toContainText("تعارض قائم");
    await ex(emp.getByRole("button", { name: "أرسلها للمراجعة والاعتماد" })).toBeDisabled();
    await ex(emp.getByTestId("output-summary")).toContainText("تعارض في البيانات");
    await emp.screenshot({ path: `${shots}/oq-1-conflict-desktop.png`, fullPage: true });

    // ── 13/14 · the PDF preview changes nothing; its text is Arabic and carries the gap report ──
    const before = await out(outputId);
    const tasksBefore = await sql<{ s: string }>("select string_agg(kind || ':' || status, ',' order by kind) s from tasks where request_id = $1", [reqId]);
    const pdf1 = await emp.request.get(`${page}/pdf?v=1`);
    expect(pdf1.status()).toBe(200);
    expect(pdf1.headers()["content-type"]).toContain("application/pdf");
    const t1 = pdfText(await pdf1.body(), "w01-v1-conflict");
    expect(t1).toContain(flat("تعارض في الوقف بعد الوفاة"));
    expect(t1).toContain(flat("تقرير النواقص والتعارضات"));
    expect(t1).toContain(flat("فحوص الصياغة (داخلية)"));
    expect(await out(outputId)).toEqual(before);
    expect(await reqStatus(reqId)).toBe("in_progress");
    expect(await sql("select string_agg(kind || ':' || status, ',' order by kind) s from tasks where request_id = $1", [reqId])).toEqual(tasksBefore);

    // the client is asked which value is meant (a required data item); the conflict stays open until corrected
    await emp.getByTestId("conflict-will:waqf_answer_vs_bequests").getByRole("button", { name: "اطلب من العميل تحديد القيمة المقصودة" }).click();
    await ex(emp.getByTestId("conflict-will:waqf_answer_vs_bequests")).toContainText("طُلب من العميل تصحيحه في سجل النواقص");
    const [item] = await sql<{ kind: string; required: boolean; field_key: string }>("select i.kind, i.required, i.field_key from request_items i join data_conflicts c on c.item_id = i.id where c.request_id = $1", [reqId]);
    expect(item).toMatchObject({ kind: "data", required: true, field_key: "includesWaqf" });

    // ── correction at the source: the client confirmed the waqf is intended ──
    const m1 = await correct(emp, reqId, "includesWaqf", (ed) => ed.getByRole("radio", { name: "نعم" }).check(), "أكد العميل أن الوقف بعد الوفاة مقصود (اختبار آلي).");
    expect(m1).toContain("زال 1 تعارض");
    const [res] = await sql<{ status: string; resolved_by: string; resolution: string }>("select status, resolved_by, resolution from data_conflicts where request_id = $1 and conflict_key = 'will:waqf_answer_vs_bequests' order by detected_at limit 1", [reqId]);
    expect(res).toMatchObject({ status: "resolved", resolved_by: U().emp1.id });
    expect(res.resolution).toContain("تصحيح «هل في وصاياك وقف بعد الوفاة؟»");
    const [rev] = await sql<{ before: Record<string, string>; after: Record<string, string>; reason: string }>("select before, after, reason from request_revisions where request_id = $1 and target = 'includesWaqf' order by at desc limit 1", [reqId]);
    expect(rev).toMatchObject({ before: { includesWaqf: "no" }, after: { includesWaqf: "yes" } });

    // ── 6 · regeneration says what changed; 3 · the waqf terms are now a mandatory gap ──
    await go(emp, page);
    await ex(emp.getByTestId("output-summary")).toContainText("تغيّرت بيانات الطلب بعد هذه النسخة");
    await ex(emp.getByTestId("conflicts-none")).toBeVisible();
    await emp.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(emp.getByText(/أُعيد توليد المسودة \(نسخة 2\): تغيّر \d+، وبقي \d+ دون تغيير.*تعارضات زالت/)).toBeVisible();
    await go(emp, page);
    await ex(emp.getByTestId("req-waqf_terms")).toHaveAttribute("data-status", "missing");
    await ex(emp.getByTestId("submit-blocked")).toContainText("مصارف الوقف بعد الوفاة غير محددة");
    await ex(emp.getByTestId("output-stage")).toHaveAttribute("data-stage", "completing");

    // the missing terms are completed at the source (as the client gave them)
    await fillTerms(emp, reqId);
    await go(emp, page);
    await emp.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(emp.getByText(/أُعيد توليد المسودة \(نسخة 3\)/)).toBeVisible();
    await go(emp, page);
    await ex(emp.getByTestId("clause-bequest:1")).toContainText("أوصي بنسبة 10٪ من تركتي وقفًا بعد وفاتي على الفقراء والمساكين (اختبار آلي).");
    // ── 4 · an optional gap alone blocks nothing (what remains is the specialist's own note) ──
    await ex(emp.getByTestId("req-waqf_name")).toHaveAttribute("data-status", "missing");
    await ex(emp.getByTestId("req-waqf_name")).toContainText("لا يمنع");
    await ex(emp.getByTestId("submit-blocked")).toContainText("لم يُكتب");
    await ex(emp.getByTestId("submit-blocked")).not.toContainText("اسم الوقف");
    await ex(emp.getByTestId("submit-blocked")).not.toContainText("تعارض");
    // ── 8 · compare versions with word highlights ──
    await go(emp, `${page}?a=1&b=3`);
    await ex(emp.getByTestId("word-diff").locator("ins").filter({ hasText: "وقفًا" }).first()).toBeVisible();
    await ex(emp.getByTestId("word-diff").locator("del").filter({ hasText: "تعارض" }).first()).toBeVisible();
    await emp.screenshot({ path: `${shots}/oq-2-diff-desktop.png`, fullPage: true });

    // the specialist's note and a manual clause edit (kept by any later regeneration)
    await go(emp, page);
    for (const t of await emp.locator('textarea[name^="spec:"]').all()) await t.fill("روجعت البنود على البيانات بعد حسم التعارض: الوقف بعد الوفاة 10٪ من التركة (اختبار آلي).");
    await emp.locator('textarea[name="clause:will_clauses:executor"]').fill("أُسند تنفيذ هذه الوصية إلى منفذ تجريبي، وهو من ورثتي، ويعاونه من يختاره. (تعديل بشري)");
    await emp.getByRole("button", { name: "احفظ نسخة جديدة" }).click();
    await ex(emp.getByTestId("output-versions").locator("li")).toHaveCount(4);
    const [v4] = await sql<{ note: string }>("select note from output_versions where output_id = $1 and version = 4", [outputId]);
    expect(v4.note).toContain("تعديل يدوي"); // a version always says why it exists
    await go(emp, page);
    await ex(emp.getByTestId("submit-blocked")).toHaveCount(0);
    await ex(emp.getByTestId("output-stage")).toHaveAttribute("data-stage", "ready");

    // capture the submit form while it is offered (a script could post it later, whatever the screen shows)
    const submitForm = await ssrForm(emp, page, "أرسلها للمراجعة والاعتماد");
    expect(submitForm).toBeTruthy();

    // ── the wrong value is entered again: the conflict comes back as a new record ──
    const m2 = await correct(emp, reqId, "includesWaqf", (ed) => ed.getByRole("radio", { name: "لا" }).check(), "إدخال خاطئ مقصود لاختبار عودة التعارض (اختبار آلي).");
    expect(m2).toContain("ظهر 1 تعارض جديد");
    expect(m2).toContain("أُسقطت 3 من الإجابات المرتبطة"); // dependants cleared by the form rules, kept in the revision
    const [rv2] = await sql<{ before: Record<string, unknown> }>("select before from request_revisions where request_id = $1 and target = 'includesWaqf' order by at desc limit 1", [reqId]);
    expect(rv2.before).toMatchObject({ includesWaqf: "yes", waqfNazir: "ناظر تجريبي" });
    expect((await sql("select 1 from data_conflicts where request_id = $1 and conflict_key = 'will:waqf_answer_vs_bequests' and status = 'open'", [reqId])).length).toBe(1);
    expect((await sql("select 1 from data_conflicts where request_id = $1 and conflict_key = 'will:waqf_answer_vs_bequests'", [reqId])).length).toBe(2);
    await go(emp, page);
    await ex(emp.getByTestId("conflict-will:waqf_answer_vs_bequests")).toBeVisible();
    await ex(emp.getByTestId("submit-blocked")).toContainText("تعارض قائم");
    // ── 11 · the captured form posted natively is refused on the server, and audited ──
    await nativePost(emp, submitForm!);
    expect((await out(outputId)).status).toBe("draft");
    const [blocked] = await sql<{ after: { reasons: string[] } }>("select after from audit_logs where action = 'outputs.submit_blocked' and entity_id = $1 order by id desc limit 1", [outputId]);
    expect(blocked.after.reasons.join(" ")).toContain("تعارض قائم");
    // … and the database refuses a raw status change while a material conflict is open
    await expect(sql("update outputs set status = 'in_review' where id = $1", [outputId])).rejects.toThrow(/output_guard/);
    expect((await out(outputId)).status).toBe("draft");

    // corrected again
    await correct(emp, reqId, "includesWaqf", (ed) => ed.getByRole("radio", { name: "نعم" }).check(), "أعيدت القيمة التي أكدها العميل (اختبار آلي).");
    await fillTerms(emp, reqId);

    // ── 7 · regeneration over a manual edit asks for confirmation and keeps the human text ──
    await go(emp, page);
    await emp.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(emp.getByText(/النسخة الحالية فيها تعديلات بشرية/)).toBeVisible();
    await emp.getByLabel(/أؤكد إعادة التوليد/).check();
    await emp.getByRole("button", { name: "أعد التوليد من البيانات الحالية" }).click();
    await ex(emp.getByText(/أُعيد توليد المسودة \(نسخة 5\)/)).toBeVisible();
    const [v5] = await sql<{ sections: unknown; note: string }>("select sections, note from output_versions where output_id = $1 and version = 5", [outputId]);
    expect(JSON.stringify(v5.sections)).toContain("(تعديل بشري)");
    expect(v5.note).toMatch(/أُبقي على \d+ من التعديلات البشرية/);

    // submit
    await go(emp, page);
    await emp.getByRole("button", { name: "أرسلها للمراجعة والاعتماد" }).click();
    await ex.poll(async () => (await out(outputId)).status).toBe("in_review");

    // ── review: approval waits for the specialist's findings ──
    const ops = await as(browser, "ops");
    await go(ops, page);
    await ex(ops.getByTestId("approve-blocked")).toContainText("بانتظار رأي المختص");
    await ex(ops.getByTestId("output-stage")).toHaveAttribute("data-stage", "in_review");
    for (const [key, note] of [["attestation", "اطلعت على نسخة الوصية موقعة من الشاهدين (اختبار آلي)."], ["third_legal", "الوصية بالوقف 10٪ من التركة دون الثلث، ولا وصية لوارث (اختبار آلي)."]] as const) {
      const c = ops.getByTestId(`check-${key}`);
      await c.getByText("سجّل رأي المختص").click();
      await c.locator('select[name="status"]').selectOption("verified");
      await c.locator('textarea[name="note"]').fill(note);
      await c.getByRole("button", { name: "سجّل الرأي" }).click();
      await ex(ops.getByText("سُجّل رأي المختص في الفحص.")).toBeVisible();
      await go(ops, page);
    }
    await ex(ops.getByTestId("finding-attestation")).toContainText("تحقق منه المختص");
    // a clause's source is reviewed and recorded
    const ref = ops.getByTestId("ref-bequest:1-q16");
    await ex(ref).toContainText("س16 (ص10)");
    await ref.getByText("سجّل مراجعة المرجع").click();
    await ref.locator('select[name="status"]').selectOption("supports");
    await ref.locator('textarea[name="note"]').fill("الوقف المعلق على الموت يأخذ حكم الوصية؛ البند لا يتجاوز الثلث (اختبار آلي).");
    await ref.getByRole("button", { name: "سجّل" }).click();
    await go(ops, page);
    await ex(ops.getByTestId("refreview-bequest:1-q16")).toContainText("يؤيد الصياغة");
    const approveForm = await ssrForm(ops, page, "اعتمد المخرج");
    expect(approveForm).toBeTruthy();

    // ── 12 · the preparer without review rights is refused on the server ──
    await go(emp, page);
    await ex(emp.getByRole("button", { name: "اعتمد المخرج" })).toHaveCount(0);
    await ex(emp.getByTestId("check-attestation").getByText("سجّل رأي المختص")).toHaveCount(0);
    await nativePost(emp, approveForm!, { signedBy: "مستشار تجريبي — مستشار شرعي" });
    expect((await out(outputId)).status).toBe("in_review");
    expect((await sql("select 1 from audit_logs where action = 'outputs.approve' and entity_id = $1", [outputId])).length).toBe(0);

    // ── 10 · approval with an open conflict (the data changed after the reviewer opened the page) ──
    await correct(emp, reqId, "includesWaqf", (ed) => ed.getByRole("radio", { name: "لا" }).check(), "تغيير أثناء المراجعة لاختبار منع الاعتماد (اختبار آلي).");
    await go(ops, page);
    await nativePost(ops, approveForm!, { signedBy: "مستشار تجريبي — مستشار شرعي" });
    expect((await out(outputId)).status).toBe("in_review");
    const [ab] = await sql<{ after: { reasons: string[] } }>("select after from audit_logs where action = 'outputs.approve_blocked' and entity_id = $1 order by id desc limit 1", [outputId]);
    expect(ab.after.reasons.join(" ")).toContain("تعارض قائم");
    expect(ab.after.reasons.join(" ")).toContain("تغيّرت بيانات الطلب بعد إعداد هذه النسخة");
    await expect(sql("update outputs set status = 'approved' where id = $1", [outputId])).rejects.toThrow(/output_guard/);
    await correct(emp, reqId, "includesWaqf", (ed) => ed.getByRole("radio", { name: "نعم" }).check(), "أعيدت القيمة المؤكدة (اختبار آلي).");
    await fillTerms(emp, reqId);

    // ── 1 · consistent and complete: approved by the reviewer, with the advisor's signature ──
    await go(ops, page);
    await ops.getByLabel("التوقيع: اسم المستشار وصفته").fill("مستشار تجريبي — مستشار شرعي");
    await ops.getByRole("button", { name: "اعتمد المخرج" }).click();
    await ex(ops.getByText(/معتمد — النسخة 5/)).toBeVisible();
    await ex(ops.getByTestId("output-stage")).toHaveAttribute("data-stage", "approved");
    await ex(ops.getByTestId("official-none")).toBeVisible(); // never «documented» without a record
    await expect(sql("update outputs set current_version = 4 where id = $1", [outputId])).rejects.toThrow(/output_guard/);
    await ops.screenshot({ path: `${shots}/oq-3-approved-desktop.png`, fullPage: true });

    // ── 15 · the approved copy carries no internal material and no witness IDs ──
    const pdf5 = await ops.request.get(`${page}/pdf?v=5`);
    const t5 = pdfText(await pdf5.body(), "w01-v5-approved");
    expect(t5).toContain(flat("معتمد"));
    // (pdftotext moves Arabic marks and digits around: the words are checked one by one, the layout by the image below)
    for (const w of ["أوصي", "تركتي", "بعد", "وفاتي", "الفقراء", "ناظر تجريبي", "الأصلح فالأصلح"]) expect(t5, w).toContain(flat(w));
    // no internal material and no data beyond the document: checks, gap report, review notes, raw answers, contact data
    for (const s of ["فحوص الصياغة", "تقرير النواقص", "ملاحظات المختص", "روجعت البنود", "بيانات الطلب كما قدّمها العميل", "0555", "1000000002", "1000000003", "إقرار من العميل", "بحاجة إلى تحقق", "تعارض", "كشف حساب"]) expect(t5, s).not.toContain(flat(s));
    execFileSync("pdftoppm", ["-png", "-r", "60", "-f", "1", "-l", "1", `${outDir}/w01-v5-approved.pdf`, `${outDir}/w01-v5-approved`]);
  });
});
