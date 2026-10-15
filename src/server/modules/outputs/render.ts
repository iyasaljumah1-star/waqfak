/**
 * HTML of an output version for the PDF (escaped; trusted structure). Status is printed on the document: drafts carry
 * a visible "draft — not approved" banner and never leave the team; the approved version names its approver.
 */
import type { OutputBlock, OutputSection } from "@/server/db/schema/operations";
import { PROV_LABEL } from "./pure";

const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const prov = (p?: string) => (p ? `<span class="prov">${esc(PROV_LABEL[p as keyof typeof PROV_LABEL] ?? p)}</span>` : "");

function block(b: OutputBlock, final: boolean): string {
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
      return `<div class="clause"><p><strong>${esc(b.n)}. ${esc(b.title)}</strong></p><p style="white-space:pre-line">${esc(b.text)}</p>${final ? "" : `<p class="small muted">${prov(b.text === b.generated ? b.prov : "specialist")}${b.refs?.length ? ` — ${esc(b.refs.join("؛ "))}` : ""}</p>`}</div>`;
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
  versionDate?: string; workflowStatus?: "draft" | "in_review" | "approved" | "preview";
};

const DOC_STATUS: Record<string, string> = { draft: "مسودة غير معتمدة", in_review: "بانتظار المراجعة والاعتماد", approved: "معتمد", preview: "معاينة من البيانات الحالية — لم تُحفظ مسودة" };

export function outputHtml(meta: OutputDocMeta, sections: OutputSection[]): string {
  const final = meta.status === "approved";
  const body = sections.filter((s) => !s.removed && s.key !== "meta").map((s) => `<h2>${esc(s.title)}</h2>${s.blocks.map((b) => block(b, final)).join("")}`).join("");
  return `<div class="brandbar"></div>
<h1>${esc(meta.title)}</h1>
<dl class="kv small">
${meta.workflowStatus === "preview" ? "" : `<dt>رقم المخرج</dt><dd dir="ltr" class="tabular">${esc(meta.number)} · v${meta.version}</dd>`}
<dt>الحالة</dt><dd>${esc(DOC_STATUS[meta.workflowStatus ?? (final ? "approved" : "draft")])}${final ? " — الاعتماد داخلي من «وقفك»، ولا يغني عن التوثيق لدى الجهة المختصة متى لزم" : ""}</dd>
${meta.versionDate ? `<dt>تاريخ النسخة</dt><dd class="tabular">${esc(meta.versionDate)}</dd>` : ""}
<dt>الخدمة</dt><dd>${esc(meta.serviceLine)}</dd>
<dt>الطلب</dt><dd dir="ltr" class="tabular">${esc(meta.requestNumber)}</dd>
${meta.waqfName ? `<dt>الوقف</dt><dd>${esc(meta.waqfName)}</dd>` : ""}
<dt>التخصص</dt><dd>${esc(meta.specialty)}</dd>
<dt>أعدّه</dt><dd>${esc(meta.preparedBy ?? "—")}</dd>
${meta.reviewRounds?.length ? `<dt>المراجعة</dt><dd>${meta.reviewRounds.map(esc).join("؛ ")}</dd>` : ""}
${final ? `<dt>راجعه واعتمده</dt><dd>${esc(meta.approvedBy ?? "—")}${meta.selfApproved ? " (اعتماد ذاتي وفق سياسة المخرج)" : ""} — ${esc(meta.approvedAt ?? "")}</dd>` : ""}
${meta.signedBy ? `<dt>التوقيع</dt><dd>${esc(meta.signedBy)}</dd>` : ""}
</dl>
${final ? "" : meta.workflowStatus === "preview" ? `<div class="box critical">معاينة غير محفوظة من بيانات الطلب الحالية — ليست مسودة ولا مخرجًا معتمدًا، ولا تُسلَّم للعميل. ما ينقص مبيّن في موضعه.</div>` : `<div class="box critical">مسودة داخلية غير معتمدة — لا تُسلَّم للعميل. الوسوم بجانب كل معلومة تبين مصدرها.</div>`}
${meta.isDemo ? `<div class="box critical">وقف تجريبي: البيانات اصطناعية.</div>` : ""}
${body}`;
}

export const OUTPUT_PDF_CSS = `.prov{font-size:9px;color:#7a6a3a;background:#f5eedf;border-radius:3px;padding:0 4px;white-space:nowrap}
tr.total td{border-top:2px solid #333}
.clause{margin:0 0 10px;page-break-inside:avoid}.clause p{margin:2px 0}
table.sign td.line{height:34px;min-width:110px;border-bottom:1px solid #333}`;
