import { ASSET_CATEGORY_LABEL, ASSET_STATUS_LABEL, ASSET_SUBJECT_LABEL, options } from "@/server/modules/waqf-file/labels";
import type { FieldSpec } from "./action-form";

type AssetLike = {
  category: string; subject: string; title: string; ownershipDocNo: string | null; inWaqfName: boolean | null; sharePct: string | null;
  bookValue: string | null; marketValue: string | null; status: string; annualIncome: string | null; acquiredOn: string | null; notes: string | null;
};

/** Asset form fields (shared by the assets list and the asset detail page). */
export function assetFields(a?: AssetLike): FieldSpec[] {
  return [
    { name: "title", label: "وصف الأصل", required: true, defaultValue: a?.title, wide: true, placeholder: "مثال: عمارة سكنية — حي النرجس، الرياض" },
    { name: "category", label: "النوع", type: "select", options: options(ASSET_CATEGORY_LABEL), required: true, defaultValue: a?.category },
    { name: "subject", label: "محل الوقف", type: "select", options: options(ASSET_SUBJECT_LABEL), defaultValue: a?.subject ?? "corpus" },
    { name: "ownershipDocNo", label: "رقم مستند الملكية", defaultValue: a?.ownershipDocNo, ltr: true },
    { name: "status", label: "الحالة التشغيلية", type: "select", options: options(ASSET_STATUS_LABEL), defaultValue: a?.status ?? "income" },
    { name: "marketValue", label: "القيمة السوقية (ريال)", type: "number", defaultValue: a?.marketValue, hint: "لحصة الوقف إن كان مشاعًا" },
    { name: "bookValue", label: "القيمة الدفترية (ريال)", type: "number", defaultValue: a?.bookValue },
    { name: "annualIncome", label: "الدخل السنوي (ريال)", type: "number", defaultValue: a?.annualIncome },
    { name: "sharePct", label: "حصة الوقف إن كان مشاعًا (%)", type: "number", defaultValue: a?.sharePct },
    { name: "acquiredOn", label: "تاريخ دخوله في الوقف", type: "date", defaultValue: a?.acquiredOn },
    { name: "inWaqfName", label: "مسجّل باسم الوقف", type: "checkbox", defaultValue: a?.inWaqfName ?? false, hint: "يلزم تسجيل الأصول باسم الوقف لدى الهيئة." },
    { name: "notes", label: "ملاحظات", type: "textarea", defaultValue: a?.notes, wide: true },
  ];
}
