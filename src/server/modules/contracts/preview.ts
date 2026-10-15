import "server-only";
import { and, desc, eq } from "drizzle-orm";
import { ForbiddenError, type Auth } from "@/server/authz/context";
import { contractTemplates, quotes, users } from "@/server/db/schema";
import type { ContractParty } from "@/server/db/schema/commerce";
import { read } from "@/server/modules/_shared";
import { fmtBoth } from "@/lib/utils";
import { todayISO } from "@/server/engines/dates";
import { contractState, loadRequestCtx } from "@/server/modules/requests/access";
import { contractCompanyGaps } from "@/server/modules/commerce/pure";
import { companyProfile } from "@/server/modules/commerce/state";
import { companyParty, renderContract, templateCodeFor } from "./render";

const gap = (label: string) => `[ناقص: ${label}]`;

/**
 * Preview of the contract a quote will produce, before the draft can be prepared (company data missing, parties not yet
 * chosen). Nothing is stored and no number is taken. Every missing item is printed as «[ناقص: …]» in its place and
 * listed — the preview is not a contract and cannot be signed or sent.
 */
export async function contractPreview(auth: Auth, requestId: string, quoteId: string) {
  return read(auth, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, requestId, "staff");
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
    const [q] = await tx.select().from(quotes).where(and(eq(quotes.id, quoteId), eq(quotes.requestId, requestId))).limit(1);
    if (!q) return null;
    const missing: string[] = [];
    if (q.status !== "accepted") missing.push("العرض لم يقبله العميل بعد: يُبنى العقد من العرض المقبول، وقد تتغير بنوده قبل ذلك");
    const company = await companyProfile(tx);
    const companyGaps = contractCompanyGaps(company);
    for (const g of companyGaps) missing.push(`بيانات الشركة: ${g} (من «الإعدادات ← بيانات الشركة»)`);
    // The company party with every missing field marked in place.
    const marked = {
      ...company,
      nameAr: company.nameAr?.trim() || gap("الاسم التجاري"),
      crNumber: company.crNumber?.trim() || (company.unifiedNumber?.trim() ? company.crNumber : gap("رقم السجل التجاري أو الرقم الوطني الموحد")),
      nationalAddress: company.nationalAddress?.trim() || gap("العنوان الوطني"),
      signatoryName: company.signatoryName?.trim() || gap("اسم المفوّض بالتوقيع"),
      signatoryTitle: company.signatoryTitle?.trim() || gap("صفة المفوّض بالتوقيع"),
    };
    const [requester] = await tx.select({ name: users.fullName }).from(users).where(eq(users.id, rc.req.requesterUserId)).limit(1);
    const client: ContractParty = {
      key: "client1", side: "client", name: requester?.name ?? gap("اسم الطرف الثاني"), capacity: gap("صفة الطرف الثاني في العقد"),
      idLabel: null, idNumber: null, signerName: requester?.name ?? gap("الموقّع"), signerUserId: null, authorityType: "self", authorityRef: null, authorityDocumentId: null, required: true,
    };
    missing.push("أطراف العميل وصفاتهم وسندات تفويضهم تُحدد عند إعداد مسودة العقد (المعروض هنا مقدّم الطلب أصالة)");
    const amendment = q.kind === "amendment";
    const parent = amendment ? (await contractState(tx, requestId)).stage : null;
    const code = templateCodeFor(rc.service, amendment);
    const [tpl] = await tx.select().from(contractTemplates).where(and(eq(contractTemplates.code, code), eq(contractTemplates.isActive, true))).orderBy(desc(contractTemplates.version)).limit(1);
    if (!tpl) return { rc, q, body: null, missing: [`لا يوجد قالب عقد مفعّل (${code}). تواصل مع مسؤول النظام.`, ...missing] };
    const body = renderContract(tpl.body, {
      number: gap("رقم العقد يُسند عند إعداد المسودة"), date: fmtBoth(todayISO()), parties: [companyParty(marked), client], company: marked, service: rc.service,
      requestNumber: rc.req.number, parentContract: parent?.number ?? null, quote: { ...q, lines: q.lines, paymentTerms: q.paymentTerms },
    }) + `\n\n---\nمرجع الطلب: ${rc.req.number} — العرض: ${q.number} (نسخة ${q.version}) — معاينة غير محفوظة`;
    return { rc, q, body, missing };
  });
}
