/**
 * Study of a request to appoint a nazir, in particular a legal person (company or other entity), and preparation of
 * the file and a draft request to the competent body. Pure: no database, no network, no model.
 *
 * Governing rule of the order: «لا يُحظر ما لم يرد بحظره نص، ولا يُفترض الترخيص أو التعيين دون مستنده، ولا يُعطّل حق
 * الواقف في اختيار الناظر بسبب غياب إجراء تنفيذي لم يثبت صدوره أو تفعيله.»
 *
 * Accordingly:
 *  - the result is never a rejection: every request comes out «processable with human review»;
 *  - the company is never stated to be the nazir unless an appointment document is recorded; filing the request or
 *    signing a management contract does not make it one;
 *  - each basis is labelled by its source: the text (نص), the founder's condition (شرط الواقف), a decision of the
 *    competent body (قرار الجهة المختصة), or a matter not settled by any published rule (غير محسوم تنظيميًا);
 *  - the licensing requirement of NZR art. 5/2 is stated as written, with the fact that its procedure is not published
 *    and the authority says it is still under study: a regulatory follow-up, not a prohibition. No condition of the
 *    licence is invented and no decision is attributed to the authority;
 *  - quotations are taken verbatim from the stored official snapshots (checked by the tests) and carry their citation
 *    state: none of them is citable to a client until the citation guard authorises it.
 */
import type { CitationResult } from "./citation";

export type BasisKind = "text" | "founder_condition" | "authority_decision" | "unresolved";
export const BASIS_AR: Record<BasisKind, string> = {
  text: "ثابت بالنص",
  founder_condition: "ثابت بشرط الواقف",
  authority_decision: "يثبت بقرار الجهة المختصة",
  unresolved: "غير محسوم تنظيميًا",
};

/** A verbatim quotation from a stored snapshot. `snapshot` is the manifest id; `quote` must occur in it. */
export type Quote = { refId: string; locator: string; snapshot: string; quote: string };

export const Q = {
  definitionCompetentBody: { refId: "NZR", locator: "م1 (تعريف الجهة المختصة)", snapshot: "NZR/uqn-p18926", quote: "هي الجهة المعنية بتوثيق الوقف وتعيين الناظر وإصدار الأذونات على التصرفات على أصول الوقف وفق الأنظمة واللوائح والقرارات المعمول بها في المملكة." },
  founderMayAppoint: { refId: "NZR", locator: "م4/ف1", snapshot: "NZR/uqn-p18926", quote: "يجوز للواقف أن يتولى النظارة على وقفه وله تعيين ناظر باسمه أو وصفه وفق الأحكام الواردة في (المادة الخامسة) من هذه اللائحة." },
  successor: { refId: "NZR", locator: "م4/ف2", snapshot: "NZR/uqn-p18926", quote: "للواقف تحديد من يتولى النظارة بعد الناظر المعين سواءً بالاسم أو الوصف، ويدون ذلك في وثيقة الوقف." },
  delegatedAppointment: { refId: "NZR", locator: "م4/ف3", snapshot: "NZR/uqn-p18926", quote: "للواقف إسناد تعيين الناظر لمن شاء من ذريته أو غيرهم، وعلى من أُسندت إليه مهمة تعيين الناظر الالتزام بشرط الواقف وهذه اللائحة وتوثيق التعيين لدى الجهة المختصة فوراً." },
  consent: { refId: "NZR", locator: "م4/ف4", snapshot: "NZR/uqn-p18926", quote: "يجب على الواقف أو من أسندت إليه مهمة تعيين الناظر؛ الحصول على موافقة الشخص قبل تعيينه ناظراً." },
  vacancy: { refId: "NZR", locator: "م4/ف5", snapshot: "NZR/uqn-p18926", quote: "إذا شغر منصب الناظر وانقطعت تسمية الواقف أو تعذر عليه تسميته؛ فللهيئة أو من له الصفة استكمال إجراءات تعيين الناظر لدى الجهة المختصة على أن يكون من النظار المقيدين في سجل قيد النظار وبما لا يتعارض مع شرط الواقف." },
  decisionContents: { refId: "NZR", locator: "م4/ف6", snapshot: "NZR/uqn-p18926", quote: "يجب أن يتضمن قرار تسمية الناظر صلاحياته وأتعابه ومسؤولياته." },
  naturalOrLegal: { refId: "NZR", locator: "م5", snapshot: "NZR/uqn-p18926", quote: "يجوز أن يكون الناظر شخصاً طبيعياً أو اعتبارياً" },
  licensed: { refId: "NZR", locator: "م5/ف2", snapshot: "NZR/uqn-p18926", quote: "يُشترط لتعيين الشخص الاعتباري أن يكون مرخصاً من الهيئة." },
  bodyVerifies: { refId: "NZR", locator: "م5 (الفقرة الختامية)", snapshot: "NZR/uqn-p18926", quote: "وتتحقق الجهة المختصة من توافر كافة الشروط الواردة في هذه المادة في الشخص قبل تعيينه ناظراً." },
  delegationOfManagement: { refId: "NZR", locator: "م11/ف4", snapshot: "NZR/uqn-p18926", quote: "تفويض بعض أعمال النظارة -بما لا يخالف شرط الواقف- إلى شخص آخر" },
  licensingUnderStudy: { refId: "NZR-LIC", locator: "الأسئلة الشائعة: «ما هي متطلبات وإجراءات الترخيص للجهات الاعتبارية لممارسة نشاط النظارة؟»", snapshot: "NZR-LIC/awqaf-faq-109", quote: "تعمل الهيئة حاليًا على دراسة آلية نموذجية متكاملة لترخيص الأشخاص الاعترابيين لتولي أعمال النظارة على الأوقاف" },
  unknownWaqfCourt: { refId: "IHY", locator: "م13/ف1", snapshot: "IHY/uqn-4001990", quote: "تتقدم الهيئة إلى المحكمة المختصة بطلب تعيين ناظر على الوقف المجهول" },
  boCorporate: { refId: "BO-STD", locator: "م4/ف2", snapshot: "BO-STD/awqaf-2025-12", quote: "إذا كان الواقف أو الناظر شخصاً اعتبارياً، فيعد مالك الشخص الاعتباري أو مديره أو أعضاء مجلس إدارته - بحسب الأحوال - المستفيد الحقيقي." },
} satisfies Record<string, Quote>;

export type AppointmentCase = {
  candidate: {
    kind: "natural" | "legal";
    /** Written consent of the candidate (NZR 4/4). null = not known. */
    consentDocumented: boolean | null;
    /** For a legal person: which documents of the entity are in the file. */
    entityDocs?: { registration: boolean; boardResolution: boolean; signatoryAuthority: boolean; ownersAndManagers: boolean };
  };
  founder: {
    alive: boolean | null;
    /** What the founder's condition says about the nazara, as read from the waqf document. */
    condition: "names_candidate" | "describes_candidate" | "delegates_appointment" | "silent" | "unknown";
    waqfDocumented: boolean | null;
  };
  seat: "first_appointment" | "vacant" | "replacement" | "additional";
  waqfStatus: "known" | "unknown";
  /** Recorded only from a document: the decision or deed that appoints the nazir. */
  appointmentDocument: { issuer: string; number: string; dateHijri: string } | null;
  /** Recorded only from a document issued by the authority. */
  licence: { number: string; dateHijri: string } | null;
  managementContract: boolean;
};

export type Basis = { kind: BasisKind; statement: string; quote: Quote | null; citation: CitationResult | null };
export type Step = { order: number; title: string; actor: string; kind: BasisKind; note?: string };
export type CheckItem = { item: string; kind: BasisKind; present: boolean | null; quote: Quote | null };

export type AppointmentStudy = {
  outcome: "processable_with_human_review";
  appointment: { established: boolean; statement: string };
  path: Step[];
  bases: Basis[];
  checklist: CheckItem[];
  attachments: string[];
  draftRequest: { addressee: string; title: string; body: string[]; disclaimer: string };
  regulatoryFollowUps: { refId: string; statement: string; effect: "follow_up_not_prohibition" }[];
  humanReview: string[];
};

/** Phrases that must not appear in any output of this module unless an appointment document is recorded. */
export const APPOINTED_CLAIMS = ["تم تعيين", "عُيّنت", "عينت ناظرًا", "أصبحت ناظرًا", "أصبحت الشركة ناظر", "الشركة هي الناظر", "بصفتها ناظر الوقف", "الناظر المعين"];

const COMPETENT = "الجهة المختصة بتوثيق الوقف وتعيين الناظر";

export function studyAppointment(c: AppointmentCase, citeFn: (q: Quote) => CitationResult | null = () => null): AppointmentStudy {
  const basis = (kind: BasisKind, statement: string, quote: Quote | null): Basis => ({ kind, statement, quote, citation: quote ? citeFn(quote) : null });
  const legal = c.candidate.kind === "legal";
  const established = c.appointmentDocument !== null;

  const bases: Basis[] = [];
  bases.push(basis("text", "النظارة تجوز للشخص الطبيعي وللشخص الاعتباري؛ لم يرد نص يقصرها على الشخص الطبيعي.", Q.naturalOrLegal));
  if (c.founder.condition === "names_candidate" || c.founder.condition === "describes_candidate")
    bases.push(basis("founder_condition", "شرط الواقف يسمي المرشح أو يصفه؛ يُحترم اختيار الواقف، ويبقى التحقق من الشروط والتوثيق للجهة المختصة.", Q.founderMayAppoint));
  else if (c.founder.condition === "delegates_appointment")
    bases.push(basis("founder_condition", "الواقف أسند التعيين إلى غيره؛ على من أُسند إليه التعيين الالتزام بالشرط وتوثيق التعيين لدى الجهة المختصة.", Q.delegatedAppointment));
  else
    bases.push(basis("authority_decision", "لا يتضح من الملف شرط للواقف في الناظر؛ التعيين يُستكمل لدى الجهة المختصة.", c.seat === "vacant" ? Q.vacancy : null));
  if (c.founder.alive === true && c.founder.condition !== "delegates_appointment")
    bases.push(basis("text", "للواقف الحي أن يتولى النظارة أو يعين ناظرًا باسمه أو وصفه.", Q.founderMayAppoint));
  bases.push(basis("text", "موافقة المرشح مكتوبة قبل تعيينه.", Q.consent));
  bases.push(basis("authority_decision", "الجهة المختصة تتحقق من شروط المادة الخامسة قبل التعيين؛ ولا يثبت التعيين إلا بوثيقته.", Q.bodyVerifies));
  bases.push(basis("text", "قرار تسمية الناظر يتضمن صلاحياته وأتعابه ومسؤولياته.", Q.decisionContents));
  if (c.waqfStatus === "unknown") bases.push(basis("authority_decision", "الوقف المجهول: تتقدم الهيئة إلى المحكمة المختصة بطلب تعيين الناظر.", Q.unknownWaqfCourt));
  if (legal) {
    bases.push(basis("text", "يشترط النص ترخيص الهيئة لتعيين الشخص الاعتباري.", Q.licensed));
    bases.push(basis("unresolved", "إجراءات الترخيص وشروطه غير منشورة، والهيئة تذكر أنها تدرس آليته؛ لا تُفترض شروط لم تُنشر، ولا يُعد غياب الإجراء حظرًا. ما يترتب على ذلك في الطلب تقرره الجهة المختصة.", Q.licensingUnderStudy));
    bases.push(basis("unresolved", "معايير المستفيد الحقيقي تعد مالك الشخص الاعتباري أو مديره أو أعضاء مجلس إدارته مستفيدًا حقيقيًا؛ نفاذ المعايير لم يثبت (لم يُعثر على نشرها في الجريدة الرسمية)، فتُجهز البيانات احتياطًا دون إلزام.", Q.boCorporate));
  }
  if (c.managementContract) bases.push(basis("text", "عقد الإدارة تفويض لبعض أعمال النظارة مع بقاء الناظر ومسؤوليته؛ لا يجعل الشركة ناظرًا.", Q.delegationOfManagement));

  const path: Step[] = [
    { order: 1, title: "دراسة وثيقة الوقف وشرط الواقف في النظارة", actor: "فريق المنصة (مراجعة بشرية)", kind: "founder_condition" },
    { order: 2, title: legal ? "استيفاء مستندات الشخص الاعتباري وقرار جهته المختصة بقبول النظارة" : "استيفاء مستندات المرشح", actor: "المرشح", kind: "text" },
    { order: 3, title: "توثيق موافقة المرشح كتابة", actor: "المرشح", kind: "text" },
    { order: 4, title: "إعداد مسودة طلب التعيين ومرفقاته", actor: "المنصة (مسودة)", kind: "text", note: "مسودة لا يثبت بها تعيين" },
    { order: 5, title: c.founder.condition === "delegates_appointment" ? "تقديم الطلب ممن أُسند إليه التعيين إلى الجهة المختصة" : c.founder.alive ? "تقديم الطلب من الواقف إلى الجهة المختصة" : "تقديم الطلب ممن له الصفة إلى الجهة المختصة", actor: c.waqfStatus === "unknown" ? "الهيئة إلى المحكمة المختصة" : "صاحب الصفة", kind: "authority_decision" },
    { order: 6, title: "تحقق الجهة المختصة من الشروط وإصدار قرار التعيين أو صك النظارة", actor: COMPETENT, kind: "authority_decision" },
  ];
  if (legal) path.splice(5, 0, { order: 0, title: "متطلب الترخيص (م5/2): يُعرض على الجهة المختصة كما ورد في النص، مع بيان عدم نشر إجراءاته", actor: COMPETENT, kind: "unresolved", note: "متابعة تنظيمية، لا مانع" });
  path.push({ order: 0, title: "بعد صدور وثيقة التعيين: تحديث بيانات النظارة لدى الهيئة واستلام الوقف", actor: "الناظر بعد تعيينه", kind: "authority_decision", note: established ? undefined : "لا تبدأ قبل وثيقة التعيين" });
  path.forEach((s, i) => (s.order = i + 1));

  const checklist: CheckItem[] = [
    { item: "وثيقة الوقف (صك الوقفية) وشرط الواقف في النظارة", kind: "founder_condition", present: c.founder.waqfDocumented, quote: null },
    { item: "موافقة المرشح المكتوبة على تولي النظارة", kind: "text", present: c.candidate.consentDocumented, quote: Q.consent },
    { item: "بيان صلاحيات الناظر وأتعابه ومسؤولياته المقترحة (لإدراجها في قرار التسمية)", kind: "text", present: null, quote: Q.decisionContents },
  ];
  if (c.founder.condition === "delegates_appointment") checklist.push({ item: "ما يثبت إسناد التعيين ومن أُسند إليه", kind: "founder_condition", present: null, quote: Q.delegatedAppointment });
  if (legal) {
    const d = c.candidate.entityDocs;
    checklist.push(
      { item: "سند قيام الشخص الاعتباري (السجل أو الترخيص النظامي لكيانه)", kind: "text", present: d?.registration ?? null, quote: null },
      { item: "قرار الجهة المختصة داخل الشخص الاعتباري بقبول النظارة وتسمية من يمثله", kind: "text", present: d?.boardResolution ?? null, quote: null },
      { item: "ما يثبت صلاحية الموقّع عن الشخص الاعتباري", kind: "text", present: d?.signatoryAuthority ?? null, quote: null },
      { item: "بيانات الملاك والمديرين وأعضاء مجلس الإدارة (احتياطًا لمعايير المستفيد الحقيقي)", kind: "unresolved", present: d?.ownersAndManagers ?? null, quote: Q.boCorporate },
      { item: "ترخيص الهيئة للشخص الاعتباري (م5/2)", kind: "unresolved", present: c.licence ? true : null, quote: Q.licensed },
    );
  }

  const attachments = checklist.filter((x) => x.present === true).map((x) => x.item);

  const who = legal ? "الشخص الاعتباري المرشح" : "المرشح";
  const draftRequest = {
    addressee: c.waqfStatus === "unknown" ? "المحكمة المختصة (عن طريق الهيئة العامة للأوقاف، لائحة إحياء الأوقاف م13)" : `${COMPETENT} (يحددها فريق المراجعة بحسب حال الوقف)`,
    title: "مسودة طلب تعيين ناظر على وقف",
    body: [
      "نتقدم بطلب تعيين ناظر على الوقف الموضحة بياناته في المرفقات.",
      c.founder.condition === "names_candidate" || c.founder.condition === "describes_candidate" ? `وذلك تنفيذًا لشرط الواقف الوارد في وثيقة الوقف، الذي يسمي ${who} أو يصفه.` : c.founder.condition === "delegates_appointment" ? "وذلك ممن أُسند إليه التعيين بموجب شرط الواقف." : "ولم يتضح من وثيقة الوقف شرط في الناظر، فنعرض الأمر على الجهة المختصة.",
      `ونرفق موافقة ${who} على تولي النظارة، ومقترح صلاحيات الناظر وأتعابه ومسؤولياته لإدراجها في قرار التسمية.`,
      ...(legal
        ? [
            "والمرشح شخص اعتباري، والنظارة تجوز للشخص الاعتباري وفق المادة الخامسة من لائحة تنظيم أعمال النظارة.",
            c.licence
              ? `ونرفق ترخيص الهيئة رقم ${c.licence.number} وتاريخ ${c.licence.dateHijri}هـ.`
              : "ونشير إلى أن المادة الخامسة/2 تشترط ترخيص الهيئة لتعيين الشخص الاعتباري، ولم تُنشر إجراءات هذا الترخيص؛ ونطلب توجيه الجهة المختصة فيما يلزم بشأنه.",
          ]
        : []),
      "ونطلب التحقق من الشروط وإصدار ما ترونه بشأن التعيين.",
    ],
    disclaimer: "مسودة أعدتها المنصة للمراجعة البشرية قبل التقديم. لا يثبت بها تعيين، ولا تقوم مقام قرار الجهة المختصة، ولا تُرسل إلى أي جهة إلا بعد اعتمادها وتوقيع صاحب الصفة.",
  };

  const regulatoryFollowUps = legal && !c.licence ? [{ refId: "NZR-LIC", statement: "متطلب ترخيص الشخص الاعتباري منصوص عليه (م5/2) وإجراءاته غير منشورة؛ يتابع فريق المنصة صدورها. الطلب يُستكمل ولا يُرفض لغيابها.", effect: "follow_up_not_prohibition" as const }] : [];

  const humanReview = [
    "تحديد الجهة المختصة بعينها لهذا الوقف.",
    "قراءة شرط الواقف في النظارة من وثيقة الوقف الأصلية.",
    ...(legal ? ["تقدير ما يُعرض على الجهة المختصة بشأن متطلب الترخيص في ظل عدم نشر إجراءاته."] : []),
    "اعتماد المسودة وتوقيع صاحب الصفة قبل أي تقديم.",
  ];

  return {
    outcome: "processable_with_human_review",
    appointment: established
      ? { established: true, statement: `التعيين ثابت بوثيقة صادرة من ${c.appointmentDocument!.issuer} برقم ${c.appointmentDocument!.number} وتاريخ ${c.appointmentDocument!.dateHijri}هـ (يتحقق منها فريق المراجعة).` }
      : { established: false, statement: `لم يثبت تعيين ${who} ناظرًا: لا توجد وثيقة تعيين في الملف. تقديم الطلب${c.managementContract ? " أو إبرام عقد إدارة" : ""} لا يثبت به التعيين.` },
    path,
    bases,
    checklist,
    attachments,
    draftRequest,
    regulatoryFollowUps,
    humanReview,
  };
}

/** All text a study produces, for checks on forbidden claims. */
export function studyText(s: AppointmentStudy): string {
  return [s.appointment.statement, ...s.path.map((p) => `${p.title} ${p.note ?? ""}`), ...s.bases.map((b) => b.statement), ...s.checklist.map((c) => c.item), s.draftRequest.title, ...s.draftRequest.body, s.draftRequest.disclaimer, ...s.regulatoryFollowUps.map((r) => r.statement)].join("\n");
}
