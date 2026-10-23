/**
 * Review of a request's fields before its outputs are released to the client (PURE).
 *
 * Policy (owner's decision, ACC-12): essential fields — those that decide whether the waqf and its document are sound
 * and complete, or a legal or financial obligation — must each be reviewed and approved by the team before release; an
 * administrative approval of the output never stands in for that. A secondary field may instead be passed over, but only
 * with a written reason recorded by an authorized reviewer (status «waived»). A field approved or waived on one value
 * opens again when its value changes, and a field in conflict or with an invalid value is never counted as reviewed.
 *
 * The classification is explicit and per service: a service is held to this rule once its essential fields are listed
 * here (each with why), so the list can be reviewed and extended deliberately — never guessed to make a request pass.
 */
import type { FieldView, BlockView, RequestAnalysis } from "./insights";

type Policy = { essential: Record<string, string> };

export const FIELD_POLICY: Record<string, Policy> = {
  T03: {
    essential: {
      capacity: "صفة مقدم الطلب: تحدد من يقر بالوقف ومن يوقّع.",
      waqifName: "اسم الواقف كما يُكتب في الوثيقة ويُطابق عند التوثيق.",
      waqifId: "رقم هوية الواقف المطبوع في الوثيقة.",
      waqfName: "اسم الوقف المطبوع في الوثيقة.",
      waqfKind: "نوع الوقف (عام، أهلي، مشترك) يحدد طبيعته وأحكامه.",
      assets: "الأصول الموقوفة ومستندات ملكيتها: محل الوقف.",
      appurtenances: "ما يشمله الوقف من الأصل وما يُستثنى.",
      exceptionPart: "الجزء المستثنى من الأصل.",
      masarif: "المصارف وطبقات المستحقين وأنصبتهم.",
      alternateMasraf: "المصرف عند انقطاع المستحقين.",
      reservePercent: "نسبة الريع المستقطعة لعمارة الوقف (التزام مالي على الغلة).",
      selfBenefit: "استثناء الواقف الانتفاع لنفسه.",
      selfBenefitScope: "مقدار ما يستثنيه الواقف.",
      nazirType: "من يتولى النظارة.",
      nazirName: "اسم الناظر أو الجهة الناظرة.",
      boardSize: "عدد أعضاء مجلس النظارة.",
      boardMembers: "أعضاء مجلس النظارة الأوائل المسمَّون في الوثيقة.",
      succession: "استخلاف الناظر.",
      investmentAllowed: "الإذن للناظر في الاستثمار.",
      amendmentRight: "ما يحتفظ به الواقف من حق تعديل الشروط.",
    },
  },
};

export const FIELD_REVIEW_SERVICES = Object.keys(FIELD_POLICY);
export const isEssential = (code: string, key: string) => !!FIELD_POLICY[code]?.essential[key];

export type FieldReleaseItem = { key: string; label: string; why: string; reason: string };
export type FieldRelease = {
  enforced: boolean;
  approved: number;
  waived: FieldReleaseItem[];
  /** Essential fields not approved (or approved on an older value, in conflict, invalid): block release. */
  essentialOpen: FieldReleaseItem[];
  /** Secondary fields neither approved nor waived with a reason: block release until one or the other. */
  secondaryOpen: FieldReleaseItem[];
  essentialCount: number;
  secondaryCount: number;
};

type Unit = { key: string; label: string; state: string; approvalOutdated: boolean; insights: { kind: string }[]; error?: string | null };

/** Why a unit does not count as reviewed, or null when it does (approved, or waived when allowed). */
function openReason(u: Unit, essential: boolean): string | null {
  if (u.insights.some((i) => i.kind === "conflict")) return "فيه تعارض قائم";
  if (u.error) return "قيمته غير صحيحة أو ناقصة";
  if (u.approvalOutdated) return "تغيّرت قيمته بعد مراجعته";
  if (u.state === "approved") return null;
  if (u.state === "waived") return essential ? "حقل جوهري لا يجوز تجاوز مراجعته" : null;
  return u.state === "needs_review" ? "يحتاج مراجعة" : "لم يُراجع";
}

export function fieldRelease(code: string, a: Pick<RequestAnalysis, "steps" | "blocks">): FieldRelease {
  const policy = FIELD_POLICY[code];
  const units: Unit[] = [
    ...a.steps.flatMap((s) => s.fields).map((f: FieldView) => ({ key: f.key, label: f.label, state: f.state, approvalOutdated: f.approvalOutdated, insights: f.insights, error: f.raw === null ? null : f.error })),
    ...a.blocks.map((b: BlockView) => ({ key: `ctx:${b.block.key}`, label: b.block.title, state: b.state, approvalOutdated: b.approvalOutdated, insights: b.insights })),
  ];
  const out: FieldRelease = { enforced: !!policy, approved: 0, waived: [], essentialOpen: [], secondaryOpen: [], essentialCount: 0, secondaryCount: 0 };
  for (const u of units) {
    const essential = !!policy?.essential[u.key];
    if (essential) out.essentialCount++;
    else out.secondaryCount++;
    const reason = openReason(u, essential);
    const item = { key: u.key, label: u.label, why: policy?.essential[u.key] ?? "حقل ثانوي", reason: reason ?? "" };
    if (!reason) {
      if (u.state === "waived") out.waived.push(item);
      else out.approved++;
    } else if (essential) out.essentialOpen.push(item);
    else out.secondaryOpen.push(item);
  }
  return out;
}

/** The release guard's message, or null when the review allows release (or the service is not under the policy). */
export function fieldReleaseBlock(r: FieldRelease): string | null {
  if (!r.enforced) return null;
  const parts: string[] = [];
  if (r.essentialOpen.length) parts.push(`حقول جوهرية لم تكتمل مراجعتها (${r.essentialOpen.length}): ${r.essentialOpen.slice(0, 6).map((x) => `«${x.label}» — ${x.reason}`).join("، ")}${r.essentialOpen.length > 6 ? "، وغيرها" : ""}. تُراجع وتُعتمد حقلًا حقلًا، ولا يغني عنها اعتماد المخرج`);
  if (r.secondaryOpen.length) parts.push(`حقول ثانوية لم تُراجع ولم يُسجل تجاوزها (${r.secondaryOpen.length}): ${r.secondaryOpen.slice(0, 6).map((x) => `«${x.label}»`).join("، ")}${r.secondaryOpen.length > 6 ? "، وغيرها" : ""}. تُعتمد، أو يُسجل مراجع مخول تجاوزها بسبب مكتوب`);
  return parts.length ? `لا تُرسل المخرجات للعميل قبل مراجعة الحقول: ${parts.join("؛ ")}.` : null;
}
