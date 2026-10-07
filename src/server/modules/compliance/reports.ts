import "server-only";
/**
 * GAA export packages (export only — no technical integration with the GAA portal).
 * A package is stored as a `reports` row whose `snapshot` is the immutable data used to render it;
 * the PDF/CSV is rendered from the snapshot on download. Sensitive BO fields stay encrypted inside the
 * snapshot and are decrypted at download time only for viewers holding `bo.view`.
 */
import { and, asc, eq, gte, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Tx } from "../../db";
import {
  beneficialOwners, bodies, bodyMemberships, documents, meetings, resolutions, trustees, violations, waqfKeys, waqfs, penaltySchedule,
} from "../../db/schema";
import { addDays, gregorian, hijri, lastFiscalYearEnd, todayISO } from "../../engines/dates";
import { decryptString, unwrapDataKey } from "../../lib/crypto";
import { listWaqfInstances, summarize } from "./queries";
import { CATEGORY_AR, STATUS_AR, PENDING_SUFFIX } from "./pure";

export type ReportPackage = "annual" | "bo" | "obligations_csv";

const CONF_PERM: Record<string, string> = { internal: "documents.view", confidential: "documents.view_confidential", secret: "documents.view_secret" };
const SIZE_AR: Record<string, string> = { large: "كبير", medium: "متوسط", small: "صغير", direct_benefit: "ذو انتفاع مباشر" };
const TYPE_AR: Record<string, string> = { public: "عام (خيري)", private: "خاص (أهلي)", joint: "مشترك" };
const WSTATUS_AR: Record<string, string> = { idea: "فكرة", draft: "مسودة", documenting: "قيد التوثيق", documented: "موثّق", registered: "مسجّل", active: "نشط", suspended: "معلّق", ended: "منتهٍ" };
const NAZIR_AR: Record<string, string> = { founder: "الواقف نفسه", individual: "ناظر فرد", board: "مجلس نظارة", legal_entity: "شخص اعتباري", gaa: "الهيئة العامة للأوقاف", vacant: "شاغرة" };
const BO_ROLE_AR: Record<string, string> = { controlling_founder: "واقف مسيطر", nazir: "ناظر", controller: "مسيطر فعلي", beneficiary: "مستفيد", service_provider: "مقدم خدمة", director: "عضو مجلس / مدير" };
const BODY_ROLE_AR: Record<string, string> = { chair: "رئيس", vice_chair: "نائب الرئيس", member: "عضو", secretary: "أمين السر", observer: "مراقب" };

// ───────────── Snapshots ─────────────

async function waqfIdentity(tx: Tx, waqfId: string) {
  const [w] = await tx.select().from(waqfs).where(eq(waqfs.id, waqfId)).limit(1);
  if (!w) throw new Error("waqf not visible");
  return {
    name: w.name, internalNumber: w.internalNumber, nationalUnifiedNumber: w.nationalUnifiedNumber, registrationCertNo: w.registrationCertNo,
    registrationExpiresOn: w.registrationExpiresOn, deedNo: w.deedNo, deedIssuer: w.deedIssuer, deedDate: w.deedDate, deedDateHijri: w.deedDateHijri,
    documentedOn: w.documentedOn, registeredOn: w.registeredOn, legalType: w.legalType ?? w.computedType, sizeClass: w.sizeClass, status: w.status,
    nazirMode: w.nazirMode, fiscalYearEnd: w.fiscalYearEnd, fieldOfWork: w.fieldOfWork, geographicScope: w.geographicScope, isDemo: w.isDemo,
  };
}

export async function buildAnnualSnapshot(tx: Tx, waqfId: string, perms: Set<string>, fyYear: number | null) {
  const waqf = await waqfIdentity(tx, waqfId);
  const today = todayISO();
  const fye = fyYear ? `${fyYear}-${waqf.fiscalYearEnd}` : lastFiscalYearEnd(today, waqf.fiscalYearEnd);
  const prevFye = `${Number(fye.slice(0, 4)) - 1}-${waqf.fiscalYearEnd}`;
  const fy = { year: Number(fye.slice(0, 4)), start: addDays(prevFye, 1), end: fye };

  const tr = await tx.select().from(trustees).where(and(eq(trustees.waqfId, waqfId), eq(trustees.status, "active"))).orderBy(asc(trustees.displayName));
  const bodyRows = await tx
      .select({ body: bodies.name, kind: bodies.kind, person: bodyMemberships.personName, role: bodyMemberships.role, independent: bodyMemberships.isIndependent, endsOn: bodyMemberships.endsOn })
      .from(bodyMemberships)
      .innerJoin(bodies, eq(bodies.id, bodyMemberships.bodyId))
      .where(and(eq(bodyMemberships.waqfId, waqfId), or(isNull(bodyMemberships.endsOn), gte(bodyMemberships.endsOn, fy.start))));
  const bos = await tx.select({ role: beneficialOwners.role, verifiedOn: beneficialOwners.verifiedOn, nextDue: beneficialOwners.nextVerificationDue, subjectType: beneficialOwners.subjectType }).from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, waqfId), isNull(beneficialOwners.archivedAt)));
  const docs = await tx.select().from(documents).where(and(eq(documents.waqfId, waqfId), isNull(documents.archivedAt), inArray(documents.status, ["active"]))).orderBy(asc(documents.docType), asc(documents.title));
  const mtgs = await tx
      .select({ status: meetings.status, n: sql<number>`count(*)::int` })
      .from(meetings)
      .where(and(eq(meetings.waqfId, waqfId), gte(meetings.scheduledAt, new Date(`${fy.start}T00:00:00+03:00`)), lte(meetings.scheduledAt, new Date(`${fy.end}T23:59:59+03:00`))))
      .groupBy(meetings.status);
  const res = await tx
      .select({ status: resolutions.status, n: sql<number>`count(*)::int` })
      .from(resolutions)
      .where(and(eq(resolutions.waqfId, waqfId), gte(resolutions.createdAt, new Date(`${fy.start}T00:00:00+03:00`)), lte(resolutions.createdAt, new Date(`${fy.end}T23:59:59+03:00`))))
      .groupBy(resolutions.status);
  const viol = await tx
      .select({ v: violations, title: penaltySchedule.titleAr })
      .from(violations)
      .leftJoin(penaltySchedule, eq(penaltySchedule.code, violations.penaltyCode))
      .where(and(eq(violations.waqfId, waqfId), gte(violations.noticedOn, fy.start), lte(violations.noticedOn, fy.end)));

  const instances = await listWaqfInstances(tx, waqfId);
  const inFy = instances.filter((i) => i.periodKey === `FY${fy.year}` || (i.dueOn && i.dueOn >= fy.start && i.dueOn <= addDays(fy.end, 120)) || i.periodKey === "standing");
  const sum = summarize(inFy);
  const byRole: Record<string, number> = {};
  for (const b of bos) byRole[b.role] = (byRole[b.role] ?? 0) + 1;
  const verifiedDates = bos.map((b) => b.verifiedOn).filter((x): x is string => !!x).sort();
  const nextDue = bos.map((b) => b.nextDue).filter((x): x is string => !!x).sort();
  const visibleDocs = docs.filter((d) => perms.has(CONF_PERM[d.confidentiality] ?? "documents.view_secret"));
  const inFyDocs = (d: (typeof docs)[number]) => !!d.issuedOn && d.issuedOn >= fy.start && d.issuedOn <= addDays(fy.end, 180);
  const has = (t: string, fyOnly = false) => docs.some((d) => d.docType === t && (!fyOnly || inFyDocs(d)));
  const instDone = (codes: string[]) => inFy.some((i) => codes.includes(i.code) && i.status === "done");
  const sizeLarge = waqf.sizeClass === "large" || waqf.sizeClass === "medium";
  // Checklist of what a GAA annual submission normally needs (export aid; presence in the vault, not content review).
  const checklist = [
    { label: "صك الوقف", ok: has("waqf_deed"), note: "صورة الصك الساري" },
    { label: "شهادة تسجيل الوقف سارية", ok: has("registration_certificate") && (!waqf.registrationExpiresOn || waqf.registrationExpiresOn >= today), note: waqf.registrationExpiresOn ? `تنتهي ${waqf.registrationExpiresOn}` : "تاريخ الانتهاء غير مسجل" },
    { label: sizeLarge ? "القوائم المالية المدققة للسنة" : "القوائم المالية أو التقرير المالي للسنة", ok: has("financial_statement", true) || instDone(["OB-FIN-02", "OB-FIN-03"]), note: "صادرة خلال السنة المالية أو بعدها بستة أشهر" },
    ...(sizeLarge ? [{ label: "الموازنة التقديرية المعتمدة", ok: instDone(["OB-FIN-01"]), note: "الالتزام OB-FIN-01" }] : []),
    { label: "كشف صرف الغلة للمستحقين", ok: instDone(["OB-DIS-01"]) || has("bank_statement", true), note: "الالتزام OB-DIS-01 أو كشف بنكي" },
    { label: "التحقق السنوي من المستفيد الحقيقي", ok: instDone(["OB-BO-02"]) || (!!verifiedDates.at(-1) && verifiedDates.at(-1)! >= fy.start), note: "معايير المستفيد الحقيقي" },
    { label: "قرارات ومحاضر النظارة خلال السنة", ok: has("resolution", true) || has("minutes", true), note: "قرار أو محضر صادر خلال السنة" },
  ];
  const count = (rows: { status: string; n: number }[], ss: string[]) => rows.filter((r) => ss.includes(r.status)).reduce((a, r) => a + r.n, 0);

  return {
    package: "annual" as const,
    title: `حزمة التقرير السنوي — السنة المالية المنتهية ${fy.end}`,
    generatedOn: today,
    fy,
    waqf,
    nazara: {
      mode: waqf.nazirMode,
      trustees: tr.map((t) => ({ name: t.displayName, kind: t.kind, chair: t.isChair, independent: t.isIndependent, startsOn: t.startsOn, endsOn: t.endsOn })),
      board: bodyRows.map((b) => ({ body: b.body, person: b.person, role: b.role, independent: b.independent })),
    },
    bo: { total: bos.length, byRole, lastVerifiedOn: verifiedDates.at(-1) ?? null, nextVerificationDue: nextDue[0] ?? null },
    compliance: {
      counts: sum.counts,
      readiness: sum.readiness,
      items: inFy.map((i) => ({
        code: i.code, title: i.title, category: i.category, status: i.status, dueOn: i.dueOn, completedOn: i.completedOn, reference: i.reference.label,
        referencePending: i.reference.pending, penalty: i.penalty?.text ?? null, evidence: i.documents.filter((d) => !d.hidden).map((d) => d.title),
      })),
    },
    checklist,
    documents: visibleDocs.map((d) => ({ title: d.title, number: d.number, docType: d.docType, issuedOn: d.issuedOn, expiresOn: d.expiresOn, confidentiality: d.confidentiality })),
    documentsHidden: docs.length - visibleDocs.length,
    governance: {
      meetingsHeld: count(mtgs, ["held"]),
      meetingsScheduled: count(mtgs, ["scheduled"]),
      resolutionsTotal: count(res, ["draft", "approved", "rejected", "deferred", "executed", "reviewed"]),
      resolutionsApproved: count(res, ["approved", "executed", "reviewed"]),
    },
    violations: viol.map(({ v, title }) => ({ code: v.penaltyCode, title, noticedOn: v.noticedOn, authorityRef: v.authorityRef, sanction: v.sanction, status: v.status, occurrence: v.occurrence })),
  };
}

export async function buildBoSnapshot(tx: Tx, waqfId: string) {
  const waqf = await waqfIdentity(tx, waqfId);
  const rows = await tx.select().from(beneficialOwners).where(and(eq(beneficialOwners.waqfId, waqfId), isNull(beneficialOwners.archivedAt))).orderBy(asc(beneficialOwners.role), asc(beneficialOwners.fullName));
  return {
    package: "bo" as const,
    title: "ملف المستفيد الحقيقي",
    generatedOn: todayISO(),
    waqf: { name: waqf.name, internalNumber: waqf.internalNumber, nationalUnifiedNumber: waqf.nationalUnifiedNumber, registrationCertNo: waqf.registrationCertNo, isDemo: waqf.isDemo },
    // Encrypted columns are copied as ciphertext; decryption happens per viewer at download time.
    owners: rows.map((b) => ({
      subjectType: b.subjectType, role: b.role, fullName: b.fullName, nationality: b.nationality, birthDate: b.birthDate, birthPlace: b.birthPlace,
      idType: b.idType, idNumberEnc: b.idNumberEnc, addressEnc: b.addressEnc, bankDetailsEnc: b.bankDetailsEnc, contact: b.contact, acquiredOn: b.acquiredOn,
      relationToWaqf: b.relationToWaqf, entitlementDesc: b.entitlementDesc, legalForm: b.legalForm, nationalAddress: b.nationalAddress, directors: b.directors,
      powers: b.powers, residesInKsa: b.residesInKsa, verifiedOn: b.verifiedOn, verificationSource: b.verificationSource, riskLevel: b.riskLevel, nextVerificationDue: b.nextVerificationDue,
    })),
  };
}

export async function buildCsvSnapshot(tx: Tx, waqfId: string) {
  const waqf = await waqfIdentity(tx, waqfId);
  const items = await listWaqfInstances(tx, waqfId);
  return {
    package: "obligations_csv" as const,
    title: "سجل الالتزامات النظامية (CSV)",
    generatedOn: todayISO(),
    waqf: { name: waqf.name, internalNumber: waqf.internalNumber },
    rows: items.map((i) => ({
      code: i.code, title: i.title, category: i.category, status: i.status, periodKey: i.periodKey, dueOn: i.dueOn, completedOn: i.completedOn,
      reference: i.reference.label, referencePending: i.reference.pending, penalty: i.penalty?.text ?? "", evidence: i.documents.filter((d) => !d.hidden).map((d) => d.title).join(" | "),
      waivedReason: i.waivedReason ?? "",
    })),
  };
}

export type AnnualSnapshot = Awaited<ReturnType<typeof buildAnnualSnapshot>>;
export type BoSnapshot = Awaited<ReturnType<typeof buildBoSnapshot>>;
export type CsvSnapshot = Awaited<ReturnType<typeof buildCsvSnapshot>>;
export type AnySnapshot = AnnualSnapshot | BoSnapshot | CsvSnapshot;

// ───────────── Decryption for BO (viewer must hold bo.view) ─────────────

export async function boDecryptor(tx: Tx, waqfId: string) {
  let waqfKey: Buffer | null = null;
  try {
    const [k] = await tx.select({ wrapped: waqfKeys.wrappedKey }).from(waqfKeys).where(eq(waqfKeys.waqfId, waqfId)).limit(1);
    if (k) waqfKey = unwrapDataKey(k.wrapped);
  } catch {
    waqfKey = null;
  }
  return (v: string | null | undefined): string | null => {
    if (!v) return null;
    try {
      return decryptString(v);
    } catch {}
    if (waqfKey) {
      try {
        return decryptString(v, waqfKey);
      } catch {}
    }
    return "تعذر فك التشفير";
  };
}

// ───────────── HTML ─────────────

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const both = (d: string | null | undefined) => (d ? `${esc(gregorian(d))}<br><span class="muted small">${esc(hijri(d))}</span>` : "—");
const STATUS_TAG: Record<string, string> = { overdue: "critical", due_soon: "fine", upcoming: "ink", done: "ok", waived: "seal", not_applicable: "seal" };

function cover(title: string, sub: string, waqfName: string, meta: [string, string][], confidential = false) {
  return `<div class="brandbar"></div>
  <div style="padding-top:28mm">
    ${confidential ? `<p class="tag critical" style="font-size:11pt;padding:2px 12px">سري — للاطلاع المقيد</p>` : ""}
    <p class="muted" style="margin-top:8px">وقفك — حزمة تصدير للهيئة العامة للأوقاف (تصدير فقط، لا ربط تقني)</p>
    <h1 style="font-size:26pt;margin-top:6mm">${esc(title)}</h1>
    <p class="naskh" style="font-size:16pt;color:var(--seal)">${esc(waqfName)}</p>
    <p class="muted">${esc(sub)}</p>
    <dl class="kv" style="margin-top:12mm">${meta.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>
  </div>`;
}

export function annualHtml(s: AnnualSnapshot, meta: { number: string; verificationCode: string; generatedBy: string | null }) {
  const w = s.waqf;
  const rows = (pairs: [string, string][]) => `<dl class="kv">${pairs.map(([k, v]) => `<dt>${esc(k)}</dt><dd>${v}</dd>`).join("")}</dl>`;
  const r = s.compliance.readiness;
  return `
  ${cover(s.title, `السنة المالية من ${gregorian(s.fy.start)} إلى ${gregorian(s.fy.end)} (${hijri(s.fy.start)} — ${hijri(s.fy.end)})`, w.name, [
    ["رقم الحزمة", esc(meta.number)],
    ["رمز التحقق", `<span class="tabular">${esc(meta.verificationCode)}</span>`],
    ["تاريخ الإعداد", both(s.generatedOn)],
    ["أعدّها", esc(meta.generatedBy ?? "—")],
  ])}
  ${w.isDemo ? `<div class="box seal" style="margin-top:10mm">بيانات تجريبية — لا تمثل وقفًا حقيقيًا.</div>` : ""}

  <div class="page-break"></div>
  <h2>١. هوية الوقف</h2>
  ${rows([
    ["اسم الوقف", esc(w.name)],
    ["الرقم الداخلي", esc(w.internalNumber)],
    ["الرقم الوطني الموحد", esc(w.nationalUnifiedNumber ?? "—")],
    ["رقم شهادة التسجيل", esc(w.registrationCertNo ?? "—")],
    ["انتهاء الشهادة", both(w.registrationExpiresOn)],
    ["رقم صك الوقف", esc(w.deedNo ?? "—")],
    ["جهة الإصدار", esc(w.deedIssuer ?? "—")],
    ["تاريخ التوثيق", both(w.documentedOn)],
    ["تاريخ التسجيل", both(w.registeredOn)],
    ["النوع", esc(TYPE_AR[w.legalType ?? ""] ?? "—")],
    ["فئة الحجم", esc(SIZE_AR[w.sizeClass ?? ""] ?? "—")],
    ["الحالة", esc(WSTATUS_AR[w.status] ?? w.status)],
    ["مجال العمل", esc(w.fieldOfWork ?? "—")],
    ["النطاق الجغرافي", esc(w.geographicScope ?? "—")],
    ["نهاية السنة المالية", esc(w.fiscalYearEnd)],
  ])}

  <h2>٢. النظارة ومجلس النظارة</h2>
  <p>نمط النظارة: <strong>${esc(NAZIR_AR[s.nazara.mode ?? ""] ?? "غير محدد")}</strong></p>
  ${
    s.nazara.trustees.length
      ? `<table><thead><tr><th>الاسم</th><th>الصفة</th><th>مستقل</th><th>بداية</th><th>نهاية</th></tr></thead><tbody>${s.nazara.trustees
          .map((t) => `<tr><td>${esc(t.name)}${t.chair ? ` <span class="tag ink">رئيس</span>` : ""}</td><td>${esc(t.kind)}</td><td>${t.independent ? "نعم" : "لا"}</td><td>${both(t.startsOn)}</td><td>${both(t.endsOn)}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">لا توجد سجلات نظار في المنصة.</p>`
  }
  ${
    s.nazara.board.length
      ? `<h3>أعضاء الهيئات</h3><table><thead><tr><th>الهيئة</th><th>العضو</th><th>الصفة</th><th>مستقل</th></tr></thead><tbody>${s.nazara.board
          .map((b) => `<tr><td>${esc(b.body)}</td><td>${esc(b.person)}</td><td>${esc(BODY_ROLE_AR[b.role] ?? b.role)}</td><td>${b.independent ? "نعم" : "لا"}</td></tr>`)
          .join("")}</tbody></table>`
      : ""
  }

  <h2>٣. ملخص المستفيد الحقيقي</h2>
  <p class="small muted">أعداد وأدوار فقط؛ البيانات التفصيلية في «ملف المستفيد الحقيقي» المقيد الاطلاع.</p>
  ${
    s.bo.total
      ? `<table><thead><tr><th>الدور</th><th>العدد</th></tr></thead><tbody>${Object.entries(s.bo.byRole)
          .map(([k, n]) => `<tr><td>${esc(BO_ROLE_AR[k] ?? k)}</td><td class="tabular">${n}</td></tr>`)
          .join("")}<tr><th>الإجمالي</th><th class="tabular">${s.bo.total}</th></tr></tbody></table>
         ${rows([["آخر تحقق", both(s.bo.lastVerifiedOn)], ["أقرب تحقق مستحق", both(s.bo.nextVerificationDue)]])}`
      : `<div class="box critical">لا يوجد سجل للمستفيد الحقيقي في المنصة. حدّث السجل قبل تقديم الحزمة (معايير المستفيد الحقيقي م6/1).</div>`
  }

  <div class="page-break"></div>
  <h2>٤. حالة الامتثال للسنة المالية</h2>
  <div class="grid2">
    <div class="box stone"><p class="muted small">نسبة الجاهزية (المنجز في موعده ÷ المستحق)</p><p style="font-size:20pt;font-weight:700;color:var(--ink)">${r.pct === null ? "—" : `${r.pct}%`}</p><p class="small muted">${r.onTime} من ${r.due}</p></div>
    <div class="box stone"><p class="muted small">التوزيع</p><p>متأخر ${s.compliance.counts.overdue} · قريب ${s.compliance.counts.due_soon} · قادم ${s.compliance.counts.upcoming} · منجز ${s.compliance.counts.done} · معفى ${s.compliance.counts.waived}</p></div>
  </div>
  <table><thead><tr><th>الالتزام</th><th>المرجع</th><th>الموعد</th><th>الحالة</th><th>الدليل</th></tr></thead><tbody>
  ${s.compliance.items
    .map(
      (i) => `<tr><td><strong>${esc(i.title)}</strong><br><span class="muted small">${esc(i.code)} · ${esc(CATEGORY_AR[i.category] ?? i.category)}</span>${i.penalty && i.status !== "done" ? `<br><span class="tag fine">${esc(i.penalty)}</span>` : ""}</td>
      <td class="small">${esc(i.reference)}${i.referencePending ? `<br><span class="tag seal">بانتظار التحقق</span>` : ""}</td>
      <td>${both(i.dueOn)}</td><td><span class="tag ${STATUS_TAG[i.status] ?? "ink"}">${esc(STATUS_AR[i.status] ?? i.status)}</span>${i.completedOn ? `<br><span class="small muted">${esc(gregorian(i.completedOn))}</span>` : ""}</td>
      <td class="small">${i.evidence.length ? i.evidence.map(esc).join("<br>") : "—"}</td></tr>`,
    )
    .join("")}
  </tbody></table>
  ${s.violations.length ? `<h3>المخالفات المسجلة خلال السنة</h3><table><thead><tr><th>البند</th><th>التاريخ</th><th>رقم القرار</th><th>الجزاء</th><th>الحالة</th></tr></thead><tbody>${s.violations.map((v) => `<tr><td>${esc(v.code)} — ${esc(v.title ?? "")} (تكرار ${v.occurrence})</td><td>${both(v.noticedOn)}</td><td>${esc(v.authorityRef ?? "—")}</td><td>${esc(v.sanction ?? "—")}</td><td>${esc(v.status)}</td></tr>`).join("")}</tbody></table>` : ""}

  <h2>٥. الاجتماعات والقرارات</h2>
  ${rows([
    ["اجتماعات منعقدة", `<span class="tabular">${s.governance.meetingsHeld}</span>`],
    ["اجتماعات مجدولة لم تنعقد", `<span class="tabular">${s.governance.meetingsScheduled}</span>`],
    ["قرارات خلال السنة", `<span class="tabular">${s.governance.resolutionsTotal}</span>`],
    ["قرارات معتمدة أو منفذة", `<span class="tabular">${s.governance.resolutionsApproved}</span>`],
  ])}

  <h2>٦. قائمة تدقيق القوائم والوثائق</h2>
  <table><thead><tr><th>البند</th><th>متوفر في المنصة</th><th>ملاحظة</th></tr></thead><tbody>
  ${(s.checklist ?? []).map((c) => `<tr><td>${esc(c.label)}</td><td><span class="tag ${c.ok ? "ok" : "critical"}">${c.ok ? "متوفر" : "ناقص"}</span></td><td class="small muted">${esc(c.note)}</td></tr>`).join("")}
  </tbody></table>

  <h2>٧. فهرس الوثائق</h2>
  ${
    s.documents.length
      ? `<table><thead><tr><th>العنوان</th><th>الرقم</th><th>الإصدار</th><th>الانتهاء</th></tr></thead><tbody>${s.documents
          .map((d) => `<tr><td>${esc(d.title)}</td><td>${esc(d.number ?? "—")}</td><td>${both(d.issuedOn)}</td><td>${both(d.expiresOn)}</td></tr>`)
          .join("")}</tbody></table>`
      : `<p class="muted">لا توجد وثائق سارية في ملف الوقف.</p>`
  }
  ${s.documentsHidden ? `<p class="small muted">استُبعدت ${s.documentsHidden} وثيقة لا يملك معدّ الحزمة صلاحية الاطلاع عليها.</p>` : ""}

  <div class="page-break"></div>
  <h2>٨. إقرار الناظر</h2>
  <div class="naskh" style="font-size:12.5pt">
    <p>أقرّ أنا الموقّع أدناه، بصفتي ناظرًا على «${esc(w.name)}»، بأن البيانات الواردة في هذه الحزمة صحيحة ومطابقة لسجلات الوقف حتى تاريخ إعدادها،
    وبأني اطلعت على حالة الالتزامات النظامية للسنة المالية المنتهية في ${esc(gregorian(s.fy.end))} (${esc(hijri(s.fy.end))})،
    وألتزم بتحديث ما يطرأ عليها من تغيير لدى الهيئة العامة للأوقاف في المدد النظامية.</p>
  </div>
  <table style="margin-top:14mm"><tbody>
    <tr><th style="width:30%">الاسم</th><td style="height:14mm"></td></tr>
    <tr><th>الصفة</th><td style="height:14mm"></td></tr>
    <tr><th>رقم الهوية</th><td style="height:14mm"></td></tr>
    <tr><th>التاريخ</th><td style="height:14mm">&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;هـ — &nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;/&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;م</td></tr>
    <tr><th>التوقيع</th><td style="height:24mm"></td></tr>
  </tbody></table>
  <p class="small muted" style="margin-top:8mm">المراجع المعلّمة «بانتظار التحقق» تُطابق مع النص الرسمي قبل الاعتماد عليها. الجزاءات المعروضة ${esc(PENDING_SUFFIX)} ما لم يُذكر خلاف ذلك.
  رمز التحقق: ${esc(meta.verificationCode)}</p>`;
}

export function boHtml(s: BoSnapshot, meta: { number: string; verificationCode: string; generatedBy: string | null }, dec: ((v: string | null | undefined) => string | null) | null) {
  const secret = (v: string | null | undefined) => (v ? (dec ? esc(dec(v)) : `<span class="muted">محجوب — يتطلب صلاحية عرض المستفيد الحقيقي</span>`) : "—");
  const owner = (o: BoSnapshot["owners"][number]) => `
    <div class="box avoid-break">
      <h3 style="margin-top:0">${esc(o.fullName)} <span class="tag ink">${esc(BO_ROLE_AR[o.role] ?? o.role)}</span> ${o.subjectType === "organization" ? `<span class="tag seal">شخص اعتباري</span>` : ""}</h3>
      <dl class="kv">
        <dt>الجنسية</dt><dd>${esc(o.nationality ?? "—")}</dd>
        ${o.subjectType === "organization" ? `<dt>الشكل النظامي</dt><dd>${esc(o.legalForm ?? "—")}</dd><dt>العنوان الوطني</dt><dd>${esc(o.nationalAddress ?? "—")}</dd>` : `<dt>تاريخ الميلاد</dt><dd>${both(o.birthDate)}</dd><dt>مكان الميلاد</dt><dd>${esc(o.birthPlace ?? "—")}</dd>`}
        <dt>نوع الهوية</dt><dd>${esc(o.idType ?? "—")}</dd>
        <dt>رقم الهوية</dt><dd class="tabular">${secret(o.idNumberEnc)}</dd>
        <dt>العنوان</dt><dd>${secret(o.addressEnc)}</dd>
        <dt>البيانات المصرفية</dt><dd>${secret(o.bankDetailsEnc)}</dd>
        <dt>وسيلة التواصل</dt><dd>${dec ? esc(o.contact ?? "—") : "محجوب"}</dd>
        <dt>تاريخ اكتساب الصفة</dt><dd>${both(o.acquiredOn)}</dd>
        <dt>العلاقة بالوقف</dt><dd>${esc(o.relationToWaqf ?? "—")}</dd>
        <dt>الاستحقاق</dt><dd>${esc(o.entitlementDesc ?? "—")}</dd>
        ${o.directors?.length ? `<dt>المديرون</dt><dd>${o.directors.map((d) => esc(d.name)).join("، ")}</dd>` : ""}
        <dt>مقيم في المملكة</dt><dd>${o.residesInKsa === null || o.residesInKsa === undefined ? "—" : o.residesInKsa ? "نعم" : "لا"}</dd>
        <dt>آخر تحقق</dt><dd>${both(o.verifiedOn)} ${o.verificationSource ? `<span class="small muted">(${esc(o.verificationSource)})</span>` : ""}</dd>
        <dt>التحقق القادم</dt><dd>${both(o.nextVerificationDue)}</dd>
      </dl>
    </div>`;
  return `
  ${cover(s.title, "سجل المستفيد الحقيقي وفق معايير المستفيد الحقيقي من الأوقاف (م5 وم6)", s.waqf.name, [
    ["رقم الحزمة", esc(meta.number)],
    ["رمز التحقق", esc(meta.verificationCode)],
    ["تاريخ الإعداد", both(s.generatedOn)],
    ["أعدّها", esc(meta.generatedBy ?? "—")],
    ["عدد السجلات", String(s.owners.length)],
  ], true)}
  ${s.waqf.isDemo ? `<div class="box seal" style="margin-top:8mm">بيانات تجريبية — لا تمثل أشخاصًا حقيقيين.</div>` : ""}
  ${dec ? "" : `<div class="box critical" style="margin-top:8mm">هذه نسخة محجوبة: الحقول المشفرة لا تظهر إلا لمن يملك صلاحية «عرض سجل المستفيد الحقيقي».</div>`}
  <div class="page-break"></div>
  <h2>السجل</h2>
  ${s.owners.length ? s.owners.map(owner).join("") : `<div class="box critical">لا توجد سجلات للمستفيد الحقيقي في ملف الوقف.</div>`}
  <p class="small muted" style="margin-top:8mm">سري: يُحفظ ويُتداول وفق سياسة السرية، ولا يُرسل إلا عبر القنوات الرسمية للهيئة.</p>`;
}

export const BO_PDF_CSS = `
body::before{content:"سري";position:fixed;top:40%;inset-inline-start:22%;font-size:110pt;font-weight:700;color:rgba(179,38,30,.07);transform:rotate(-30deg);z-index:0}
`;
