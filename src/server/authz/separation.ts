/**
 * Separation of duties for the platform's own approvals (PURE, unit-tested).
 *
 * Whether the person who prepared a record may also approve it:
 *  - A holder of `approvals.direct` (the platform's system administrator by default) may approve what they prepared;
 *    the approval is recorded as a direct (self) approval. Assignment is never required for this.
 *  - Other staff keep the platform's operational rule: someone other than the preparer approves.
 *  - When the company adopts a written policy that requires a second person for an action, it is switched on here
 *    with its reference, and then applies to everyone, the system administrator included, with that reason shown.
 *
 * No such written policy exists in the project files (the quality policy in them is the GAA's own ISO 9001 policy and
 * says nothing about the approvals of a service provider's work), so every control starts switched off.
 */

export const SEPARATION_KEYS = ["quote", "contract", "output", "quality_review", "nazara_report"] as const;
export type SeparationKey = (typeof SEPARATION_KEYS)[number];

export const SEPARATION_AR: Record<SeparationKey, string> = {
  quote: "اعتماد عروض الأسعار وملاحق التعديل",
  contract: "اعتماد العقود وملاحقها قبل إرسالها للتوقيع",
  output: "اعتماد المخرجات ذات سياسة «الاعتماد المستقل» (الآراء ووثائق الوقف والوصايا ودراسات النظارة…)",
  quality_review: "مراجعة الجودة والإفراج عن التسليمات للعميل",
  nazara_report: "اعتماد تقارير النظارة الاعتبارية الدورية",
};

export type SeparationRule = { enforced: boolean; reference: string | null };
export type SeparationPolicy = Record<SeparationKey, SeparationRule>;

export const DEFAULT_SEPARATION: SeparationPolicy = Object.fromEntries(SEPARATION_KEYS.map((k) => [k, { enforced: false, reference: null }])) as SeparationPolicy;

/** Normalizes the stored setting; an enforced rule must name its written policy, otherwise it is not enforced. */
export function separationPolicy(v: unknown): SeparationPolicy {
  const o = (v && typeof v === "object" ? v : {}) as Partial<Record<SeparationKey, Partial<SeparationRule>>>;
  const out = { ...DEFAULT_SEPARATION };
  for (const k of SEPARATION_KEYS) {
    const r = o[k];
    const ref = typeof r?.reference === "string" && r.reference.trim().length >= 5 ? r.reference.trim().slice(0, 300) : null;
    out[k] = { enforced: !!r?.enforced && !!ref, reference: ref };
  }
  return out;
}

export type MakerCheck = { ok: true; self: boolean; direct: boolean } | { ok: false; error: string };

/**
 * May this approver approve? `isMaker`: the approver prepared the record. `canDirect`: holds `approvals.direct`.
 * `fallback`: the refusal for staff without direct approval (the platform's operational rule).
 */
export function makerChecker(p: { key: SeparationKey; isMaker: boolean; canDirect: boolean; policy: SeparationPolicy; fallback: string }): MakerCheck {
  if (!p.isMaker) return { ok: true, self: false, direct: false };
  const rule = p.policy[p.key];
  if (rule.enforced)
    return { ok: false, error: `${SEPARATION_AR[p.key]}: يلزم أن يعتمده شخص غير من أعدّه بموجب سياسة معتمدة (${rule.reference}). هذا الضابط يسري على الجميع بمن فيهم مدير النظام؛ اطلب الاعتماد من زميل يملك صلاحيته.` };
  if (p.canDirect) return { ok: true, self: true, direct: true };
  return { ok: false, error: p.fallback };
}
