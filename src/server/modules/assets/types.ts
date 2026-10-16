/**
 * What each type of waqf asset is described by (PURE): the fields that identify it, which of them are needed for the
 * file to be complete, its documents, and how its data is validated. One definition serves the establishment wizard,
 * the waqf file's asset forms, server-side validation, completeness (the journey) and display.
 *
 * Required means "needed for the asset to be complete": a draft may be saved without them (the gap is listed), the
 * wizard does not move past the assets step without them. Format rules (numbers, dates, options, masked references)
 * are always enforced on the server.
 */

export const ASSET_CATEGORIES = ["real_estate", "movable", "cash", "shares", "fund_units", "portfolio", "sukuk", "usufruct", "intellectual_property"] as const;
export type AssetCategory = (typeof ASSET_CATEGORIES)[number];

export type AssetFieldSpec = {
  key: string;
  label: string;
  type: "text" | "number" | "select" | "date" | "textarea";
  options?: readonly (readonly [string, string])[];
  required?: boolean;
  hint?: string;
  /** Only the last digits of a reference are kept (an account or portfolio number is never stored in full). */
  last4?: boolean;
  min?: number;
  max?: number;
};

export type AssetTypeSpec = {
  category: AssetCategory;
  label: string;
  /** What the title field asks for, for this type. */
  titleLabel: string;
  titleHint: string;
  /** Label of the estimated value (the amount, for cash). */
  valueLabel: string;
  valueRequired: boolean;
  /** Ownership document number (base column) — a deed for real estate; not asked for other types. */
  ownershipDoc: null | { label: string; required: boolean };
  /** Whether an undivided share (حصة مشاعة) applies. */
  share: boolean;
  /** Label of «held in the founder's name» for this type. */
  heldLabel: string;
  fields: AssetFieldSpec[];
  /** Documents of the documents vault that prove the asset (doc type), and whether one is needed for completeness. */
  docs: { type: string; label: string; required: boolean }[];
};

const VALUE_SOURCE = [["owner_estimate", "تقدير المالك"], ["licensed_valuer", "مقيّم معتمد"], ["market_price", "سعر السوق أو كشف الحساب"], ["purchase_price", "سعر الشراء"]] as const;
const valueSource: AssetFieldSpec = { key: "valueSource", label: "مصدر القيمة التقديرية", type: "select", options: VALUE_SOURCE };
const valueDate: AssetFieldSpec = { key: "valueDate", label: "تاريخ القيمة", type: "date" };

export const ASSET_TYPES: Record<AssetCategory, AssetTypeSpec> = {
  real_estate: {
    category: "real_estate", label: "عقار", titleLabel: "وصف العقار", titleHint: "مثال: عمارة سكنية من ثلاثة أدوار", valueLabel: "القيمة التقديرية (ريال)", valueRequired: false,
    ownershipDoc: { label: "رقم صك الملكية", required: true }, share: true, heldLabel: "الصك باسم الواقف",
    fields: [
      { key: "propertyType", label: "نوع العقار", type: "select", required: true, options: [["land", "أرض"], ["residential_building", "عمارة سكنية"], ["commercial_building", "مبنى تجاري"], ["villa", "فيلا"], ["apartment", "شقة"], ["farm", "مزرعة"], ["other", "أخرى"]] },
      { key: "city", label: "المدينة", type: "text", required: true },
      { key: "district", label: "الحي", type: "text" },
      { key: "address", label: "العنوان أو الموقع", type: "text", hint: "العنوان الوطني أو وصف الموقع" },
      { key: "deedDate", label: "تاريخ الصك", type: "date" },
      { key: "deedIssuer", label: "جهة إصدار الصك", type: "text", hint: "مثال: كتابة العدل، أو السجل العقاري" },
      { key: "areaSqm", label: "المساحة (م²)", type: "number", required: true, min: 0 },
      { key: "usage", label: "الاستخدام", type: "select", options: [["residential", "سكني"], ["commercial", "تجاري"], ["mixed", "مختلط"], ["agricultural", "زراعي"], ["vacant", "أرض فضاء"], ["other", "أخرى"]] },
      { key: "condition", label: "حالة العقار", type: "select", options: [["good", "جيدة"], ["needs_maintenance", "تحتاج صيانة"], ["poor", "متهالكة"], ["under_construction", "تحت الإنشاء"]] },
      valueSource, valueDate,
    ],
    docs: [{ type: "ownership_deed", label: "صك الملكية", required: true }, { type: "valuation", label: "تقرير التقييم", required: false }],
  },
  movable: {
    category: "movable", label: "منقول", titleLabel: "وصف المنقول", titleHint: "مثال: مكتبة مخطوطات، أو سيارة نقل", valueLabel: "القيمة التقديرية (ريال)", valueRequired: false,
    ownershipDoc: null, share: false, heldLabel: "مملوك للواقف وفي حيازته",
    fields: [
      { key: "movableCategory", label: "فئة المنقول", type: "select", required: true, options: [["vehicle", "مركبة"], ["equipment", "معدات وأجهزة"], ["furniture", "أثاث"], ["books", "كتب ومخطوطات"], ["artwork", "تحف ومجوهرات"], ["livestock", "مواشٍ"], ["other", "أخرى"]] },
      { key: "quantity", label: "الكمية", type: "number", required: true, min: 0 },
      { key: "unit", label: "الوحدة", type: "text", required: true, hint: "مثال: قطعة، مجلد، رأس" },
      { key: "identifier", label: "الرقم التسلسلي أو بيانات التعريف", type: "text", hint: "رقم الهيكل أو اللوحة أو الرقم التسلسلي إن وُجد" },
      { key: "location", label: "مكان المنقول", type: "text", required: true },
      { key: "holder", label: "الحائز", type: "text", hint: "من يحوز المنقول الآن" },
      { key: "inspection", label: "الفحص أو التقييم", type: "text", hint: "إن وُجد: جهة الفحص وتاريخه" },
      valueSource, valueDate,
    ],
    docs: [{ type: "other", label: "مستند الملكية أو الإثبات (فاتورة، استمارة)", required: false }],
  },
  cash: {
    category: "cash", label: "نقد", titleLabel: "وصف المبلغ", titleHint: "مثال: مبلغ نقدي يودع في حساب الوقف", valueLabel: "المبلغ", valueRequired: true,
    ownershipDoc: null, share: false, heldLabel: "الحساب باسم الواقف",
    fields: [
      { key: "currency", label: "العملة", type: "select", required: true, options: [["SAR", "ريال سعودي"], ["USD", "دولار أمريكي"], ["other", "أخرى"]] },
      { key: "holding", label: "مكان المبلغ", type: "select", required: true, options: [["bank_account", "حساب بنكي"], ["deposit", "وديعة"], ["pledged", "تعهد بالدفع"]] },
      { key: "bankName", label: "البنك", type: "text" },
      { key: "accountRef", label: "آخر 4 أرقام من الحساب", type: "text", last4: true, hint: "لا يُحفظ رقم الحساب كاملًا" },
      valueDate,
    ],
    docs: [{ type: "bank_statement", label: "كشف حساب", required: false }],
  },
  shares: {
    category: "shares", label: "أسهم", titleLabel: "وصف الأسهم", titleHint: "مثال: أسهم في شركة مدرجة", valueLabel: "القيمة السوقية (ريال)", valueRequired: false,
    ownershipDoc: null, share: false, heldLabel: "الأسهم باسم الواقف",
    fields: [
      { key: "issuer", label: "الشركة المصدرة", type: "text", required: true },
      { key: "market", label: "السوق", type: "select", required: true, options: [["tadawul", "السوق الرئيسية (تداول)"], ["nomu", "السوق الموازية (نمو)"], ["unlisted", "غير مدرجة"], ["foreign", "سوق خارجية"]] },
      { key: "symbol", label: "رمز التداول", type: "text" },
      { key: "quantity", label: "عدد الأسهم", type: "number", required: true, min: 0 },
      { key: "custodian", label: "أمين الحفظ أو الوسيط", type: "text" },
      valueSource, valueDate,
    ],
    docs: [{ type: "bank_statement", label: "كشف ملكية الأسهم", required: false }],
  },
  fund_units: {
    category: "fund_units", label: "وحدات صناديق", titleLabel: "وصف الوحدات", titleHint: "مثال: وحدات في صندوق استثماري وقفي", valueLabel: "القيمة (ريال)", valueRequired: false,
    ownershipDoc: null, share: false, heldLabel: "الوحدات باسم الواقف",
    fields: [
      { key: "fundName", label: "اسم الصندوق", type: "text", required: true },
      { key: "fundManager", label: "مدير الصندوق", type: "text", required: true },
      { key: "managerLicense", label: "ترخيص مدير الصندوق (هيئة السوق المالية)", type: "text" },
      { key: "units", label: "عدد الوحدات", type: "number", required: true, min: 0 },
      valueSource, valueDate,
    ],
    docs: [{ type: "bank_statement", label: "كشف الوحدات", required: false }],
  },
  portfolio: {
    category: "portfolio", label: "محفظة استثمارية", titleLabel: "وصف المحفظة", titleHint: "مثال: محفظة استثمارية لدى شركة وساطة", valueLabel: "القيمة (ريال)", valueRequired: false,
    ownershipDoc: null, share: false, heldLabel: "المحفظة باسم الواقف",
    fields: [
      { key: "institution", label: "الجهة أو المؤسسة المالية", type: "text", required: true },
      { key: "portfolioRef", label: "آخر 4 أرقام من مرجع المحفظة", type: "text", required: true, last4: true, hint: "لا يُحفظ رقم المحفظة كاملًا" },
      { key: "management", label: "نوع الإدارة", type: "select", required: true, options: [["discretionary", "إدارة تقديرية"], ["advisory", "استشارية"], ["custody", "حفظ فقط"]] },
      { key: "components", label: "مكوّنات المحفظة", type: "text", hint: "مثال: أسهم وصكوك وصناديق" },
      { key: "managerLicense", label: "ترخيص مدير المحفظة", type: "text" },
      { key: "restrictions", label: "القيود أو الاشتراطات", type: "textarea", hint: "قيود السحب أو الرهن أو الاستثمار" },
      valueSource, valueDate,
    ],
    docs: [{ type: "bank_statement", label: "كشف المحفظة", required: false }, { type: "contract", label: "اتفاقية الإدارة", required: false }],
  },
  sukuk: {
    category: "sukuk", label: "صكوك", titleLabel: "وصف الصكوك", titleHint: "مثال: صكوك حكومية", valueLabel: "القيمة (ريال)", valueRequired: false,
    ownershipDoc: null, share: false, heldLabel: "الصكوك باسم الواقف",
    fields: [
      { key: "issuer", label: "الجهة المصدرة", type: "text", required: true },
      { key: "quantity", label: "عدد الصكوك", type: "number", required: true, min: 0 },
      { key: "nominal", label: "القيمة الاسمية للصك", type: "number", min: 0 },
      { key: "maturity", label: "تاريخ الاستحقاق", type: "date" },
      { key: "custodian", label: "أمين الحفظ", type: "text" },
      valueSource, valueDate,
    ],
    docs: [{ type: "bank_statement", label: "كشف ملكية الصكوك", required: false }],
  },
  usufruct: {
    category: "usufruct", label: "منفعة", titleLabel: "وصف المنفعة", titleHint: "مثال: منفعة محل تجاري لمدة عشر سنوات", valueLabel: "القيمة التقديرية (ريال)", valueRequired: false,
    ownershipDoc: null, share: true, heldLabel: "المنفعة مملوكة للواقف",
    fields: [
      { key: "sourceAsset", label: "الأصل الذي تُوقف منفعته", type: "text", required: true },
      { key: "assetOwner", label: "مالك الأصل", type: "text", required: true },
      { key: "startsOn", label: "بداية المنفعة", type: "date" },
      { key: "endsOn", label: "نهاية المنفعة", type: "date", required: true },
      { key: "contractRef", label: "مرجع عقد المنفعة", type: "text" },
      { key: "scope", label: "نطاق المنفعة", type: "textarea" },
      valueSource,
    ],
    docs: [{ type: "contract", label: "عقد المنفعة", required: true }],
  },
  intellectual_property: {
    category: "intellectual_property", label: "ملكية فكرية", titleLabel: "وصف الحق", titleHint: "مثال: حقوق نشر كتاب", valueLabel: "القيمة التقديرية (ريال)", valueRequired: false,
    ownershipDoc: null, share: true, heldLabel: "الحق مسجل باسم الواقف",
    fields: [
      { key: "ipType", label: "نوع الحق", type: "select", required: true, options: [["copyright", "حق مؤلف"], ["patent", "براءة اختراع"], ["trademark", "علامة تجارية"], ["software", "برمجيات"], ["design", "تصميم صناعي"], ["other", "أخرى"]] },
      { key: "registrationNo", label: "رقم التسجيل", type: "text" },
      { key: "registry", label: "جهة التسجيل", type: "text", hint: "مثال: الهيئة السعودية للملكية الفكرية" },
      { key: "expiresOn", label: "تاريخ انتهاء الحماية", type: "date" },
      valueSource,
    ],
    docs: [{ type: "other", label: "شهادة تسجيل الحق", required: false }],
  },
};

export const isAssetCategory = (c: string): c is AssetCategory => (ASSET_CATEGORIES as readonly string[]).includes(c);

export type AssetInput = {
  category: string;
  title: string;
  value: string;
  ownershipDocNo: string;
  sharePct: string;
  held: string; // "on" | "off"
  details: Record<string, string>;
};

const DATE = /^\d{4}-\d{2}-\d{2}$/;
const num = (v: string) => Number(String(v).replace(/,/g, ""));

/**
 * Cleans an asset to its type's fields (others are dropped — never carried from another type) and validates formats.
 * Returns the cleaned asset, hard errors (format), and what is missing for completeness.
 */
export function checkAsset(a: AssetInput): { asset: AssetInput; errors: string[]; missing: string[] } {
  const errors: string[] = [];
  const missing: string[] = [];
  if (!isAssetCategory(a.category)) return { asset: a, errors: ["اختر نوع الأصل."], missing: ["نوع الأصل"] };
  const spec = ASSET_TYPES[a.category];
  const details: Record<string, string> = {};
  for (const f of spec.fields) {
    let v = String(a.details?.[f.key] ?? "").trim().slice(0, f.type === "textarea" ? 1000 : 200);
    if (v && f.last4) {
      const digits = v.replace(/\D/g, "");
      if (digits.length > 4) errors.push(`${f.label}: اكتب آخر 4 أرقام فقط (لا يُحفظ الرقم كاملًا).`);
      v = digits.slice(-4);
    }
    if (v && f.type === "number") {
      const n = num(v);
      if (!Number.isFinite(n) || (f.min !== undefined && n < f.min) || (f.max !== undefined && n > f.max)) errors.push(`${f.label}: قيمة غير صحيحة.`);
      else v = String(n);
    }
    if (v && f.type === "date" && !DATE.test(v)) errors.push(`${f.label}: تاريخ غير صالح.`);
    if (v && f.type === "select" && !f.options?.some(([k]) => k === v)) errors.push(`${f.label}: اختيار غير معروف.`);
    if (v) details[f.key] = v;
    else if (f.required) missing.push(f.label);
  }
  const title = a.title.trim().slice(0, 200);
  if (!title) missing.push(spec.titleLabel);
  const value = String(a.value ?? "").trim();
  if (value && !(num(value) >= 0)) errors.push(`${spec.valueLabel}: قيمة غير صحيحة.`);
  if (!value && spec.valueRequired) missing.push(spec.valueLabel);
  const ownershipDocNo = spec.ownershipDoc ? a.ownershipDocNo.trim().slice(0, 80) : "";
  if (spec.ownershipDoc?.required && !ownershipDocNo) missing.push(spec.ownershipDoc.label);
  const sharePct = spec.share ? String(a.sharePct ?? "").trim() : "";
  if (sharePct && !(num(sharePct) > 0 && num(sharePct) <= 100)) errors.push("الحصة المشاعة بين 1 و100.");
  if (details.startsOn && details.endsOn && details.endsOn < details.startsOn) errors.push("نهاية المنفعة قبل بدايتها.");
  return { asset: { category: a.category, title, value: value ? String(num(value)) : "", ownershipDocNo, sharePct: sharePct ? String(num(sharePct)) : "", held: a.held === "on" ? "on" : "off", details }, errors, missing };
}

/** The display rows of an asset's type-specific data (labels and option labels). */
export function assetDetailRows(category: string, details: Record<string, string> | null | undefined): { label: string; value: string }[] {
  if (!isAssetCategory(category) || !details) return [];
  return ASSET_TYPES[category].fields.filter((f) => details[f.key]).map((f) => ({
    label: f.label,
    value: f.type === "select" ? f.options?.find(([k]) => k === details[f.key])?.[1] ?? details[f.key] : f.last4 ? `••••${details[f.key]}` : details[f.key],
  }));
}

/** Short identifying line of an asset (for lists and the deed text): the type and its key facts. */
export function assetSummary(category: string, details: Record<string, string> | null | undefined): string {
  if (!isAssetCategory(category)) return "";
  const d = details ?? {};
  const opt = (k: string) => ASSET_TYPES[category].fields.find((f) => f.key === k)?.options?.find(([o]) => o === d[k])?.[1] ?? "";
  switch (category) {
    case "real_estate": return [opt("propertyType"), d.city && `في ${d.city}${d.district ? `، حي ${d.district}` : ""}`, d.areaSqm && `مساحته ${d.areaSqm} م²`].filter(Boolean).join(" ");
    case "movable": return [opt("movableCategory"), d.quantity && `${d.quantity} ${d.unit ?? ""}`.trim(), d.location && `في ${d.location}`].filter(Boolean).join("، ");
    case "cash": return [opt("holding"), d.bankName && `لدى ${d.bankName}`, d.currency && d.currency !== "SAR" ? opt("currency") : ""].filter(Boolean).join(" ");
    case "shares": return [d.quantity && `${d.quantity} سهمًا`, d.issuer && `في ${d.issuer}`, opt("market") && `(${opt("market")})`].filter(Boolean).join(" ");
    case "fund_units": return [d.units && `${d.units} وحدة`, d.fundName && `في ${d.fundName}`, d.fundManager && `يديره ${d.fundManager}`].filter(Boolean).join(" ");
    case "portfolio": return [d.institution && `لدى ${d.institution}`, d.portfolioRef && `(مرجع ينتهي بـ ${d.portfolioRef})`, opt("management")].filter(Boolean).join(" ");
    case "sukuk": return [d.quantity && `${d.quantity} صكًا`, d.issuer && `صادرة عن ${d.issuer}`, d.maturity && `تستحق في ${d.maturity}`].filter(Boolean).join(" ");
    case "usufruct": return [d.sourceAsset && `منفعة ${d.sourceAsset}`, d.assetOwner && `المملوك لـ${d.assetOwner}`, d.endsOn && `حتى ${d.endsOn}`].filter(Boolean).join(" ");
    case "intellectual_property": return [opt("ipType"), d.registrationNo && `رقم التسجيل ${d.registrationNo}`, d.registry && `لدى ${d.registry}`].filter(Boolean).join("، ");
  }
}

/** Completeness of a saved asset (what is missing for its type). Legacy assets without type data list what to add. */
export function assetGaps(a: { category: string; title: string; marketValue: string | null; ownershipDocNo: string | null; sharePct: string | null; details: Record<string, string> | null }) {
  return checkAsset({ category: a.category, title: a.title, value: a.marketValue ?? "", ownershipDocNo: a.ownershipDocNo ?? "", sharePct: a.sharePct ?? "", held: "off", details: a.details ?? {} }).missing;
}
