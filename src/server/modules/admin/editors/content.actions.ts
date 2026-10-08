"use server";
import { and, desc, eq, ne } from "drizzle-orm";
import { redirect } from "next/navigation";
import { z } from "zod";
import { contentItems, contentReviews, faqs, glossaryTerms } from "@/server/db/schema";
import { parseForm, UserError } from "@/server/modules/_shared";
import { todayISO } from "@/server/engines/dates";
import type { ActionState } from "@/lib/utils";
import type { Tx } from "@/server/db";
import { log, staffAction } from "./guard";
import { checkbox, formObj, optDate, optInt, optText, reqText, uuid } from "./form-utils";
import { parseJson, REVIEW_REQUIRED_KINDS, slugOk, splitList } from "./pure";

const P = "/admin/content";
const PUBLIC = ["/library", "/regulations", "/faq", "/glossary"];

const contentSchema = z.object({
  id: z.string().optional(),
  kind: z.enum(["article", "guide", "regulation", "study", "template", "page"], { error: "اختر نوع المحتوى." }),
  slug: z.string().trim().toLowerCase().refine(slugOk, "المعرّف في الرابط بحروف إنجليزية صغيرة وأرقام وشرطات، مثل nazir-duties."),
  titleAr: reqText(5, "اكتب العنوان (5 أحرف على الأقل).", 200),
  summary: optText(600),
  bodyMd: reqText(20, "اكتب نص المحتوى (20 حرفًا على الأقل).", 200_000),
  audience: z.array(z.enum(["waqif", "nazir", "board", "beneficiary", "entities", "entity"])),
  topic: optText(60),
  sourceRefs: z.string().optional(),
  lastVerifiedAt: optDate,
  seoTitle: optText(120),
  seoDescription: optText(300),
  readingMinutes: optInt(1, 300, "مدة القراءة بالدقائق بين 1 و300."),
  requiresLogin: checkbox,
});

function parseRefs(raw: string | undefined): { ok: true; value: { label: string; url?: string }[] } | { ok: false; error: string } {
  if (!raw || !raw.trim() || raw.trim() === "[]") return { ok: true, value: [] };
  const j = parseJson<{ label?: string; url?: string }[]>(raw, "المصادر");
  if (!j.ok || !Array.isArray(j.value)) return { ok: false, error: "قائمة المصادر غير صالحة." };
  const out: { label: string; url?: string }[] = [];
  for (const [i, r] of j.value.entries()) {
    const label = String(r?.label ?? "").trim();
    const url = String(r?.url ?? "").trim();
    if (!label && !url) continue;
    if (!label) return { ok: false, error: `المصدر ${i + 1}: اكتب اسم المصدر.` };
    if (url && !/^https:\/\/\S+$/.test(url)) return { ok: false, error: `المصدر ${i + 1}: الرابط يبدأ بـ https://` };
    out.push(url ? { label: label.slice(0, 300), url } : { label: label.slice(0, 300) });
  }
  return { ok: true, value: out };
}

async function loadItem(tx: Tx, id: string) {
  const [c] = await tx.select().from(contentItems).where(eq(contentItems.id, id)).limit(1);
  if (!c) throw new UserError("المحتوى غير موجود.");
  return c;
}

/**
 * Saves a content item. Changing the title or body of a reviewed item clears its review; a published
 * regulation/guide whose text changes goes back to "in review" so unreviewed regulatory text is never live.
 */
export async function saveContent(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(contentSchema, formObj(fd, ["audience"]));
  if ("state" in r) return r.state;
  const d = r.data;
  const refs = parseRefs(d.sourceRefs);
  if (!refs.ok) return { error: refs.error, fieldErrors: { sourceRefs: refs.error } };
  if (REVIEW_REQUIRED_KINDS.includes(d.kind) && !refs.value.length) return { error: "راجع الحقول المظللة.", fieldErrors: { sourceRefs: "الأنظمة والأدلة تحتاج مصدرًا واحدًا على الأقل." } };
  let newId: string | null = null;
  const res = await staffAction("admin.content", async (c) => {
    const [dup] = await c.tx.select({ id: contentItems.id }).from(contentItems).where(and(eq(contentItems.kind, d.kind), eq(contentItems.slug, d.slug), d.id ? ne(contentItems.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`المعرّف «${d.slug}» مستخدم لمحتوى آخر من النوع نفسه.`);
    const values = {
      kind: d.kind, slug: d.slug, titleAr: d.titleAr, summary: d.summary, bodyMd: d.bodyMd, audience: d.audience, topic: d.topic, sourceRefs: refs.value,
      lastVerifiedAt: d.lastVerifiedAt, seoTitle: d.seoTitle, seoDescription: d.seoDescription,
      readingMinutes: d.readingMinutes ?? Math.max(1, Math.round(d.bodyMd.split(/\s+/).length / 200)), requiresLogin: d.requiresLogin, updatedBy: c.auth.user.id,
    };
    if (d.id) {
      const before = await loadItem(c.tx, d.id);
      const textChanged = before.bodyMd !== d.bodyMd || before.titleAr !== d.titleAr || before.kind !== d.kind;
      const extra: Partial<typeof contentItems.$inferInsert> = {};
      let note = "حُفظ المحتوى.";
      if (textChanged && before.reviewedAt) {
        Object.assign(extra, { reviewedAt: null, reviewedBy: null });
        note = "حُفظ المحتوى. تغيّر النص فأُلغيت المراجعة السابقة؛ يحتاج مراجعة جديدة قبل النشر.";
      }
      if (textChanged && before.status === "published" && REVIEW_REQUIRED_KINDS.includes(d.kind)) {
        Object.assign(extra, { status: "in_review" as const, publishedAt: null });
        note = "حُفظ المحتوى وأُعيد إلى المراجعة: النص النظامي المعدّل لا يُنشر قبل مراجعة متخصص.";
      }
      await c.tx.update(contentItems).set({ ...values, ...extra }).where(eq(contentItems.id, d.id));
      await log(c, "admin.content.update", "content_item", d.id, { ...before, bodyMd: `[${before.bodyMd.length} chars]` }, { ...values, bodyMd: `[${d.bodyMd.length} chars]`, ...extra });
      return { ok: true, message: note };
    }
    const [row] = await c.tx.insert(contentItems).values({ ...values, status: "draft", createdBy: c.auth.user.id }).returning({ id: contentItems.id });
    await log(c, "admin.content.create", "content_item", row.id, null, { ...values, bodyMd: `[${d.bodyMd.length} chars]` });
    newId = row.id;
  }, { revalidate: [P, ...PUBLIC, ...(d.id ? [`${P}/${d.id}`] : [])] });
  if (newId) redirect(`${P}/${newId}?created=1`);
  return res;
}

const transitionSchema = z.object({ id: uuid, to: z.enum(["draft", "in_review", "published", "retired"]) });

/** Workflow: draft → in_review → published (→ retired). Publishing a regulation/guide needs an approved specialist review. */
export async function transitionContent(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(transitionSchema, fd);
  if ("state" in r) return r.state;
  const { id, to } = r.data;
  const res = await staffAction("admin.content", async (c) => {
    const item = await loadItem(c.tx, id);
    const allowed: Record<string, string[]> = { draft: ["in_review", "retired"], in_review: ["draft", "published"], published: ["draft", "retired"], retired: ["draft"] };
    if (!allowed[item.status]?.includes(to)) throw new UserError(`لا يُنقل المحتوى من «${item.status}» إلى «${to}» مباشرة.`);
    const set: Partial<typeof contentItems.$inferInsert> = { status: to, updatedBy: c.auth.user.id };
    if (to === "published") {
      if (REVIEW_REQUIRED_KINDS.includes(item.kind)) {
        const [last] = await c.tx.select().from(contentReviews).where(eq(contentReviews.contentId, id)).orderBy(desc(contentReviews.at)).limit(1);
        if (!last || last.decision !== "approved" || !item.reviewedAt) throw new UserError("نشر الأنظمة والأدلة يحتاج مراجعة متخصص معتمدة على النص الحالي. سجّل المراجعة أولًا.");
      }
      if (!item.sourceRefs?.length && REVIEW_REQUIRED_KINDS.includes(item.kind)) throw new UserError("أضف مصدرًا واحدًا على الأقل قبل النشر.");
      set.publishedAt = new Date();
      if (!item.lastVerifiedAt) set.lastVerifiedAt = todayISO();
    }
    if (to === "draft" && item.status === "published") set.publishedAt = null;
    await c.tx.update(contentItems).set(set).where(eq(contentItems.id, id));
    await log(c, `admin.content.${to}`, "content_item", id, { status: item.status }, set);
    const msg: Record<string, string> = { in_review: "أُرسل المحتوى للمراجعة.", published: "نُشر المحتوى وظهر للزوار.", draft: "أُعيد المحتوى مسودة.", retired: "أُوقف المحتوى ولم يعد يظهر للزوار." };
    return { ok: true, message: msg[to] };
  }, { revalidate: [P, `${P}/${id}`, ...PUBLIC] });
  if (res.ok && res.message) redirect(`${P}/${id}?saved=${encodeURIComponent(res.message)}`);
  return res;
}

const reviewSchema = z.object({
  id: uuid,
  specialty: z.enum(["sharia", "legal", "finance"], { error: "اختر تخصص المراجعة." }),
  decision: z.enum(["approved", "changes_requested"], { error: "اختر نتيجة المراجعة." }),
  notes: z.string().trim().max(3000, "الملاحظات أطول من 3000 حرف.").optional().transform((v) => v || null),
});

/** Records a specialist review. Approval stamps the item as reviewed; requested changes return it to draft. */
export async function addReview(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(reviewSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  if (d.decision === "changes_requested" && !d.notes) return { error: "راجع الحقول المظللة.", fieldErrors: { notes: "اكتب التعديلات المطلوبة." } };
  return staffAction("admin.content", async (c) => {
    const item = await loadItem(c.tx, d.id);
    if (item.status === "retired") throw new UserError("أعد المحتوى مسودة قبل مراجعته.");
    const [rev] = await c.tx.insert(contentReviews).values({ contentId: d.id, reviewerId: c.auth.user.id, specialty: d.specialty, decision: d.decision, notes: d.notes }).returning({ id: contentReviews.id });
    const now = new Date();
    const set: Partial<typeof contentItems.$inferInsert> =
      d.decision === "approved"
        ? { reviewerSpecialty: d.specialty, reviewedBy: c.auth.user.id, reviewedAt: now, lastVerifiedAt: todayISO(), updatedBy: c.auth.user.id }
        : { reviewedAt: null, reviewedBy: null, status: item.status === "published" ? "published" : "draft", updatedBy: c.auth.user.id };
    await c.tx.update(contentItems).set(set).where(eq(contentItems.id, d.id));
    await log(c, "admin.content.review", "content_review", rev.id, null, { contentId: d.id, ...d });
    return { ok: true, message: d.decision === "approved" ? "سُجّلت المراجعة المعتمدة. يمكن النشر الآن." : "سُجّلت ملاحظات المراجعة وأُعيد المحتوى مسودة." };
  }, { revalidate: [P, `${P}/${d.id}`] });
}

export async function markVerified(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  return staffAction("admin.content", async (c) => {
    const item = await loadItem(c.tx, id);
    const today = todayISO();
    await c.tx.update(contentItems).set({ lastVerifiedAt: today, updatedBy: c.auth.user.id }).where(eq(contentItems.id, id));
    await log(c, "admin.content.verified", "content_item", id, { lastVerifiedAt: item.lastVerifiedAt }, { lastVerifiedAt: today });
    return { ok: true, message: "سُجّل التحقق من المصادر اليوم." };
  }, { revalidate: [`${P}/${id}`, ...PUBLIC] });
}

// ───────────── FAQs ─────────────

const faqSchema = z.object({
  id: z.string().optional(),
  question: reqText(8, "اكتب السؤال.", 400),
  answer: reqText(10, "اكتب الإجابة.", 5000),
  audience: z.string().trim().min(1, "اختر الفئة."),
  topic: reqText(2, "اكتب الموضوع.", 60),
  position: optInt(0, 100000),
  status: z.enum(["draft", "in_review", "published", "retired"]),
  source: optText(300),
});

export async function saveFaq(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(faqSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let newId: string | null = null;
  const res = await staffAction("admin.content", async (c) => {
    const { id: _id, ...rest } = d;
    const values = { ...rest, position: d.position ?? 0, updatedBy: c.auth.user.id };
    if (d.id) {
      const [before] = await c.tx.select().from(faqs).where(eq(faqs.id, d.id)).limit(1);
      if (!before) throw new UserError("السؤال غير موجود.");
      await c.tx.update(faqs).set(values).where(eq(faqs.id, d.id));
      await log(c, "admin.faq.update", "faq", d.id, before, values);
      return { ok: true, message: "حُفظ السؤال." };
    }
    const [row] = await c.tx.insert(faqs).values({ ...values, createdBy: c.auth.user.id }).returning({ id: faqs.id });
    await log(c, "admin.faq.create", "faq", row.id, null, values);
    newId = row.id;
  }, { revalidate: [`${P}/faqs`, "/faq", ...(d.id ? [`${P}/faqs/${d.id}`] : [])] });
  if (newId) redirect(`${P}/faqs/${newId}?created=1`);
  return res;
}

export async function deleteFaq(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const res = await staffAction("admin.content", async (c) => {
    const [before] = await c.tx.select().from(faqs).where(eq(faqs.id, id)).limit(1);
    if (!before) throw new UserError("السؤال غير موجود.");
    await c.tx.delete(faqs).where(eq(faqs.id, id));
    await log(c, "admin.faq.delete", "faq", id, before, null);
  }, { revalidate: [`${P}/faqs`, "/faq"] });
  if (res.ok) redirect(`${P}/faqs?deleted=1`);
  return res;
}

// ───────────── Glossary ─────────────

const termSchema = z.object({
  id: z.string().optional(),
  slug: z.string().trim().toLowerCase().refine(slugOk, "المعرّف بحروف إنجليزية صغيرة وشرطات، مثل nazir."),
  term: reqText(2, "اكتب المصطلح.", 120),
  definition: reqText(10, "اكتب التعريف.", 3000),
  synonyms: z.string().optional(),
  related: z.string().optional(),
  source: optText(300),
  status: z.enum(["draft", "in_review", "published", "retired"]),
});

export async function saveTerm(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(termSchema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  const related = splitList(d.related);
  if (related.some((s) => !slugOk(s))) return { error: "راجع الحقول المظللة.", fieldErrors: { related: "المصطلحات المرتبطة تُكتب بمعرّفاتها الإنجليزية مفصولة بفواصل." } };
  let newId: string | null = null;
  const res = await staffAction("admin.content", async (c) => {
    const [dup] = await c.tx.select({ id: glossaryTerms.id }).from(glossaryTerms).where(and(eq(glossaryTerms.slug, d.slug), d.id ? ne(glossaryTerms.id, d.id) : undefined)).limit(1);
    if (dup) throw new UserError(`المعرّف ${d.slug} مستخدم لمصطلح آخر.`);
    const values = { slug: d.slug, term: d.term, definition: d.definition, synonyms: splitList(d.synonyms), related, source: d.source, status: d.status, updatedBy: c.auth.user.id };
    if (d.id) {
      const [before] = await c.tx.select().from(glossaryTerms).where(eq(glossaryTerms.id, d.id)).limit(1);
      if (!before) throw new UserError("المصطلح غير موجود.");
      await c.tx.update(glossaryTerms).set(values).where(eq(glossaryTerms.id, d.id));
      await log(c, "admin.glossary.update", "glossary_term", d.id, before, values);
      return { ok: true, message: "حُفظ المصطلح." };
    }
    const [row] = await c.tx.insert(glossaryTerms).values({ ...values, createdBy: c.auth.user.id }).returning({ id: glossaryTerms.id });
    await log(c, "admin.glossary.create", "glossary_term", row.id, null, values);
    newId = row.id;
  }, { revalidate: [`${P}/glossary`, "/glossary", ...(d.id ? [`${P}/glossary/${d.id}`] : [])] });
  if (newId) redirect(`${P}/glossary/${newId}?created=1`);
  return res;
}

export async function deleteTerm(_: ActionState, fd: FormData): Promise<ActionState> {
  const id = String(fd.get("id") ?? "");
  const res = await staffAction("admin.content", async (c) => {
    const [before] = await c.tx.select().from(glossaryTerms).where(eq(glossaryTerms.id, id)).limit(1);
    if (!before) throw new UserError("المصطلح غير موجود.");
    await c.tx.delete(glossaryTerms).where(eq(glossaryTerms.id, id));
    await log(c, "admin.glossary.delete", "glossary_term", id, before, null);
  }, { revalidate: [`${P}/glossary`, "/glossary"] });
  if (res.ok) redirect(`${P}/glossary?deleted=1`);
  return res;
}
