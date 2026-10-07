import "server-only";
import { gregorian, hijri, toISO } from "../../engines/dates";
import { pdfShell, PDF_PALETTE } from "../pdf/render";
import { PRINT_PALETTE, radarSvg, AXIS_SHORT } from "@/components/assessment/radar";
import { CONFIDENCE_LABEL, STATUS_VIEW, WAVE_HINT, WAVE_LABEL, waveDueDate } from "./facts";
import type { ResultBundle } from "./queries";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const SIZE: Record<string, string> = { large: "كبير", medium: "متوسط", small: "صغير", direct_benefit: "ذو انتفاع مباشر" };
const TYPE: Record<string, string> = { public: "عام (خيري)", private: "خاص (أهلي)", joint: "مشترك" };
const SEV: Record<string, [string, string]> = { critical: ["حرجة", "critical"], high: ["عالية", "fine"], medium: ["متوسطة", "seal"], low: ["منخفضة", "ink"] };
const TONE: Record<string, string> = { critical: "critical", fine: "fine", info: "ink", ok: "ok" };

const SEAL_SVG = `<svg viewBox="0 0 64 64" width="64" height="64" aria-hidden="true" style="color:${PDF_PALETTE.ink}"><circle cx="32" cy="32" r="29" fill="none" stroke="currentColor" stroke-width="2.5"/><circle cx="32" cy="32" r="23.5" fill="none" stroke="currentColor" stroke-width="1" stroke-dasharray="2 3"/><path d="M32 46V27" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/><path d="M32 33c-6.5 0-10-4-10.5-9.5 6 .2 10 3.3 10.5 9.5Z" fill="currentColor"/><path d="M32 28.5c5.8 0 9.2-3.6 9.7-8.6-5.4.2-9 3-9.7 8.6Z" fill="currentColor" opacity=".75"/><path d="M24 46h16" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>`;

const CSS = `
.cover{height:245mm;display:flex;flex-direction:column;justify-content:space-between;padding-top:8mm}
.cover h1{font-size:30pt;margin-top:18mm}
.cover .sub{font-size:14pt;color:var(--ink);font-weight:600}
.cover .meta{border-top:2px solid var(--seal);padding-top:6mm}
.score{display:flex;gap:16px;align-items:center}
.score .big{font-size:38pt;font-weight:700;color:var(--ink);line-height:1}
.bar{height:7px;background:#eef0ec;border-radius:4px;overflow:hidden;min-width:90px}
.bar>span{display:block;height:100%;background:var(--ink);border-radius:4px}
.bar.c>span{background:var(--critical)}
.rec{border:1px solid var(--line);border-radius:6px;padding:8px 10px;margin:6px 0;break-inside:avoid}
.rec.critical{border-inline-start:4px solid var(--critical)}
.rec h4{margin:0 0 4px;font-size:10.5pt}
.ref{color:var(--muted);font-size:8.5pt}
.radar{width:120mm;margin:0 auto}
`;

/** Full report HTML (cover, summary, radar, axes, flags, recommendations, references, disclaimer). All user data is escaped. */
export function assessmentReportHtml(b: ResultBundle, opts: { generatedAt?: Date } = {}): string {
  const computed = toISO(new Date(b.result.computedAt));
  const now = toISO(opts.generatedAt ?? new Date());
  const st = STATUS_VIEW[b.result.status] ?? STATUS_VIEW.stable;
  const subject = b.waqf?.name ?? b.row.waqfLabel ?? "وقف غير مسجّل في المنصة";
  const active = b.recs.filter((r) => r.status !== "suppressed" && r.status !== "dismissed");
  const totalW = b.axes.filter((a) => a.score !== null).reduce((s, a) => s + (a.weight ?? 0), 0) || 1;
  const refs = new Set<string>();
  for (const f of b.flags) if (f.referenceText) refs.add(f.referenceText);
  for (const r of active) if (r.reference) refs.add(r.reference);
  for (const w of b.result.weaknesses) if (w.reference) refs.add(w.reference);

  const cover = `
<section class="cover">
  <div>
    <div class="brandbar"></div>
    <div style="display:flex;align-items:center;gap:10px;margin-top:8mm">${SEAL_SVG}<span class="naskh" style="font-size:22pt;font-weight:700;color:${PDF_PALETTE.ink}">وقفك</span></div>
    <h1>تقرير التقييم الوقفي</h1>
    <p class="sub">${esc(subject)}</p>
    ${b.waqf ? `<p class="muted">رقم الملف: ${esc(b.waqf.internalNumber)}</p>` : ""}
  </div>
  <div class="meta">
    <dl class="kv">
      <dt>رقم التقييم</dt><dd class="tabular">${esc(b.number)}</dd>
      <dt>نوع التقييم</dt><dd>${b.row.kind === "deep" ? "معمّق" : "سريع"}${b.row.reviewedAt ? " — روجع من مختص" : ""}</dd>
      <dt>تاريخ الحساب</dt><dd>${esc(gregorian(computed))} م — ${esc(hijri(computed))}</dd>
      <dt>تاريخ إصدار التقرير</dt><dd>${esc(gregorian(now))} م — ${esc(hijri(now))}</dd>
    </dl>
    <p class="small muted" style="margin-top:6mm">تشخيص استرشادي مبني على إجابات المستخدم، وليس فتوى ولا رأيًا قانونيًا ملزمًا.</p>
  </div>
</section>`;

  const summary = `
<section class="page-break">
  <h2>الملخص</h2>
  <div class="score">
    <div><div class="big tabular">${Math.round(b.result.overallScore)}</div><div class="muted small">الدرجة الكلية من 100</div></div>
    <div style="flex:1">
      <p><span class="tag ${TONE[st.tone]}">الحالة: ${esc(st.label)}</span></p>
      <p>${esc(st.summary)}</p>
    </div>
  </div>
  <div class="grid2" style="margin-top:8px">
    <div class="box stone"><b>مؤشر النضج:</b> <span class="tabular">${Math.round(b.result.maturityScore)}</span> — ${esc(b.result.maturityLevel)}<br><span class="small muted">0.30 الحوكمة + 0.20 النظارة + 0.20 المالية + 0.15 الوثائق + 0.15 الرقمنة</span></div>
    <div class="box stone"><b>ثقة النتيجة:</b> ${esc(CONFIDENCE_LABEL[b.result.confidence] ?? b.result.confidence)}${b.completeness !== null ? ` <span class="small muted">(اكتمال ${Math.round(b.completeness * 100)}%)</span>` : ""}
      ${b.confidenceReasons.length ? `<br><span class="small muted">${b.confidenceReasons.map(esc).join(" ")}</span>` : ""}</div>
  </div>
  <p class="small">فئة الحجم: <b>${b.result.sizeClass ? SIZE[b.result.sizeClass] : "غير محددة"}</b> · النوع المستنتج: <b>${b.result.computedType ? TYPE[b.result.computedType] : "غير محدد"}</b> · علامات حرجة: <b>${b.flags.filter((f) => f.severity === "critical").length}</b> · توصيات: <b>${active.length}</b></p>
  ${b.computedTypeReason ? `<p class="small muted">${esc(b.computedTypeReason)}</p>` : ""}
  ${b.row.reviewedAt && b.review?.summary ? `<div class="box seal"><b>ملاحظات المختص:</b><br>${esc(b.review.summary).replace(/\n/g, "<br>")}</div>` : ""}

  <h2>المحاور</h2>
  <div class="radar">${radarSvg(b.axes.map((a) => ({ code: a.code, name: a.nameAr, score: a.score, capped: a.capped })), { palette: PRINT_PALETTE })}</div>
  <table>
    <thead><tr><th>المحور</th><th style="width:34%">الدرجة</th><th>الوزن</th><th>الإجابات</th></tr></thead>
    <tbody>
      ${b.axes.map((a) => `<tr><td>${esc(a.nameAr)}${a.capped ? `<br><span class="small" style="color:${PDF_PALETTE.critical}">سُقّف عند 39 بسبب علامة حرجة</span>` : ""}${b.review?.axes?.[a.code] ? `<br><span class="small"><b>ملاحظة المختص:</b> ${esc(b.review.axes[a.code])}</span>` : ""}</td>
        <td>${a.score === null ? '<span class="muted">لا ينطبق</span>' : `<div style="display:flex;gap:6px;align-items:center"><b class="tabular" style="width:24px">${Math.round(a.score)}</b><div class="bar${a.capped || a.score < 40 ? " c" : ""}" style="flex:1"><span style="width:${Math.max(2, a.score)}%"></span></div></div>`}</td>
        <td class="tabular">${a.score !== null && a.weight !== null ? Math.round(((a.weight ?? 0) / totalW) * 100) + "%" : "—"}</td>
        <td class="tabular">${a.answeredCount} / ${a.applicableCount}</td></tr>`).join("")}
    </tbody>
  </table>
</section>`;

  const flags = `
<section>
  <h2>العلامات الحرجة</h2>
  ${b.flags.length ? b.flags.map((f) => `<div class="box ${f.severity === "critical" ? "critical" : "seal"}"><b>${esc(f.titleAr)}</b>${f.severity !== "critical" ? " (تنبيه)" : ""}
    ${f.actionAr ? `<br>ما العمل: ${esc(f.actionAr)}` : ""}
    <br><span class="ref">المرجع: ${esc(f.referenceText)}${f.penaltyText ? ` — الجزاء المحتمل: ${esc(f.penaltyText)}${f.penaltyCode ? ` (بند ${esc(f.penaltyCode)})` : ""}` : ""}${f.axisCode ? ` — المحور: ${esc(AXIS_SHORT[f.axisCode] ?? f.axisCode)}` : ""}</span></div>`).join("") : `<p>لم تكشف الإجابات عن مخالفة جوهرية.</p>`}
</section>`;

  const recs = `
<section>
  <h2>التوصيات وخطة العمل</h2>
  ${[1, 2, 3].map((w) => {
    const items = active.filter((r) => r.wave === w);
    if (!items.length) return "";
    return `<h3>${WAVE_LABEL[w]} <span class="small muted">— ${WAVE_HINT[w]}، حتى ${esc(gregorian(waveDueDate(w, computed)))}</span></h3>
      ${items.map((r) => `<div class="rec${r.severity === "critical" ? " critical" : ""}">
        <h4>${esc(r.needTitle)} <span class="tag ${SEV[r.severity]?.[1] ?? "ink"}">${SEV[r.severity]?.[0] ?? r.severity}</span>${r.manual ? ' <span class="tag seal">أضافها المراجع</span>' : ""}</h4>
        <div>${esc(r.reasonAr)}${r.whyItMattersAr ? ` ${esc(r.whyItMattersAr)}` : ""}</div>
        ${r.services.length ? `<div class="small">الخدمة المناسبة: ${r.services.map((s) => `${esc(s.nameAr)} (${esc(s.code)})`).join("، ")}</div>` : ""}
        ${r.selfServiceHintAr ? `<div class="small" style="color:${PDF_PALETTE.olive}">تستطيع بنفسك: ${esc(r.selfServiceHintAr)}</div>` : ""}
        ${r.removed.length ? `<div class="ref">${r.removed.map((x) => `لم نقترح «${esc(x.nameAr)}»: ${esc(x.why)}`).join("<br>")}</div>` : ""}
        ${r.reference ? `<div class="ref">المرجع: ${esc(r.reference)}</div>` : ""}
      </div>`).join("")}`;
  }).join("") || "<p>لا توصيات مفتوحة.</p>"}
  ${b.pkg ? `<div class="box stone"><b>الباقة المقترحة: ${esc(b.pkg.nameAr)}</b> — تغطي ${b.pkg.covers} من الخدمات الموصى بها. ${esc(b.pkg.description ?? "")}</div>` : ""}
</section>`;

  const sw = `
<section>
  <h2>نقاط القوة والضعف</h2>
  <div class="grid2">
    <div><h3>نقاط القوة</h3>${b.result.strengths.length ? `<ul>${b.result.strengths.slice(0, 12).map((s) => `<li>${esc(s.text)} <span class="ref">(${esc(AXIS_SHORT[s.axis] ?? s.axis)})</span></li>`).join("")}</ul>` : "<p class=\"muted\">—</p>"}</div>
    <div><h3>نقاط الضعف</h3>${b.result.weaknesses.length ? `<ul>${b.result.weaknesses.slice(0, 12).map((s) => `<li>${esc(s.text)} <span class="ref">(${esc(AXIS_SHORT[s.axis] ?? s.axis)})</span></li>`).join("")}</ul>` : "<p class=\"muted\">—</p>"}</div>
  </div>
</section>`;

  const references = `
<section class="avoid-break">
  <h2>المراجع النظامية المذكورة</h2>
  <ul class="small">${[...refs].sort().map((r) => `<li>${esc(r)}</li>`).join("")}</ul>
</section>
<section class="box stone avoid-break" style="margin-top:10mm">
  <b>حدود هذا التقرير</b>
  <ul class="small">
    <li>تشخيص استرشادي، وليس فتوى شرعية ولا رأيًا قانونيًا ملزمًا.</li>
    <li>بُني على إجابات المستخدم كما أدخلها${b.row.reviewedAt ? "، وراجعه مختص من وقفك" : "، ولم يُتحقق منها بمستندات"}.</li>
    <li>المراجع مذكورة للاسترشاد؛ يُرجع إلى النص الرسمي النافذ عند التطبيق.</li>
    <li>للمراجعة البشرية: التقييم المعمّق أو طلب استشارة من مختص عبر المنصة.</li>
  </ul>
  <p class="ref">إصدار بنك الأسئلة وقواعد التوصيات محفوظ مع التقييم؛ إعادة الحساب بالإجابات نفسها تعطي النتيجة نفسها.</p>
</section>`;

  return pdfShell(`تقرير التقييم الوقفي ${b.number}`, cover + summary + flags + recs + sw + references, CSS);
}
