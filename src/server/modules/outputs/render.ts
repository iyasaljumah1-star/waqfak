/**
 * HTML of an output version for the PDF (escaped; trusted structure). Status is printed on the document: drafts carry
 * a visible "draft — not approved" banner and never leave the team; the approved version names its approver.
 */
import type { OutputBlock, OutputGap, OutputSection } from "@/server/db/schema/operations";
import { CHECK_STATUS_AR } from "./checks";
import { citationOf } from "./citations";
import { PROV_LABEL } from "./pure";

const escRaw = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
/** Escapes text and keeps ISO dates (2019-05-14) left-to-right inside Arabic sentences, so none prints reversed. */
const esc = (s: unknown) => escRaw(s).replace(/\b\d{4}-\d{2}-\d{2}\b/g, (d) => `<bdi dir="ltr" class="tabular">${d}</bdi>`);
const prov = (p?: string) => (p ? `<span class="prov">${esc(PROV_LABEL[p as keyof typeof PROV_LABEL] ?? p)}</span>` : "");

function block(b: OutputBlock, final: boolean): string {
  if (final && b.type === "para" && b.internal) return "";
  switch (b.type) {
    case "para":
      return `<p style="white-space:pre-line">${esc(b.text)}${final ? "" : ` ${prov(b.prov)}`}</p>`;
    case "facts":
      return `<dl class="kv">${b.rows.map((r) => `<dt>${esc(r.label)}</dt><dd>${esc(r.value)}${final ? "" : ` ${prov(r.prov)}`}</dd>`).join("")}</dl>`;
    case "table":
      return `<table><thead><tr>${b.head.map((h) => `<th>${esc(h)}</th>`).join("")}</tr></thead><tbody>${b.rows.map((r) => `<tr>${r.map((x) => `<td>${esc(x)}</td>`).join("")}</tr>`).join("")}${b.total ? `<tr class="total">${b.total.map((x) => `<td><strong>${esc(x)}</strong></td>`).join("")}</tr>` : ""}</tbody></table>${final ? "" : `<p class="small muted">${prov(b.prov)}${b.ref ? ` — ${esc(b.ref)}` : ""}</p>`}`;
    case "list":
      return `<${b.ordered ? "ol" : "ul"}>${b.items.map((i) => `<li>${esc(i.text)}${final ? "" : ` ${prov(i.prov)}`}</li>`).join("")}</${b.ordered ? "ol" : "ul"}>`;
    case "specialist":
      return b.text.trim()
        ? `<p style="white-space:pre-line">${esc(b.text)}</p>`
        : `<div class="box critical">لم يُكتب بعد: ${esc(b.prompt)}</div>`;
    case "clause":
      return `<div class="clause"><p><strong>${esc(b.n)}. ${esc(b.title)}</strong></p><p style="white-space:pre-line">${esc(b.text)}</p>${final ? "" : `<p class="small muted">${prov(b.text === b.generated ? b.prov : "specialist")}${b.refs?.length ? ` — ${esc(b.refs.map((r) => { const c = citationOf(r); return c ? `${c.refCode} ${c.location}` : r; }).join("؛ "))}` : ""}</p>`}</div>`;
    case "checks":
      return `<table class="checks"><thead><tr><th>الفحص</th><th>النتيجة</th><th>السبب</th><th>البيانات والقاعدة</th></tr></thead><tbody>${b.items.map((c) => `<tr class="st-${esc(c.status)}"><td>${esc(c.label)}</td><td><strong>${esc(CHECK_STATUS_AR[c.status])}</strong><br><span class="small muted">${c.mode === "auto" ? "آلي" : "مهني"}</span></td><td>${esc(c.reason)}</td><td class="small">${esc(c.source)}<br>${esc(c.rule)}</td></tr>`).join("")}</tbody></table>`;
    case "signatures":
      return `<table class="sign"><thead><tr><th>الصفة</th><th>الاسم</th><th>التوقيع</th><th>التاريخ</th></tr></thead><tbody>${b.rows.map((r) => `<tr><td>${esc(r.role)}</td><td>${esc(r.name)}</td><td class="line"></td><td class="line"></td></tr>`).join("")}</tbody></table><p class="small muted">خانات توقيع تُستكمل عند التوثيق لدى الجهة المختصة أو بالإشهاد؛ لا تُعد توقيعًا إلكترونيًا.</p>`;
  }
}

export type OutputDocMeta = {
  number: string; title: string; specialty: string; serviceLine: string; requestNumber: string; waqfName: string | null; version: number; status: string;
  preparedBy: string | null; approvedBy: string | null; approvedAt: string | null; selfApproved: boolean; signedBy: string | null; isDemo: boolean;
  /** Earlier review rounds (who returned the draft for revision, and when). */
  reviewRounds?: string[];
  /** Date of this version, and where it stands: draft, under review, or approved. */
  versionDate?: string; workflowStatus?: "draft" | "in_review" | "approved" | "preview" | "client_preview";
  /** Gaps and conflicts of the version (printed at the top of a draft; never on the approved copy). */
  gaps?: OutputGap[];
  /**
   * «client»: the copy released to the client — no review rounds, staff names, output number or internal version, and
   * no internal service code. «internal» (default): the team's copy with its full record.
   */
  audience?: "client" | "internal";
  /** A drafted legal document (deed, will): printed with the notice that it is a draft until documented officially. */
  legalDraft?: boolean;
  /** Service name without its catalog code (for the client copy). */
  serviceName?: string;
};

/** What a drafted deed or will is, printed at the top of every copy (internal approval ≠ documentation). */
export const LEGAL_DRAFT_NOTICE = "مسودة للمراجعة قبل التوثيق: لا تكون هذه الوثيقة نافذة ولا موثقة إلا بعد إجرائها لدى الجهة المختصة. اعتماد «وقفك» لها اعتماد داخلي لجودة الصياغة ومطابقتها لبيانات الطلب، وليس توثيقًا ولا حكمًا شرعيًا أو قضائيًا.";

const NEED_AR: Record<string, string> = { mandatory: "إلزامي", optional: "اختياري", review: "يقرره المختص" };

function gapReport(gaps: OutputGap[]) {
  if (!gaps.length) return "";
  const conflicts = gaps.filter((g) => g.kind === "conflict");
  const rest = gaps.filter((g) => g.kind !== "conflict");
  return `<div class="box gapreport"><p><strong>تقرير النواقص والتعارضات (${gaps.length})</strong></p>
${conflicts.length ? `<p><strong>تعارضات لا تُحسم آليًا:</strong></p><ul>${conflicts.map((g) => `<li>${esc(g.label)}${g.sides?.length ? `<br><span class="small">${g.sides.map((s) => `${esc(s.label)}: «${esc(s.value)}» (${esc(s.source)})`).join(" ↔ ")}</span>` : ""}${g.hint ? `<br><span class="small muted">المطلوب: ${esc(g.hint)}</span>` : ""}</li>`).join("")}</ul>` : ""}
${rest.length ? `<ul>${rest.map((g) => `<li>${esc(g.label)} — <span class="small">${esc(NEED_AR[g.need ?? (g.severity === "blocking" ? "mandatory" : "optional")])}</span></li>`).join("")}</ul>` : ""}</div>`;
}

const DOC_STATUS: Record<string, string> = { client_preview: "مسودة للاطلاع وإبداء الملاحظات — لم تُعتمد بعد", draft: "مسودة غير معتمدة", in_review: "بانتظار المراجعة والاعتماد", approved: "معتمد", preview: "معاينة من البيانات الحالية — لم تُحفظ مسودة" };

export function outputHtml(meta: OutputDocMeta, sections: OutputSection[]): string {
  const final = meta.status === "approved";
  const client = meta.audience === "client";
  // the approved copy goes to the client: internal review material (checks, notes) stays out of it
  const body = sections.filter((s) => !s.removed && s.key !== "meta" && !((final || client) && s.audience === "internal")).map((s) => `<h2>${esc(s.title)}</h2>${s.blocks.map((b) => block(b, final || client)).join("")}`).join("");
  // what specialist review this copy actually carries: a signature recorded on the delivery, or none — never assumed
  const review = meta.signedBy ? `مراجعة موقّعة: ${esc(meta.signedBy)}` : "لم تُرفق بهذه النسخة مراجعة شرعية أو قانونية موقّعة.";
  return `<div class="brandbar"></div>
<h1>${esc(meta.title)}</h1>
${meta.legalDraft ? `<div class="box notice"><strong>${esc(LEGAL_DRAFT_NOTICE)}</strong></div>` : ""}
<dl class="kv small">
${meta.workflowStatus === "preview" || client ? "" : `<dt>رقم المخرج</dt><dd dir="ltr" class="tabular">${escRaw(meta.number)} · v${meta.version}</dd>`}
<dt>الحالة</dt><dd>${client ? (final ? "اعتُمدت داخليًا في «وقفك»" : esc(DOC_STATUS[meta.workflowStatus ?? "draft"])) : esc(DOC_STATUS[meta.workflowStatus ?? (final ? "approved" : "draft")])}${final ? " — الاعتماد داخلي من «وقفك»، ولا يغني عن التوثيق لدى الجهة المختصة" : ""}</dd>
${meta.versionDate ? `<dt>تاريخ النسخة</dt><dd>${esc(meta.versionDate)}</dd>` : ""}
<dt>الخدمة</dt><dd>${esc(client ? meta.serviceName ?? meta.serviceLine : meta.serviceLine)}</dd>
<dt>الطلب</dt><dd dir="ltr" class="tabular">${escRaw(meta.requestNumber)}</dd>
${meta.waqfName ? `<dt>الوقف</dt><dd>${esc(meta.waqfName)}</dd>` : ""}
<dt>التخصص</dt><dd>${esc(meta.specialty)}</dd>
${client ? "" : `<dt>أعدّه</dt><dd>${esc(meta.preparedBy ?? "—")}</dd>`}
${!client && meta.reviewRounds?.length ? `<dt>المراجعة</dt><dd>${meta.reviewRounds.map(esc).join("؛ ")}</dd>` : ""}
${final ? (client ? `<dt>تاريخ الاعتماد الداخلي</dt><dd>${esc(meta.approvedAt ?? "")}</dd>` : `<dt>راجعه واعتمده</dt><dd>${esc(meta.approvedBy ?? "—")}${meta.selfApproved ? " (اعتماد ذاتي وفق سياسة المخرج)" : ""} — ${esc(meta.approvedAt ?? "")}</dd>`) : ""}
${meta.legalDraft ? `<dt>المراجعة المتخصصة</dt><dd>${review}</dd>` : meta.signedBy ? `<dt>التوقيع</dt><dd>${esc(meta.signedBy)}</dd>` : ""}
</dl>
${client && !final ? `<div class="box critical">مسودة للاطلاع وإبداء الملاحظات: لم تُعتمد بعد، وقد تتغير بعد ملاحظاتك ومراجعة الفريق.</div>` : ""}
${final || client ? "" : meta.workflowStatus === "preview" ? `<div class="box critical">معاينة غير محفوظة من بيانات الطلب الحالية — ليست مسودة ولا مخرجًا معتمدًا، ولا تُسلَّم للعميل. ما ينقص مبيّن في موضعه.</div>` : `<div class="box critical">مسودة داخلية غير معتمدة — لا تُسلَّم للعميل. الوسوم بجانب كل معلومة تبين مصدرها.</div>`}
${meta.isDemo ? `<div class="box critical">وقف تجريبي: البيانات اصطناعية.</div>` : ""}
${final || client ? "" : gapReport(meta.gaps ?? [])}
${body}`;
}

export const OUTPUT_PDF_CSS = `.notice{border:2px solid #9a6b1f;background:#fbf3e2;page-break-inside:avoid}
.prov{font-size:9px;color:#7a6a3a;background:#f5eedf;border-radius:3px;padding:0 4px;white-space:nowrap}
tr.total td{border-top:2px solid #333}
.clause{margin:0 0 10px;page-break-inside:avoid}.clause p{margin:2px 0}
table.sign td.line{height:34px;min-width:110px;border-bottom:1px solid #333}
table.checks td{vertical-align:top;font-size:10.5px}table.checks tr{page-break-inside:avoid}
tr.st-failed td:nth-child(2){color:#9b1c1c}tr.st-verified td:nth-child(2){color:#1d5e3a}tr.st-specialist td:nth-child(2){color:#7a5a12}
.gapreport{border:1px solid #c9a227;background:#fbf6e6;page-break-inside:avoid}.gapreport ul{margin:4px 0;padding-inline-start:18px}
h2{page-break-after:avoid}table{page-break-inside:auto}tr{page-break-inside:avoid}`;
