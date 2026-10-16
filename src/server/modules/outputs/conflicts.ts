/**
 * Conflicts between the data a document rests on (PURE): the client's answers among themselves, answers against the
 * waqf file, and answers against the documents attached (their recorded number). A conflict never picks a value: it
 * names the fields, the value from each source, and what must be done; the generator writes a placeholder instead of
 * either value. Material conflicts block sending for review and approval until the data is corrected at its source.
 *
 * Rules are declared once: common rules (all services) and service rules (keyed by service code).
 */

export type ConflictSide = { field: string; label: string; value: string; source: string };
export type Conflict = {
  key: string;
  label: string;
  severity: "material" | "minor";
  sides: ConflictSide[];
  /** What must be done to resolve it (at the source of the data). */
  action: string;
  /** Fields of the form to correct (anchors on the request page). */
  fields: string[];
};

export type ConflictInput = {
  serviceCode: string;
  keys: Record<string, string>;
  tables: Record<string, Record<string, string>[]>;
  /** Visible field labels (key → label) and option labels (key → value → label). */
  labels: Record<string, string>;
  options: Record<string, Record<string, string>>;
  requester: { name: string; capacityKey: string | null };
  /** Documents attached to the form's slots, with what was recorded about them. */
  docs: { slot: string; title: string; number: string | null; issuedOn: string | null }[];
  /** The linked waqf file's values, by the form's prefill source (e.g. "waqf.deedNo" → "1234"). */
  waqf: Record<string, string | null> | null;
  /** Fields of the form that are prefilled from the waqf file (field → "waqf.x"). */
  prefills: Record<string, string>;
};

const norm = (s: string | null | undefined) => (s ?? "").replace(/[ً-ْـ]/g, "").replace(/[أإآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim().toLowerCase();
const digits = (s: string | null | undefined) => (s ?? "").replace(/[٠-٩]/g, (d) => String("٠١٢٣٤٥٦٧٨٩".indexOf(d))).replace(/\D/g, "");
const opt = (x: ConflictInput, field: string, v: string | undefined) => (v ? x.options[field]?.[v] ?? v : "—");
const label = (x: ConflictInput, field: string, fallback: string) => x.labels[field] ?? fallback;
const FORM = "إجابة العميل في نموذج الطلب";

type Rule = (x: ConflictInput) => Conflict[];

/** A recorded document number against the answer that should match it. */
const docNumberRule = (slot: string, field: string, what: string): Rule => (x) => {
  const doc = x.docs.find((d) => d.slot === slot && d.number?.trim());
  const ans = x.keys[field];
  if (!doc || !ans || digits(doc.number) === digits(ans) || !digits(ans) || !digits(doc.number)) return [];
  return [{
    key: `doc_number:${slot}:${field}`, label: `${what}: الرقم في الإجابة يخالف الرقم المسجل للمستند المرفق`, severity: "material",
    sides: [{ field, label: label(x, field, what), value: ans, source: FORM }, { field: `doc:${slot}`, label: `رقم «${doc.title}»`, value: doc.number!, source: "بيانات المستند المرفق في الطلب" }],
    action: "يُطابق الرقم مع المستند: تُصحَّح الإجابة، أو تُصحَّح بيانات المستند، أو يُستبدل المستند إن كان غير المقصود.", fields: [field],
  }];
};

/** Whose name a document is written in, per service (for the applicant's capacity checks). */
const SUBJECT_NAME: Record<string, { field: string; what: string }> = {
  W01: { field: "testatorName", what: "الموصي" },
  T03: { field: "waqifName", what: "الواقف" },
};

const COMMON: Rule[] = [
  // answers prefilled from the waqf file and changed against it
  (x) => {
    if (!x.waqf) return [];
    const out: Conflict[] = [];
    for (const [field, src] of Object.entries(x.prefills)) {
      const ans = x.keys[field]?.trim();
      const file = x.waqf[src]?.toString().trim();
      if (!ans || !file || norm(ans) === norm(file) || (digits(ans) && digits(ans) === digits(file))) continue;
      out.push({
        key: `waqf_file:${field}`, label: `«${label(x, field, field)}» في الطلب يخالف ملف الوقف`, severity: "material",
        sides: [{ field, label: label(x, field, field), value: ans, source: FORM }, { field: src, label: label(x, field, field), value: file, source: "ملف الوقف في المنصة" }],
        action: "يُتحقق من المستند الرسمي: تُصحَّح إجابة الطلب، أو يُحدَّث ملف الوقف بمستنده إن كانت الإجابة هي الصحيحة.", fields: [field],
      });
    }
    return out;
  },
  // the applicant says he is the person the document is written for, under another name
  (x) => {
    const subj = SUBJECT_NAME[x.serviceCode];
    if (!subj) return [];
    const name = x.keys[subj.field]?.trim();
    if (!name) return [];
    if (x.requester.capacityKey === "agent" && x.keys.principalName?.trim() && norm(x.keys.principalName) !== norm(name))
      return [{
        key: "applicant:principal_vs_subject", label: `اسم صاحب الشأن في الوكالة يخالف اسم ${subj.what}`, severity: "material",
        sides: [{ field: "principalName", label: label(x, "principalName", "اسم صاحب الشأن"), value: x.keys.principalName, source: FORM }, { field: subj.field, label: label(x, subj.field, `اسم ${subj.what}`), value: name, source: FORM }],
        action: `يُطابق الاسمان مع الوكالة وهوية ${subj.what}، وتُصحَّح الإجابة المخالفة.`, fields: ["principalName", subj.field],
      }];
    if (x.requester.capacityKey === "waqif" && x.keys.contactName?.trim() && norm(x.keys.contactName) !== norm(name))
      return [{
        key: "applicant:self_vs_subject", label: `مقدّم الطلب بصفته ${subj.what} واسمه يخالف اسم ${subj.what} في النموذج`, severity: "material",
        sides: [{ field: "contactName", label: label(x, "contactName", "الاسم الكامل"), value: x.keys.contactName, source: FORM }, { field: subj.field, label: label(x, subj.field, `اسم ${subj.what}`), value: name, source: FORM }],
        action: `إن كان مقدّم الطلب ينوب عن ${subj.what} فتُصحَّح صفته إلى «وكيل» وتُرفق الوكالة، وإلا يُصحَّح الاسم المخالف.`, fields: ["capacity", subj.field],
      }];
    return [];
  },
];

const SERVICE: Record<string, Rule[]> = {
  W01: [
    // waqf after death: the answer and the bequest table must agree
    (x) => {
      const rows = (x.tables.bequests ?? []).map((r, i) => ({ r, i })).filter(({ r }) => r.kind === "waqf");
      if (x.keys.includesWaqf === "no" && rows.length)
        return [{
          key: "will:waqf_answer_vs_bequests", label: "تعارض في الوقف بعد الوفاة: في جدول الوصايا وقف بعد الوفاة، والإجابة أن الوصايا لا تتضمن وقفًا", severity: "material",
          sides: [
            { field: "includesWaqf", label: label(x, "includesWaqf", "هل في وصاياك وقف بعد الوفاة؟"), value: opt(x, "includesWaqf", "no"), source: FORM },
            ...rows.map(({ r, i }) => ({ field: "bequests", label: `جدول الوصايا — الصف ${i + 1} (نوع الوصية)`, value: `${opt(x, "bequests.kind", r.kind)}${r.basis === "share" && r.percent ? ` بنسبة ${r.percent}٪ من التركة` : ""} — ${r.recipient ?? ""}`.trim(), source: FORM })),
          ],
          action: "يُسأل العميل أي القيمتين مقصودة، ثم تُصحَّح إما الإجابة «هل في وصاياك وقف بعد الوفاة؟» أو نوع الوصية في الجدول. لا تُختار قيمة نيابة عنه.",
          fields: ["includesWaqf", "bequests"],
        }];
      if (x.keys.includesWaqf === "yes" && !rows.length && (x.tables.bequests ?? []).length)
        return [{
          key: "will:waqf_answer_without_row", label: "تعارض في الوقف بعد الوفاة: الإجابة أن الوصايا تتضمن وقفًا، ولا صف «وقف بعد الوفاة» في جدول الوصايا", severity: "material",
          sides: [
            { field: "includesWaqf", label: label(x, "includesWaqf", "هل في وصاياك وقف بعد الوفاة؟"), value: opt(x, "includesWaqf", "yes"), source: FORM },
            { field: "bequests", label: "جدول الوصايا", value: (x.tables.bequests ?? []).map((r) => opt(x, "bequests.kind", r.kind)).join("، "), source: FORM },
          ],
          action: "يُضاف صف الوقف بمقداره في جدول الوصايا، أو تُصحَّح الإجابة إن لم يكن في الوصايا وقف.", fields: ["includesWaqf", "bequests"],
        }];
      return [];
    },
    // v3: the chosen type of will against the bequests table
    (x) => {
      if (!x.keys.willType) return [];
      const all = x.tables.bequests ?? [];
      const rows = all.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === "waqf");
      const typeSide = { field: "willType", label: label(x, "willType", "نوع الوصية"), value: opt(x, "willType", x.keys.willType), source: FORM };
      if (x.keys.willType === "pure" && rows.length)
        return [{
          key: "will:type_vs_bequests", label: "تعارض في نوع الوصية: اختيرت وصية خالصة لا تتضمن وقفًا، وفي جدول الوصايا وقف بعد الوفاة", severity: "material",
          sides: [typeSide, ...rows.map(({ r, i }) => ({ field: "bequests", label: `جدول الوصايا — الصف ${i + 1} (نوع الوصية)`, value: `${opt(x, "bequests.kind", r.kind)}${r.basis === "share" && r.percent ? ` بنسبة ${r.percent}٪ من التركة` : ""} — ${r.recipient ?? ""}`.trim(), source: FORM }))],
          action: "يُسأل العميل أي القيمتين مقصودة: تُصحَّح نوع الوصية إلى «تتضمن وقفًا» مع بيانات الوقف، أو يُصحَّح نوع الصف في الجدول. لا تُختار قيمة نيابة عنه.",
          fields: ["willType", "bequests"],
        }];
      if (x.keys.willType === "with_waqf" && all.length && !rows.length)
        return [{
          key: "will:type_without_row", label: "تعارض في نوع الوصية: اختيرت وصية تتضمن وقفًا بعد الوفاة، ولا صف «وقف بعد الوفاة» في جدول الوصايا", severity: "material",
          sides: [typeSide, { field: "bequests", label: "جدول الوصايا", value: all.map((r) => opt(x, "bequests.kind", r.kind)).join("، "), source: FORM }],
          action: "يُضاف صف الوقف بمقداره في جدول الوصايا، أو يُصحَّح نوع الوصية إلى «خالصة».", fields: ["willType", "bequests"],
        }];
      return [];
    },
    // a previous will said not to exist, while one is attached
    (x) => (x.keys.hasPreviousWill === "no" && x.docs.some((d) => d.slot === "previousWill")
      ? [{
          key: "will:previous_attached", label: "أُجيب بعدم وجود وصية سابقة، ومرفق في الطلب مستند «الوصية السابقة»", severity: "material",
          sides: [
            { field: "hasPreviousWill", label: label(x, "hasPreviousWill", "هل لك وصية سابقة؟"), value: opt(x, "hasPreviousWill", "no"), source: FORM },
            { field: "doc:previousWill", label: "مستند الوصية السابقة", value: x.docs.find((d) => d.slot === "previousWill")!.title, source: "مستند مرفق في الطلب" },
          ],
          action: "يُتحقق من المستند: إن كانت هناك وصية سابقة تُصحَّح الإجابة ويُحدد حكمها (إلغاء أو تعديل)، وإلا يُزال المستند.", fields: ["hasPreviousWill"],
        }]
      : []),
    // the testator cannot be a witness of his own will
    (x) => {
      const tid = digits(x.keys.testatorId);
      const w = (x.tables.witnesses ?? []).map((r, i) => ({ r, i })).filter(({ r }) => (tid && digits(r.id) === tid) || (norm(r.name) && norm(r.name) === norm(x.keys.testatorName)));
      return w.length ? [{
        key: "will:testator_as_witness", label: "الموصي مسجل شاهدًا على وصيته", severity: "material",
        sides: [
          { field: "testatorName", label: label(x, "testatorName", "اسم الموصي"), value: `${x.keys.testatorName ?? "—"} (${x.keys.testatorId ?? "—"})`, source: FORM },
          ...w.map(({ r, i }) => ({ field: "witnesses", label: `الشاهد ${i + 1}`, value: `${r.name ?? "—"} (${r.id ?? "—"})`, source: FORM })),
        ],
        action: "يُصحَّح جدول الشهود بشاهد غير الموصي.", fields: ["witnesses"],
      }] : [];
    },
    // amounts above the estate the client estimated
    (x) => {
      const estate = Number(x.keys.estimatedEstate);
      const amounts = (x.tables.bequests ?? []).filter((r) => r.basis === "amount").reduce((s, r) => s + (Number(r.amount) || 0), 0);
      return estate > 0 && amounts > estate ? [{
        key: "will:amounts_over_estate", label: "مجموع الوصايا بالمبالغ يتجاوز تقدير التركة الذي أدخله العميل", severity: "material",
        sides: [
          { field: "estimatedEstate", label: label(x, "estimatedEstate", "تقدير إجمالي التركة"), value: `${estate.toLocaleString("en-US")} ر.س`, source: FORM },
          { field: "bequests", label: "مجموع المبالغ في جدول الوصايا", value: `${amounts.toLocaleString("en-US")} ر.س`, source: "محسوب من إجابات العميل" },
        ],
        action: "يُراجع العميل تقدير التركة أو مبالغ الوصايا.", fields: ["estimatedEstate", "bequests"],
      }] : [];
    },
    docNumberRule("testatorId", "testatorId", "هوية الموصي"),
  ],
  T03: [
    docNumberRule("ownership", "ownershipDeedNo", "صك ملكية الأصل"),
    docNumberRule("waqifId", "waqifId", "هوية الواقف"),
  ],
};

/** All conflicts in the data of a request (common rules + the service's own). */
export function detectConflicts(x: ConflictInput): Conflict[] {
  const out: Conflict[] = [];
  for (const r of [...COMMON, ...(SERVICE[x.serviceCode] ?? [])]) for (const c of r(x)) if (!out.some((o) => o.key === c.key)) out.push(c);
  return out;
}

export const CONFLICT_SERVICES = Object.keys(SERVICE);
