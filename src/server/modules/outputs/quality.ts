import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import type { Tx } from "@/server/db";
import { dataConflicts, outputOfficialRecords, outputReviews, users } from "@/server/db/schema";
import type { OutputCheck, OutputSection } from "@/server/db/schema/operations";
import { audit } from "@/server/lib/audit";
import type { RequestCtx } from "@/server/modules/requests/access";
import { dataHash } from "./build";
import { checkBlockers, type CheckReview } from "./checks";
import type { Conflict } from "./conflicts";
import { draftInputs } from "./live";
import { readiness } from "./pure";
import { requirementsOf } from "./requirements";
import type { OutputRow, VersionRow } from "./server";

/**
 * Output quality on the server: the register of data conflicts (kept in step with what detection finds), the
 * specialist's findings, and the gate every transition passes — re-run on the live data, never trusted from the screen.
 */

type Meta = { actorId: string; ip: string; userAgent: string; outputId?: string | null; reason?: string };

/**
 * Brings the conflict register in line with a detection run: new conflicts are opened, those still found are touched,
 * and open ones no longer found are resolved — by whoever ran the validation after the data was corrected, with how.
 */
export async function syncConflicts(tx: Tx, rc: RequestCtx, found: Conflict[], m: Meta) {
  const open = await tx.select().from(dataConflicts).where(and(eq(dataConflicts.requestId, rc.req.id), eq(dataConflicts.status, "open")));
  const byKey = new Map(open.map((r) => [r.conflictKey, r]));
  const now = new Date();
  const opened: string[] = [];
  const resolved: string[] = [];
  for (const c of found) {
    const row = byKey.get(c.key);
    if (row) {
      await tx.update(dataConflicts).set({ lastSeenAt: now, sides: c.sides, label: c.label, action: c.action, fields: c.fields, severity: c.severity }).where(eq(dataConflicts.id, row.id));
      continue;
    }
    await tx.insert(dataConflicts).values({
      requestId: rc.req.id, waqfId: rc.req.waqfId, outputId: m.outputId ?? null, conflictKey: c.key, severity: c.severity, label: c.label, sides: c.sides,
      action: c.action, fields: c.fields, detectedBy: m.actorId, detectedAt: now, lastSeenAt: now,
    }).onConflictDoNothing();
    opened.push(c.key);
  }
  const keys = new Set(found.map((c) => c.key));
  for (const r of open.filter((x) => !keys.has(x.conflictKey))) {
    const resolution = `لم يعد قائمًا عند إعادة التحقق بعد تصحيح البيانات${m.reason ? ` (${m.reason})` : ""}.`;
    await tx.update(dataConflicts).set({ status: "resolved", resolvedAt: now, resolvedBy: m.actorId, resolution }).where(eq(dataConflicts.id, r.id));
    resolved.push(r.conflictKey);
  }
  if (opened.length || resolved.length)
    await audit(tx, { actorUserId: m.actorId, action: "outputs.conflicts_sync", entityType: "service_request", entityId: rc.req.id, waqfId: rc.req.waqfId, ip: m.ip, userAgent: m.userAgent, after: { opened, resolved, reason: m.reason } });
  return { opened, resolved, open: found };
}

/** The conflict register of a request (open first, then history), with the names of who detected or resolved. */
export async function conflictRegister(tx: Tx, requestId: string) {
  const rows = await tx.select().from(dataConflicts).where(eq(dataConflicts.requestId, requestId)).orderBy(desc(dataConflicts.detectedAt)).limit(100);
  const ids = [...new Set(rows.flatMap((r) => [r.detectedBy, r.resolvedBy]).filter((x): x is string => !!x))];
  const names = ids.length ? new Map((await tx.select({ id: users.id, n: users.fullName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u.n ?? "—"])) : new Map<string, string>();
  return rows.sort((a, b) => (a.status === b.status ? 0 : a.status === "open" ? -1 : 1)).map((r) => ({ ...r, detectedByName: names.get(r.detectedBy ?? "") ?? null, resolvedByName: names.get(r.resolvedBy ?? "") ?? null }));
}

/** Latest specialist finding per check / per citation of a version (append-only log; newest wins). */
export async function reviewsOf(tx: Tx, outputId: string, version?: number) {
  const rows = await tx.select({ r: outputReviews, by: users.fullName }).from(outputReviews).leftJoin(users, eq(users.id, outputReviews.createdBy))
    .where(version === undefined ? eq(outputReviews.outputId, outputId) : and(eq(outputReviews.outputId, outputId), eq(outputReviews.version, version))).orderBy(desc(outputReviews.createdAt));
  const checks = new Map<string, CheckReview & { byName: string | null }>();
  const citations = new Map<string, { status: string; note: string; location: string | null; by: string; byName: string | null; at: string; version: number }>();
  for (const { r, by } of rows) {
    if (r.kind === "check" && !checks.has(r.targetKey)) checks.set(r.targetKey, { key: r.targetKey, status: r.status as CheckReview["status"], note: r.note, by: r.createdBy, byName: by, at: r.createdAt.toISOString(), version: r.version });
    if (r.kind === "citation" && !citations.has(r.targetKey)) citations.set(r.targetKey, { status: r.status, note: r.note, location: r.location, by: r.createdBy, byName: by, at: r.createdAt.toISOString(), version: r.version });
  }
  return { checks, citations, log: rows };
}

export async function officialRecordsOf(tx: Tx, outputId: string) {
  return tx.select({ r: outputOfficialRecords, by: users.fullName }).from(outputOfficialRecords).leftJoin(users, eq(users.id, outputOfficialRecords.createdBy))
    .where(eq(outputOfficialRecords.outputId, outputId)).orderBy(desc(outputOfficialRecords.createdAt));
}

export const checksOf = (sections: OutputSection[]): OutputCheck[] =>
  sections.flatMap((s) => s.blocks.flatMap((b) => (b.type === "checks" ? b.items : [])));

/**
 * The gate of a transition, on live data: the version's gaps and unwritten parts, conflicts found now in the request's
 * data (synced to the register), whether the data changed after the version was drafted, failed checks, and — for
 * approval — checks still waiting for a specialist's finding.
 */
export async function transitionGate(tx: Tx, rc: RequestCtx, o: OutputRow, cur: VersionRow, mode: "submit" | "approve", m: Meta) {
  const errors: string[] = [];
  const inp = await draftInputs(tx, rc, o.outputKey);
  const live = inp?.ctx.conflicts ?? [];
  await syncConflicts(tx, rc, live, { ...m, outputId: o.id, reason: mode === "submit" ? "عند الإرسال للمراجعة" : "عند الاعتماد" });
  const material = live.filter((c) => c.severity === "material");
  if (material.length) errors.push(...material.map((c) => `تعارض قائم: ${c.label}`));
  if (inp && cur.dataHash && cur.dataHash !== dataHash(inp.ctx)) errors.push("تغيّرت بيانات الطلب بعد إعداد هذه النسخة: أعد توليد المسودة لتُبنى على البيانات الحالية.");
  const ready = readiness(cur.sections, cur.gaps);
  errors.push(...ready.blocking.filter((g) => !material.some((c) => `conflict:${c.key}` === g.key)).map((g) => g.label), ...ready.unwritten.map((u) => `لم يُكتب: ${u.section}`));
  const reviews = await reviewsOf(tx, o.id, cur.version);
  const cb = checkBlockers(checksOf(cur.sections), [...reviews.checks.values()]);
  errors.push(...cb.failed.map((c) => `فشل التحقق: ${c.label}`));
  if (mode === "approve") errors.push(...cb.pendingSpecialist.map((c) => `بانتظار رأي المختص: ${c.label}`));
  return { errors, live, requirements: requirementsOf({ serviceCode: rc.service.code, keys: inp?.ctx.keys ?? {}, tables: inp?.ctx.tables ?? {}, gaps: cur.gaps, checks: checksOf(cur.sections), reviews: [...reviews.checks.values()] }) };
}
