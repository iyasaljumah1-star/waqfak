"use client";

import { RowsEditor, type Opt } from "./action-form";

/** Step 4 of the establish wizard: beneficiary classes (tiers) and the founder's conditions. */
export function EstablishRows({ classes, conditions, defaultKind, conditionOptions }: { classes: Record<string, string>[]; conditions: Record<string, string>[]; defaultKind: "public" | "private"; conditionOptions: Opt[] }) {
  return (
    <div className="space-y-6">
      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">المصارف بالترتيب</h3>
        <RowsEditor
          prefix="c"
          addLabel="أضف مصرفًا"
          initial={classes.length ? classes : [{ name: "", kind: defaultKind, tier: "1", relation: "then", sharePct: "", divisionRule: defaultKind === "private" ? "equal" : "", substitutionRule: "" }]}
          fields={[
            { key: "name", label: "المصرف أو المستحقون", width: "sm:col-span-2", placeholder: "مثال: أولادي ذكورًا وإناثًا" },
            { key: "kind", label: "النوع", type: "select", options: [{ value: "private", label: "معيّنون" }, { value: "public", label: "جهة بر" }] },
            { key: "tier", label: "الطبقة", type: "number" },
            { key: "relation", label: "العلاقة بما قبلها", type: "select", options: [{ value: "then", label: "ثم (ترتيب)" }, { value: "and", label: "و (تشريك)" }] },
            { key: "sharePct", label: "النسبة % (للتشريك)", type: "number" },
            { key: "divisionRule", label: "القسمة بينهم", type: "select", options: [{ value: "equal", label: "بالتساوي" }, { value: "male_double", label: "للذكر مثل حظ الأنثيين" }] },
            { key: "substitutionRule", label: "التنزيل", type: "select", options: [{ value: "tier_blocking", label: "الطبقة العليا تحجب السفلى" }, { value: "branch_replaces", label: "يحل الفرع محل أصله" }] },
          ]}
        />
      </section>
      <section className="space-y-2">
        <h3 className="text-[15px] font-semibold">شروط أخرى (اختياري)</h3>
        <p className="text-[13px] text-muted">اكتب كل شرط في سطر مستقل بعبارة واضحة. ستُراجع الشروط شرعيًا ضمن خدمة الصياغة.</p>
        <RowsEditor
          prefix="k"
          min={0}
          addLabel="أضف شرطًا"
          initial={conditions}
          fields={[
            { key: "category", label: "الفئة", type: "select", options: conditionOptions },
            { key: "text", label: "نص الشرط", width: "sm:col-span-2 lg:col-span-3", placeholder: "مثال: يُقدَّم في الاستحقاق طالب العلم منهم" },
          ]}
        />
      </section>
    </div>
  );
}
