/**
 * Reference engine, phase-1 completion: the revival regulation, the beneficial-owner standards (visual reading), the
 * penalties table as structured data, the corporate-nazir study, and the impact on the 64 services. Pure tests (no
 * database, no network). Official texts come from the stored snapshots; every case below is synthetic.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { cite } from "../src/server/references/citation";
import { APPOINTED_CLAIMS, Q, studyAppointment, studyText, type AppointmentCase, type Quote } from "../src/server/references/nazir-appointment";
import { loadPenaltyTable, NZR_MAX_FINE, openQuestions, parseAmount, parseCell, REPS, SIZES, validatePenaltyTable } from "../src/server/references/penalties";
import { getEntry, REGISTRY, statusAt, validateRegistry } from "../src/server/references/registry";
import { segment } from "../src/server/references/segment";
import { loadManifest, readSnapshot, versionFromSnapshot } from "../src/server/references/snapshots";
import { InMemoryVersionStore } from "../src/server/references/versions";

const TODAY = "2026-11-06";
const snap = (id: string) => {
  const e = loadManifest().find((m) => m.id === id);
  if (!e) throw new Error(`no snapshot ${id}`);
  return { entry: e, text: readSnapshot(e) };
};
const norm = (s: string) => s.replace(/\\/g, "").replace(/[‌‏‎]/g, "").replace(/\s+/g, " ").trim();

describe("earlier work is kept", () => {
  it("the five phase-1 snapshots keep their files and hashes; new ones are appended", () => {
    const m = loadManifest();
    const first = Object.fromEntries(m.slice(0, 5).map((s) => [s.id, s.sha256]));
    expect(first).toEqual({
      "NZR/uqn-p18926": "e2d2b272a372c96904daeaea59eeb63bf18d2726184e5e21253a044045fb93a0",
      "NZR/uqn-p18936": "bf64f4443061c14f903012013c81f7fdc91de29073dbfe8af5c88d441fd281d3",
      "PRD/uqn-4001176": m.find((s) => s.id === "PRD/uqn-4001176")!.sha256,
      "DON/uqn-p27532": m.find((s) => s.id === "DON/uqn-p27532")!.sha256,
      "BO-STD/awqaf-2025-12": m.find((s) => s.id === "BO-STD/awqaf-2025-12")!.sha256,
    });
    for (const s of m) expect(() => readSnapshot(s)).not.toThrow();
    expect(m.map((s) => s.id).slice(5)).toEqual(["IHY/uqn-4001990", "BO-STD/upload-visual-f7a51daf", "NZR-LIC/awqaf-faq-109"]);
    expect(validateRegistry()).toEqual([]);
  });
});

describe("revival regulation (IHY) and the reporting rules it replaced", () => {
  const { text } = snap("IHY/uqn-4001990");
  const seg = segment(text);
  it("stores the full official text: 30 articles with their paragraphs", () => {
    expect(seg.articles.map((a) => a.number)).toEqual(Array.from({ length: 30 }, (_, i) => i + 1));
    const a = (n: number) => seg.articles.find((x) => x.number === n)!;
    expect(a(13).paragraphs).toHaveLength(5);
    expect(a(17).paragraphs[0].text).toContain("لا يزيد على 5% من قيمة عين الوقف المجهول، وبحد أقصى مبلغ عشرة ملايين ريال");
    expect(a(27).paragraphs[1].text).toContain("خلال (30) يومًا من تاريخ تبلغه بالقرار");
    expect(a(30).paragraphs[1].text).toContain("تحل هذه اللائحة محل قواعد الإبلاغ عن الأوقاف المجهولة والمندثرة الصادرة عن المجلس برقم 45/1/22/44 في 25/2/1444هـ");
  });
  it("IHY is in force from its approval date; the reporting rules are historical from then on", () => {
    const ihy = getEntry("IHY")!;
    const qwb = getEntry("QWB")!;
    expect(ihy.snapshots).toContain("IHY/uqn-4001990");
    expect(statusAt(ihy, TODAY)).toBe("in_force");
    expect(statusAt(qwb, TODAY)).toBe("repealed");
    expect(statusAt(qwb, "2025-01-01")).not.toBe("repealed");
    expect(qwb.instrument.value).toEqual({ number: "45/1/22/44", dateHijri: "1444/02/25" });
  });
});

describe("beneficial-owner standards (BO-STD)", () => {
  const { entry, text } = snap("BO-STD/upload-visual-f7a51daf");
  const seg = segment(text);
  it("the visual reading has all ten articles, and article 6 paragraphs 2–4 in full", () => {
    expect(entry).toMatchObject({ via: "manual_upload", role: "visual_transcription", sourceFileSha256: "f7a51dafd50e73917058e495dab0528ffac339f449597be303e381c958d77ca4", directConfirmed: false });
    expect(seg.articles.map((a) => a.number)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    const a6 = seg.articles.find((a) => a.number === 6)!;
    expect(a6.paragraphs.map((p) => p.number)).toEqual([1, 2, 3, 4]);
    expect(a6.paragraphs[0].text).toContain("لا تتجاوز (15) يوماً");
    expect(a6.paragraphs[1].text).toContain("بالإضافة إلى أي تفاصيل تخص طبيعة أصول الوقف، وموقعها، وحجمها، على أن يتم ذلك بشكل سنوي، أو فور طلب الهيئة");
    expect(a6.paragraphs[2].text).toContain("مستوى المخاطر والأهمية الجوهرية");
    expect(a6.paragraphs[3].text).toContain("بناءً على طلبه أو بشكل تلقائي");
    expect(seg.articles.find((a) => a.number === 10)!.body).toContain("تنشر المعايير في الجريدة الرسمية، ويعمل بها من تاريخ النشر");
  });
  it("is not treated as in force: publication in the gazette is not proven, so nothing of it is citable", () => {
    const bo = getEntry("BO-STD")!;
    expect(statusAt(bo, TODAY)).toBe("unknown");
    const store = new InMemoryVersionStore();
    store.addVersion(versionFromSnapshot(snap("BO-STD/awqaf-2025-12").entry, "2026-01-01", "ملف الهيئة 2025-12"));
    for (const article of [4, 5, 6, 7, 9]) expect(cite(REGISTRY, store, { refId: "BO-STD", article, asOf: TODAY })).toMatchObject({ ok: false, refusal: "status_unknown" });
  });
  it("a visual transcription from an uploaded file never passes as an official source", () => {
    const store = new InMemoryVersionStore();
    const v = store.addVersion(versionFromSnapshot(entry, "2026-01-01", "قراءة بصرية"));
    expect(v.source.via).toBe("manual_upload");
    // Even with a fabricated «in force» registry entry, the host check refuses an upload
    const forced = REGISTRY.map((e) => (e.id === "BO-STD" ? { ...e, effective: { value: { rule: "synthetic", from: "2026-01-01", computed: false }, evidence: [] }, status: { value: "in_force" as const, evidence: [] } } : e));
    const r = cite(forced, store, { refId: "BO-STD", article: 6, paragraph: 2, asOf: TODAY });
    expect(r.ok).toBe(false);
  });
});

describe("penalties table (PEN-TABLE) as structured data", () => {
  const t = loadPenaltyTable();
  it("parses amounts with either thousands separator and every cell kind", () => {
    expect(parseAmount("10.000 ريال")).toBe(10000);
    expect(parseAmount("2,500 ريال")).toBe(2500);
    expect(parseAmount("500 ريال")).toBe(500);
    expect(parseAmount("10.00 ريال")).toBeNull();
    expect(parseCell("-------- --------")).toEqual({ kind: "none" });
    expect(parseCell("")).toEqual({ kind: "blank" });
    expect(parseCell("عزل الناظر بعد إشعاره بالمخالفة دون تجاوبه في المعالجة")).toEqual({ kind: "removal_after_notice" });
    expect(parseCell("غرامة غير مفهومة")).toBeNull();
  });
  it("has the decision, 7 groups and 34 violations, each with 9 readable cells, within the legal maximum", () => {
    expect(t.instrument).toEqual({ number: "100/1/34/46", dateHijri: "1446/06/15" });
    expect(t.groups.map((g) => g.group)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    expect(t.violations.map((v) => v.code)).toHaveLength(34);
    expect(t.violations.filter((v) => v.group === 5).map((v) => v.code)).toEqual(["5-1", "5-2", "5-3", "5-4", "5-5", "5-6", "5-7"]);
    expect(validatePenaltyTable(t)).toEqual([]);
    const fines = t.violations.flatMap((v) => SIZES.flatMap((s) => REPS.map((p) => v.sanctions[s][p].sanction)).filter((x) => x?.kind === "fine").map((x) => (x as { amountSAR: number }).amountSAR));
    expect(Math.max(...fines)).toBe(200_000);
    expect(Math.max(...fines)).toBeLessThanOrEqual(NZR_MAX_FINE);
    expect(t.footnote).toContain("(500.000) ريال");
  });
  it("keeps each sanction tied to its violation, waqf size and repetition (cells checked against the page images)", () => {
    const v = (c: string) => t.violations.find((x) => x.code === c)!;
    expect(v("1-1").description).toBe("مخالفة شرط الواقف بالصرف لغير المستفيدين من عوائد الوقف");
    expect(v("1-1").sanctions.large.second.sanction).toEqual({ kind: "removal_after_notice" });
    expect(v("1-2").sanctions.small.second.sanction).toEqual({ kind: "fine", amountSAR: 2500 });
    expect(v("5-3").sanctions.large.third.sanction).toEqual({ kind: "fine", amountSAR: 200_000 });
    expect(v("7-1").sanctions.small.third.sanction).toEqual({ kind: "removal" });
    expect(v("7-3").sanctions.medium.third.sanction).toEqual({ kind: "fine", amountSAR: 10_000 });
    expect(t.visualCheck.pages).toEqual([3, 4, 5, 6, 7, 8, 9]);
    expect(t.visualCheck.humanReviewed).toBe(false);
  });
  it("reports what the table does not settle instead of resolving it, and keeps procedure out", () => {
    const q = openQuestions(t).join("\n");
    expect(q).toContain("1-1 (الأوقاف المتوسطة، المرة الثالثة)");
    expect(q).toContain("ذات الانتفاع المباشر");
    expect(q).toContain("قواعد معالجة المخالفات");
    expect(q).toContain("لم يثبت أن الملف المرفوع مطابق");
    // The procedural rules are a separate, unretrieved instrument: no procedure is stored with the table
    expect(Object.keys(t)).not.toContain("procedure");
    expect(getEntry("NZR-VIOL")!.instrument.value).toBeNull();
    expect(getEntry("NZR-VIOL")!.snapshots.every((s) => loadManifest().find((m) => m.id === s)!.role === "statement")).toBe(true);
  });
});

describe("corporate nazir: studied, prepared, never blocked, never presumed appointed", () => {
  const base: AppointmentCase = {
    candidate: { kind: "legal", consentDocumented: true, entityDocs: { registration: true, boardResolution: true, signatoryAuthority: false, ownersAndManagers: true } },
    founder: { alive: true, condition: "names_candidate", waqfDocumented: true },
    seat: "first_appointment",
    waqfStatus: "known",
    appointmentDocument: null,
    licence: null,
    managementContract: false,
  };

  it("every quotation used is verbatim in its stored official snapshot", () => {
    for (const q of Object.values(Q) as Quote[]) expect(norm(snap(q.snapshot).text)).toContain(norm(q.quote));
  });

  it("a legal-person candidate without a licence is processable with human review, not rejected", () => {
    const s = studyAppointment(base);
    expect(s.outcome).toBe("processable_with_human_review");
    expect(JSON.stringify(s)).not.toMatch(/rejected|مرفوض|يُرفض الطلب|لا يجوز للشخص الاعتباري/);
    expect(s.regulatoryFollowUps).toEqual([expect.objectContaining({ refId: "NZR-LIC", effect: "follow_up_not_prohibition" })]);
    expect(s.draftRequest.body.join(" ")).toContain("ولم تُنشر إجراءات هذا الترخيص");
    expect(s.path.some((p) => p.kind === "unresolved" && p.note === "متابعة تنظيمية، لا مانع")).toBe(true);
  });

  it("distinguishes text, founder's condition, competent-body decision and unresolved matters", () => {
    const kinds = new Set(studyAppointment(base).bases.map((b) => b.kind));
    expect([...kinds].sort()).toEqual(["authority_decision", "founder_condition", "text", "unresolved"]);
    const lic = studyAppointment(base).bases.find((b) => b.quote === Q.licensed)!;
    expect(lic.kind).toBe("text");
    expect(studyAppointment(base).bases.find((b) => b.quote === Q.licensingUnderStudy)!.kind).toBe("unresolved");
  });

  it("does not state the company is the nazir without an appointment document, even with a request or a management contract", () => {
    for (const c of [base, { ...base, managementContract: true }, { ...base, seat: "vacant" as const, founder: { ...base.founder, alive: false, condition: "silent" as const } }]) {
      const s = studyAppointment(c);
      expect(s.appointment.established).toBe(false);
      const out = studyText(s);
      for (const claim of APPOINTED_CLAIMS) expect(out).not.toContain(claim);
      expect(s.draftRequest.disclaimer).toContain("لا يثبت بها تعيين");
    }
    expect(studyAppointment({ ...base, managementContract: true }).appointment.statement).toContain("إبرام عقد إدارة");
    expect(studyAppointment({ ...base, managementContract: true }).bases.some((b) => b.quote === Q.delegationOfManagement)).toBe(true);
  });

  it("records the appointment only from a document", () => {
    const s = studyAppointment({ ...base, appointmentDocument: { issuer: "جهة اصطناعية", number: "0000", dateHijri: "1448/01/01" } });
    expect(s.appointment.established).toBe(true);
  });

  it("respects the founder's choice and the delegated route; a natural person carries no licensing item", () => {
    const d = studyAppointment({ ...base, founder: { ...base.founder, condition: "delegates_appointment" } });
    expect(d.bases.some((b) => b.kind === "founder_condition" && b.quote === Q.delegatedAppointment)).toBe(true);
    const n = studyAppointment({ ...base, candidate: { kind: "natural", consentDocumented: null } });
    expect(n.regulatoryFollowUps).toEqual([]);
    expect(n.checklist.some((c) => c.quote === Q.licensed)).toBe(false);
  });

  it("routes an unknown waqf through the authority to the competent court (IHY art. 13)", () => {
    const s = studyAppointment({ ...base, waqfStatus: "unknown" });
    expect(s.draftRequest.addressee).toContain("المحكمة المختصة");
    expect(s.bases.some((b) => b.quote === Q.unknownWaqfCourt)).toBe(true);
  });

  it("no quotation is citable while its comparison is unreviewed: the guard is not bypassed", () => {
    const store = new InMemoryVersionStore();
    store.addVersion(versionFromSnapshot(snap("NZR/uqn-p18926").entry, "2022-02-04", "أم القرى"));
    const s = studyAppointment(base, (q) => {
      const m = q.locator.match(/^م(\d+)(?:\/ف(\d+))?/);
      return m ? cite(REGISTRY, store, { refId: q.refId, article: Number(m[1]), paragraph: m[2] ? Number(m[2]) : undefined, asOf: TODAY }) : null;
    });
    const results = s.bases.map((b) => b.citation).filter((x) => x !== null);
    expect(results.length).toBeGreaterThan(0);
    for (const r of results) expect(r!.ok).toBe(false);
  });
});

describe("N01 and the manual services are not touched", () => {
  const src = (p: string) => readFileSync(path.join(process.cwd(), p), "utf8");
  it("N01 stays in the catalogue and its intake is still gated only by the operational switch", () => {
    expect(src("src/server/seed/data/services.ts")).toMatch(/code: "N01", cat: "N", nameAr: "تولي النظارة \(ناظر اعتباري\)"/);
    expect(src("src/server/modules/requests/catalog.ts")).toContain("const SERVICE_FLAGS: Record<string, string> = { N01: NAZARA_INTAKE_FLAG };");
    expect(src("src/server/modules/nazara/licence.ts")).toContain("gated only by the operational\n *     switch `service.nazara`, never by the licence.");
  });
  it("the new modules are not imported by any page, route, action or service module", () => {
    const files = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? files(path.join(dir, d.name)) : /\.(ts|tsx)$/.test(d.name) ? [path.join(dir, d.name)] : []));
    const users = files(path.join(process.cwd(), "src")).filter((f) => !f.includes(`${path.sep}references${path.sep}`)).filter((f) => /penalties|nazir-appointment/.test(readFileSync(f, "utf8")) && /server\/references/.test(readFileSync(f, "utf8")));
    expect(users).toEqual([]);
  });
});

describe("impact on the 64 services", () => {
  const report = JSON.parse(readFileSync(path.join(process.cwd(), "data/references/reports/service-impact.json"), "utf8")) as { rows: { code: string; classification: string; refs: { id: string; tier: string; classification: string }[]; professional: string; provision: string; missingImpact: string; n01Note?: string }[] };
  it("covers all 64 services with the eight attributes, and nothing is classified approved", () => {
    expect(report.rows).toHaveLength(64);
    for (const r of report.rows) {
      expect(r.professional).toBeTruthy();
      expect(r.provision).toBeTruthy();
      expect(r.missingImpact).toBeTruthy();
      expect(r.classification).not.toBe("معتمد");
      for (const x of r.refs) expect(x.classification).not.toBe("معتمد");
    }
  });
  it("the licensing gap is listed on N01 without disabling it, and preparing a request is not the appointment", () => {
    const n01 = report.rows.find((r) => r.code === "N01")!;
    expect(n01.refs.filter((x) => x.id === "NZR-LIC")).toHaveLength(1);
    expect(n01.n01Note).toContain("لا تعطل الخدمة آليًا");
    expect(n01.n01Note).toContain("إعداد الطلب ليس صدور التعيين");
    expect(n01.provision).toContain("مباشرة النظارة لا تبدأ قبل وثيقة التعيين");
    expect(n01.missingImpact).not.toContain("ضوابط ترخيص");
  });
  it("the repealed reporting rules appear on N09 only as history, with the revival regulation as its basis", () => {
    const n09 = report.rows.find((r) => r.code === "N09")!;
    expect(n09.refs.find((x) => x.id === "QWB")).toMatchObject({ classification: "غير صالح للاستخدام" });
    expect(n09.refs.find((x) => x.id === "IHY")).toMatchObject({ tier: "جوهري" });
  });
});
