import { expect, test, type Browser, type Page } from "@playwright/test";
import pg from "pg";
import { readFileSync } from "node:fs";
import { demo, loginAs, uniquePhone } from "./helpers";

/**
 * Who may change a waqf file, tested on the server actions themselves (direct POSTs with each role's session, as a
 * crafted request would arrive — not through hidden buttons). Each call is checked by its answer AND by the database:
 * an allowed call writes the condition, a refused one writes nothing. Matrix: docs/WAQF-FILE-PERMISSIONS.md.
 */
const MARK = "مصفوفة الصلاحيات (اختبار آلي)";
async function sql<T = Record<string, unknown>>(q: string, params: unknown[] = []): Promise<T[]> {
  const line = readFileSync(".env", "utf8").split("\n").find((l) => l.startsWith("DATABASE_OWNER_URL="));
  const c = new pg.Client({ connectionString: line!.slice("DATABASE_OWNER_URL=".length).trim() });
  await c.connect();
  try { return (await c.query(q, params)).rows as T[]; } finally { await c.end(); }
}
const manifest = () => JSON.parse(readFileSync(".next/server/server-reference-manifest.json", "utf8")).node as Record<string, { exportedName?: string }>;
const actionId = (name: string) => {
  const id = Object.entries(manifest()).find(([, v]) => v.exportedName === name)?.[0];
  if (!id) throw new Error(`no server action ${name}`);
  return id;
};

/** Posts a server action as the browser does (form fields, then the root that references them). */
async function call(page: Page | null, browser: Browser, name: string, path: string, fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(`_1_${k}`, v);
  fd.append("0", JSON.stringify([{}, "$K1"]));
  const req = page ? page.request : (await browser.newContext()).request;
  const r = await req.post(path, { headers: { "Next-Action": actionId(name), Accept: "text/x-component" }, multipart: fd, maxRedirects: 0 });
  const text = await r.text();
  if (r.status() >= 300 && r.status() < 400) return { kind: "redirect" as const, text: r.headers().location ?? "" };
  if (/NEXT_REDIRECT|"s":"login"|\/login/.test(text) && !/"(ok|message)"/.test(text)) return { kind: "redirect" as const, text: "login" };
  const err = text.match(/"error":"([^"$][^"]{0,200})"/)?.[1];
  return err ? { kind: "error" as const, text: err } : { kind: /"ok":true/.test(text) ? ("ok" as const) : ("none" as const), text: text.slice(0, 120) };
}

const conditionsWith = async (waqfId: string, tag: string) =>
  (await sql<{ n: number }>("select count(*)::int n from conditions where waqf_id = $1 and literal_text = $2", [waqfId, `${MARK} ${tag}`]))[0].n;

test.describe.serial("waqf file permissions on the server", () => {
  test.skip(({ isMobile }) => isMobile, "server-side matrix, run once");
  test.setTimeout(300_000);
  const pages = new Map<string, Page>();
  let founderWaqf = "";
  const as = async (browser: Browser, key: string) => {
    if (!pages.has(key)) { const p = await (await browser.newContext()).newPage(); await loginAs(p, key); pages.set(key, p); }
    return pages.get(key)!;
  };
  test.afterAll(async () => {
    // test cleanup on the test database: the conditions written by allowed calls, their reviews, the founder's waqf
    await sql("delete from conditions where literal_text like $1", [`${MARK}%`]);
    await sql("update tasks set status = 'done', completed_at = now() where kind = 'file_review' and status = 'todo' and description like '%deed.condition_added%' and waqf_id = any($1)", [[demo().waqfs.A, demo().waqfs.B, demo().waqfs.C, founderWaqf].filter(Boolean)]);
    if (founderWaqf) await sql("update waqfs set archived_at = now() where id = $1", [founderWaqf]);
  });

  const W = () => demo().waqfs;
  const cases: [who: string | null, waqf: () => string, allowed: boolean, why: string][] = [
    ["nazir", () => W().A, true, "ناظر الوقف: يدير ملفه"],
    ["admin", () => W().A, true, "مسؤول النظام الأعلى: admin.waqfs.edit"],
    ["ops", () => W().A, true, "مدير التشغيل: admin.waqfs.edit"],
    ["emp1", () => W().A, false, "موظف تشغيل غير مسند"],
    ["mlro", () => W().A, false, "مسؤول الامتثال: لا صلاحية على ملفات الأوقاف"],
    ["editor", () => W().A, false, "محرر محتوى"],
    ["chair", () => W().A, false, "رئيس مجلس وقف آخر: لا عضوية في هذا الوقف"],
    ["outsider", () => W().A, false, "عميل بلا عضوية"],
    ["beneficiary", () => W().B, false, "مستفيد: يرى استحقاقه فقط"],
    ["waqif", () => W().B, true, "واقف وناظر لوقفه"],
    ["chair", () => W().C, true, "رئيس مجلس النظارة"],
    ["member1", () => W().C, false, "عضو مجلس: يطّلع ويصوّت ولا يحرر الشروط"],
    ["secretary", () => W().C, false, "أمين السر: يدير الاجتماعات ولا يحرر الشروط"],
    [null, () => W().A, false, "زائر بلا جلسة"],
  ];

  test("deed.edit (saveCondition): allowed and refused per role, verified in the database", async ({ browser }) => {
    const results: string[] = [];
    for (const [who, waqf, allowed, why] of cases) {
      const tag = `${who ?? "anon"}`;
      const page = who ? await as(browser, who) : null;
      const r = await call(page, browser, "saveCondition", `/app/w/${waqf()}/deed`, { waqfId: waqf(), category: "asset", literalText: `${MARK} ${tag}`, position: "99" });
      const written = await conditionsWith(waqf(), tag);
      results.push(`${tag.padEnd(12)} ${allowed ? "مسموح" : "ممنوع"} → ${r.kind}: ${r.text.slice(0, 70)} | سُجّل: ${written}`);
      expect(written, `${tag}: ${why}`).toBe(allowed ? 1 : 0);
      if (!allowed) expect(["error", "redirect"]).toContain(r.kind);
    }
    console.log(results.join("\n"));
    // the nazara's own change is not put to review; staff changes to a documented file are
    const reviews = await sql<{ n: number; by: string }>("select count(*)::int n, u.email by from tasks t join users u on u.id = t.created_by where t.kind = 'file_review' and t.waqf_id = $1 and t.description like '%deed.condition_added%' and t.status = 'todo' group by u.email", [W().A]);
    expect(reviews.find((x) => x.by.startsWith("nazir"))).toBeUndefined();
    expect(reviews.find((x) => x.by.startsWith("admin"))?.n).toBeGreaterThanOrEqual(1);
  });

  test("assets.edit (saveAsset): the file editors may, other staff and clients may not", async ({ browser }) => {
    for (const [who, allowed] of [["ops", true], ["emp1", false], ["outsider", false], ["beneficiary", false]] as const) {
      const before = (await sql<{ n: number }>("select count(*)::int n from assets where waqf_id = $1", [W().A]))[0].n;
      const r = await call(await as(browser, who), browser, "saveAsset", `/app/w/${W().A}/assets`, { waqfId: W().A, category: "cash", title: `${MARK} ${who}`, marketValue: "1", details: "{}" });
      const after = (await sql<{ n: number }>("select count(*)::int n from assets where waqf_id = $1", [W().A]))[0].n;
      // allowed: the permission check passes (the record is written, or only the form's own validation answers)
      if (allowed) { expect(r.kind, r.text).not.toBe("redirect"); expect(r.text).not.toMatch(/ليست لديك صلاحية|لا تشمل صلاحياتك/); }
      if (allowed && r.kind === "ok") expect(after).toBe(before + 1);
      if (!allowed) { expect(after, who).toBe(before); expect(r.kind).toBe("error"); expect(r.text).toMatch(/ليست لديك صلاحية|لا تشمل صلاحياتك/); }
    }
    await sql("update assets set archived_at = now() where title like $1", [`${MARK}%`]);
  });

  test("the founder holds the file only while no nazir or chair holds it on the platform", async ({ browser }) => {
    const founder = await (await browser.newContext()).newPage();
    await founder.goto("/signup");
    await founder.getByLabel("الاسم الكامل").fill("واقف مصفوفة الصلاحيات (تجريبي)");
    await founder.getByLabel("رقم الجوال").fill(uniquePhone());
    await founder.getByLabel(/قرأت/).check();
    await founder.getByRole("button", { name: "أنشئ الحساب" }).click();
    await founder.waitForURL(/\/verify/, { timeout: 60_000 });
    await founder.getByLabel("رمز التحقق").fill((await founder.locator("span.tracking-\\[0\\.3em\\]").first().innerText()).trim());
    await founder.getByRole("button", { name: "تحقّق" }).click();
    await founder.waitForURL(/\/app/, { timeout: 60_000 });
    await founder.goto("/app/waqfs/new");
    const f = founder.locator("main form").first();
    await f.locator('[name="name"]').fill("وقف مصفوفة الصلاحيات (اختبار آلي)");
    await f.locator('[name="deedNo"]').fill(`46${String(Date.now()).slice(-8)}`);
    await f.locator('[name="documentedOn"]').fill("2024-03-10");
    await f.locator('[name="legalType"]').selectOption("public");
    await f.locator('[name="nazirMode"]').selectOption("individual");
    await f.locator('[name="assetBand"]').selectOption("lt5");
    await f.locator('[name="myRole"]').selectOption("founder");
    await f.getByRole("button").last().click();
    await founder.waitForURL(/\/app\/w\/[0-9a-f-]{36}/, { timeout: 60_000 });
    founderWaqf = founder.url().match(/\/app\/w\/([0-9a-f-]{36})/)![1];

    let r = await call(founder, browser, "saveCondition", `/app/w/${founderWaqf}/deed`, { waqfId: founderWaqf, category: "asset", literalText: `${MARK} founder-alone`, position: "1" });
    expect(await conditionsWith(founderWaqf, "founder-alone"), r.text).toBe(1);
    // its change to a documented file goes to review
    expect((await sql<{ n: number }>("select count(*)::int n from tasks where waqf_id = $1 and kind = 'file_review' and status = 'todo'", [founderWaqf]))[0].n).toBe(1);
    // another client is refused on it
    r = await call(await as(browser, "outsider"), browser, "saveCondition", `/app/w/${founderWaqf}/deed`, { waqfId: founderWaqf, category: "asset", literalText: `${MARK} outsider-on-founder`, position: "2" });
    expect(await conditionsWith(founderWaqf, "outsider-on-founder")).toBe(0);
    // a nazir joins the file (test setup: an active nazir membership) → the founder is read-only on the file's data
    const [m] = await sql<{ id: string }>("insert into waqf_memberships (waqf_id, user_id, role_key, status) values ($1, $2, 'nazir', 'active') returning id", [founderWaqf, demo().users.nazir.id]);
    r = await call(founder, browser, "saveCondition", `/app/w/${founderWaqf}/deed`, { waqfId: founderWaqf, category: "asset", literalText: `${MARK} founder-with-nazir`, position: "3" });
    expect(await conditionsWith(founderWaqf, "founder-with-nazir")).toBe(0);
    expect(r.kind).toBe("error");
    // the nazara ends → the founder holds the file again
    await sql("update waqf_memberships set status = 'ended', ends_at = now() where id = $1", [m.id]);
    r = await call(founder, browser, "saveCondition", `/app/w/${founderWaqf}/deed`, { waqfId: founderWaqf, category: "asset", literalText: `${MARK} founder-again`, position: "4" });
    expect(await conditionsWith(founderWaqf, "founder-again"), r.text).toBe(1);

    // reviewing: only file editors, never on their own change
    const [t] = await sql<{ id: string }>("select id from tasks where waqf_id = $1 and kind = 'file_review' and status = 'todo' order by created_at limit 1", [founderWaqf]);
    const review = (p: Page | null) => call(p, browser, "reviewFileChange", `/admin/waqfs/${founderWaqf}`, { taskId: t.id, waqfId: founderWaqf, decision: "approve", note: "" });
    const state = async () => (await sql<{ s: string }>("select status s from tasks where id = $1", [t.id]))[0].s;
    for (const who of ["emp1", "mlro", "outsider"]) { await review(await as(browser, who)); expect(await state(), who).toBe("todo"); }
    await review(founder);
    expect(await state(), "the founder").toBe("todo");
    expect(["redirect", "error"]).toContain((await review(null)).kind);
    expect(await state(), "anonymous").toBe("todo");
    await review(await as(browser, "admin"));
    expect(await state(), "admin (not the author)").toBe("done");
    // the admin's own change: refused to the admin, accepted from the operations manager
    await call(await as(browser, "admin"), browser, "saveCondition", `/app/w/${founderWaqf}/deed`, { waqfId: founderWaqf, category: "asset", literalText: `${MARK} admin-own`, position: "5" });
    const [own] = await sql<{ id: string }>("select t.id from tasks t join users u on u.id = t.created_by where t.waqf_id = $1 and t.kind = 'file_review' and t.status = 'todo' and u.email like 'admin%'", [founderWaqf]);
    const ownReview = (p: Page) => call(p, browser, "reviewFileChange", `/admin/waqfs/${founderWaqf}`, { taskId: own.id, waqfId: founderWaqf, decision: "approve", note: "" });
    expect((await ownReview(await as(browser, "admin"))).text).toContain("لا تراجع تعديلك بنفسك");
    await ownReview(await as(browser, "ops"));
    expect((await sql<{ s: string }>("select status s from tasks where id = $1", [own.id]))[0].s).toBe("done");
    // refusals are recorded without the submitted data
    const denied = await sql<{ after: { where: string; reason: string } }>("select after from audit_logs where action = 'authz.denied' order by id desc limit 5");
    expect(denied.length).toBeGreaterThan(0);
    for (const d of denied) expect(JSON.stringify(d.after)).not.toContain(MARK);
  });
});
