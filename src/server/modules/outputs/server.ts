import "server-only";
import { and, asc, desc, eq, inArray, isNotNull } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { deliverables, documents, documentVersions, outputs, outputVersions, taskEvents, tasks, users, waqfs } from "@/server/db/schema";
import type { OutputGap, OutputSection, OutputSource } from "@/server/db/schema/operations";
import { getStorage, newStorageKey } from "@/server/adapters/storage";
import { encryptBuffer, sha256 } from "@/server/lib/crypto";
import { audit, nextNumber } from "@/server/lib/audit";
import { dataKeyFor, logAccess } from "@/server/modules/documents/core";
import { pdfShell, renderPdf } from "@/server/modules/pdf/render";
import { UserError } from "@/server/modules/_shared";
import type { RequestCtx } from "@/server/modules/requests/access";
import { SPECIALTY_LABEL, type OutputDef } from "./catalog";
import { OUTPUT_PDF_CSS, outputHtml } from "./render";

export type OutputRow = typeof outputs.$inferSelect;
export type VersionRow = typeof outputVersions.$inferSelect;

export async function outputsOf(tx: Tx, requestId: string) {
  return tx.select().from(outputs).where(eq(outputs.requestId, requestId)).orderBy(asc(outputs.createdAt));
}

export async function versionsOf(tx: Tx, outputId: string) {
  return tx.select().from(outputVersions).where(eq(outputVersions.outputId, outputId)).orderBy(desc(outputVersions.version));
}

export async function versionOf(tx: Tx, outputId: string, version: number) {
  const [v] = await tx.select().from(outputVersions).where(and(eq(outputVersions.outputId, outputId), eq(outputVersions.version, version))).limit(1);
  return v ?? null;
}

/** The output record of a request for a catalog output; created once (unique on request + output key). */
export async function ensureOutput(tx: Tx, rc: RequestCtx, def: OutputDef, actorId: string, taskId: string | null): Promise<OutputRow> {
  const [existing] = await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), eq(outputs.outputKey, def.key))).limit(1);
  if (existing) return existing;
  const number = await nextNumber(tx, "OUT");
  const [row] = await tx.insert(outputs).values({
    number, requestId: rc.req.id, waqfId: rc.req.waqfId, taskId, outputKey: def.key, title: def.title, specialty: def.specialty, reviewPolicy: def.review,
    createdBy: actorId, updatedBy: actorId,
  }).onConflictDoNothing().returning();
  if (row) return row;
  const [again] = await tx.select().from(outputs).where(and(eq(outputs.requestId, rc.req.id), eq(outputs.outputKey, def.key))).limit(1);
  return again;
}

/** Appends a version (history is never rewritten) and points the output at it. */
export async function addVersion(tx: Tx, o: OutputRow, v: { origin: "generated" | "regenerated" | "edited"; sections: OutputSection[]; gaps: OutputGap[]; sources: OutputSource[]; inputsHash: string | null; basedOn: number | null; note?: string | null; actorId: string }) {
  if (o.status === "approved") throw new UserError("المخرج معتمد؛ لا تُضاف إليه نسخ. افتح مراجعة جديدة إن لزم.");
  if (o.status === "in_review") throw new UserError("المخرج بانتظار المراجعة؛ يعدّله المراجع بإعادته للتعديل أولًا.");
  const version = o.currentVersion + 1;
  await tx.insert(outputVersions).values({
    outputId: o.id, requestId: o.requestId, waqfId: o.waqfId, version, origin: v.origin, basedOn: v.basedOn, sections: v.sections, gaps: v.gaps, sources: v.sources,
    inputsHash: v.inputsHash, note: v.note ?? null, createdBy: v.actorId,
  });
  await tx.update(outputs).set({ currentVersion: version, status: "draft", updatedBy: v.actorId }).where(eq(outputs.id, o.id));
  return version;
}

/** Everyone who prepared the output: authors of any version, and whoever submitted it for review. */
export async function preparersOf(tx: Tx, o: OutputRow) {
  const rows = await tx.select({ by: outputVersions.createdBy }).from(outputVersions).where(and(eq(outputVersions.outputId, o.id), isNotNull(outputVersions.createdBy)));
  return [...new Set([...rows.map((r) => r.by!), ...(o.submittedBy ? [o.submittedBy] : [])])];
}

/** Summary used by request guards: open drafts, pending reviews, approvals, and whether self-approval covers QA. */
export async function outputGate(tx: Tx, requestId: string, opts: { excludeCycles?: boolean } = {}) {
  const rows = (await outputsOf(tx, requestId)).filter((o) => !opts.excludeCycles || !o.outputKey.includes("@c"));
  return {
    total: rows.length,
    unfinished: rows.filter((o) => o.status === "draft" || o.status === "returned").length,
    inReview: rows.filter((o) => o.status === "in_review").length,
    approved: rows.filter((o) => o.status === "approved").length,
    rows,
  };
}

async function names(tx: Tx, ids: (string | null)[]) {
  const list = [...new Set(ids.filter((x): x is string => !!x))];
  if (!list.length) return new Map<string, string>();
  const rows = await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, list));
  return new Map(rows.map((r) => [r.id, r.name ?? "—"]));
}

/** Builds the PDF HTML of a version (draft banner unless it is the approved version). */
export async function outputDocHtml(tx: Tx, rc: RequestCtx, o: OutputRow, v: VersionRow, signedBy: string | null) {
  const [w] = rc.req.waqfId ? await tx.select({ name: waqfs.name, isDemo: waqfs.isDemo }).from(waqfs).where(eq(waqfs.id, rc.req.waqfId)).limit(1) : [];
  const returns = await tx.select({ by: taskEvents.actorUserId, at: taskEvents.at, note: taskEvents.note }).from(taskEvents).innerJoin(tasks, eq(tasks.id, taskEvents.taskId))
    .where(and(eq(tasks.requestId, o.requestId), eq(tasks.kind, "prepare_output"), eq(tasks.outputKey, o.outputKey), eq(taskEvents.action, "reopen")));
  const n = await names(tx, [v.createdBy, o.approvedBy, o.submittedBy, ...returns.map((r) => r.by)]);
  const isApprovedVersion = o.status === "approved" && o.approvedVersion === v.version;
  const html = outputHtml({
    number: o.number, title: o.title, specialty: SPECIALTY_LABEL[o.specialty], serviceLine: `${rc.service.code} — ${rc.service.nameAr}`, requestNumber: rc.req.number,
    waqfName: w?.name ?? null, version: v.version, status: isApprovedVersion ? "approved" : "draft",
    preparedBy: n.get(o.submittedBy ?? v.createdBy ?? "") ?? null, approvedBy: n.get(o.approvedBy ?? "") ?? null,
    approvedAt: o.approvedAt ? o.approvedAt.toISOString().slice(0, 10) : null, selfApproved: o.selfApproved, signedBy, isDemo: !!w?.isDemo,
    versionDate: v.createdAt.toISOString().slice(0, 10),
    reviewRounds: returns.filter((r) => r.note?.startsWith("أُعيد المخرج")).map((r) => `أعاده للتعديل ${n.get(r.by ?? "") ?? "—"} في ${r.at.toISOString().slice(0, 10)}`), workflowStatus: isApprovedVersion ? "approved" : o.status === "in_review" && o.currentVersion === v.version ? "in_review" : "draft",
  }, v.sections);
  return pdfShell(o.title, html, OUTPUT_PDF_CSS);
}

/** HTML of an output's live preview (no saved draft): same layout as a draft, marked as an unsaved preview, gaps listed. */
export async function previewDocHtml(tx: Tx, rc: RequestCtx, def: OutputDef, sections: OutputSection[], gaps: OutputGap[]) {
  const [w] = rc.req.waqfId ? await tx.select({ name: waqfs.name, isDemo: waqfs.isDemo }).from(waqfs).where(eq(waqfs.id, rc.req.waqfId)).limit(1) : [];
  const gapList: OutputSection = { key: "preview_gaps", title: "ما ينقص قبل الاعتماد", required: true, blocks: [{ type: "list", items: gaps.map((g) => ({ text: `${g.severity === "blocking" ? "نقص جوهري" : "تنبيه"}: ${g.label}${g.hint ? ` — ${g.hint}` : ""}`, prov: "system" as const })) }] };
  const html = outputHtml({
    number: "—", title: def.title, specialty: SPECIALTY_LABEL[def.specialty], serviceLine: `${rc.service.code} — ${rc.service.nameAr}`, requestNumber: rc.req.number,
    waqfName: w?.name ?? null, version: 0, status: "draft", preparedBy: null, approvedBy: null, approvedAt: null, selfApproved: false, signedBy: null, isDemo: !!w?.isDemo,
    versionDate: new Date().toISOString().slice(0, 10), workflowStatus: "preview",
  }, gaps.length ? [gapList, ...sections] : sections);
  return pdfShell(def.title, html, OUTPUT_PDF_CSS);
}

/** Stores a generated PDF in the documents vault (encrypted like any upload; generated, so no malware scan applies). */
async function storeGeneratedPdf(tx: Tx, p: { waqfId: string | null; requestId: string; title: string; data: Buffer; ownerUserId: string; fileName: string }) {
  const key = await dataKeyFor(tx, p.waqfId);
  const enc = encryptBuffer(p.data, key);
  const storageKey = newStorageKey({ waqfId: p.waqfId, userId: p.ownerUserId });
  await getStorage().put(storageKey, enc.ct);
  const [doc] = await tx.insert(documents).values({
    waqfId: p.waqfId, ownerUserId: p.ownerUserId, requestId: p.requestId, docType: "deliverable", title: p.title, confidentiality: "internal", status: "active",
    approvalStatus: "approved", currentVersion: 1, createdBy: p.ownerUserId, updatedBy: p.ownerUserId,
  }).returning({ id: documents.id });
  const [ver] = await tx.insert(documentVersions).values({
    documentId: doc.id, waqfId: p.waqfId, version: 1, storageKey, sha256: sha256(p.data), sizeBytes: p.data.length, mimeType: "application/pdf", originalName: p.fileName,
    encrypted: true, iv: enc.iv, authTag: enc.tag, scanStatus: "clean", scanDetail: "generated: platform output", uploadedBy: p.ownerUserId, changeNote: "نسخة معتمدة مولّدة من المنصة",
  }).returning({ id: documentVersions.id });
  await logAccess(tx, { documentId: doc.id, versionId: ver.id, waqfId: p.waqfId, userId: p.ownerUserId, action: "upload" });
  return doc.id;
}

/**
 * Releases approved outputs to the client (on the move to «awaiting client approval»): renders the approved version to
 * PDF once, stores it in the vault and attaches it to the output's delivery record. Idempotent.
 */
export async function releaseApprovedOutputs(tx: Tx, rc: RequestCtx, actorId: string, meta: { ip: string; userAgent: string }) {
  // Cycle outputs of continuous services are released one by one when their cycle is sent (see operations/continuous).
  const rows = (await outputsOf(tx, rc.req.id)).filter((o) => o.status === "approved" && !o.documentId && o.approvedVersion && !o.outputKey.includes("@c"));
  for (const o of rows) await releaseOutput(tx, rc, o, actorId, meta);
  return rows.length;
}

/** Renders one approved output to PDF, stores it in the vault and attaches it to its delivery record. Idempotent. */
export async function releaseOutput(tx: Tx, rc: RequestCtx, o: OutputRow, actorId: string, meta: { ip: string; userAgent: string }) {
  if (o.status !== "approved" || !o.approvedVersion) throw new UserError("يُرسل المخرج بعد اعتماده.");
  if (o.documentId) return o.documentId;
  const v = await versionOf(tx, o.id, o.approvedVersion);
  if (!v) throw new UserError("لا نسخة معتمدة لإرسالها.");
  const [d] = o.deliverableId ? await tx.select({ signedBy: deliverables.signedBy }).from(deliverables).where(eq(deliverables.id, o.deliverableId)).limit(1) : [];
  let pdf: Buffer;
  try {
    pdf = await renderPdf(await outputDocHtml(tx, rc, o, v, d?.signedBy ?? null), { headerTitle: o.title });
  } catch (err) {
    console.error("[outputs.release] render failed", err);
    throw new UserError("تعذر إنشاء ملف PDF للمخرج المعتمد الآن. أعد المحاولة بعد قليل.");
  }
  const docId = await storeGeneratedPdf(tx, { waqfId: rc.req.waqfId, requestId: rc.req.id, title: `${o.title} (${o.number})`, data: pdf, ownerUserId: o.approvedBy ?? actorId, fileName: `${o.number}-v${o.approvedVersion}.pdf` });
  await tx.update(outputs).set({ documentId: docId, updatedBy: actorId }).where(eq(outputs.id, o.id));
  if (o.deliverableId) await tx.update(deliverables).set({ documentId: docId, updatedBy: actorId }).where(eq(deliverables.id, o.deliverableId));
  await audit(tx, { actorUserId: actorId, action: "outputs.released", entityType: "output", entityId: o.id, waqfId: o.waqfId, ip: meta.ip, userAgent: meta.userAgent, after: { number: o.number, version: o.approvedVersion, documentId: docId } });
  return docId;
}
