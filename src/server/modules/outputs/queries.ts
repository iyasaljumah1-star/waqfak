import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ForbiddenError, type Auth } from "@/server/authz/context";
import { outputs, outputVersions, users } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { outputsFor, PROFILE_FORMAT, REVIEW_LABEL, SPECIALTY_LABEL } from "./catalog";
import { diffVersions, readiness } from "./pure";
import { preparersOf } from "./server";
import { livePreview } from "./live";
import { cycleOutputFor } from "@/server/modules/operations/continuous";
import { parseCycleKey } from "@/server/modules/operations/continuous-pure";

/** The output editor page: the output, its versions, the selected version and an optional comparison. */
export async function outputPageData(auth: Auth, requestId: string, outputId: string, opts: { v?: number; a?: number; b?: number }) {
  return read(auth, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, requestId, "staff");
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
    const [o] = await tx.select().from(outputs).where(and(eq(outputs.id, outputId), eq(outputs.requestId, requestId))).limit(1);
    if (!o) return null;
    const versions = await tx.select().from(outputVersions).where(eq(outputVersions.outputId, o.id)).orderBy(desc(outputVersions.version));
    const current = versions.find((v) => v.version === (opts.v ?? o.currentVersion)) ?? versions[0] ?? null;
    const a = opts.a ? versions.find((v) => v.version === opts.a) : null;
    const b = opts.b ? versions.find((v) => v.version === opts.b) : null;
    const ids = [...new Set([...versions.map((v) => v.createdBy), o.approvedBy, o.submittedBy].filter((x): x is string => !!x))];
    const people = ids.length ? await tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, ids)) : [];
    const def = outputsFor(rc.service).find((d) => d.key === o.outputKey) ?? (await cycleOutputFor(tx, rc, o.outputKey))?.def ?? null;
    const cycle = parseCycleKey(o.outputKey) ? (await cycleOutputFor(tx, rc, o.outputKey))?.cycle ?? null : null;
    return {
      rc, o, def, versions: versions.map((v) => ({ version: v.version, origin: v.origin, basedOn: v.basedOn, note: v.note, createdBy: v.createdBy, createdAt: v.createdAt })),
      current, isCurrent: !!current && current.version === o.currentVersion,
      ready: current ? readiness(current.sections, current.gaps) : null,
      diff: a && b ? { a: a.version, b: b.version, rows: diffVersions(a.sections, b.sections) } : null,
      preparers: await preparersOf(tx, o),
      names: new Map(people.map((p) => [p.id, p.name ?? "—"])),
      specialtyLabel: SPECIALTY_LABEL[o.specialty], reviewLabel: REVIEW_LABEL[o.reviewPolicy], formatLabel: def ? PROFILE_FORMAT[def.profile] : "مخرج",
      delivered: o.status === "approved" && !!o.documentId && (!!cycle?.sentAt || ["awaiting_client_approval", "completed", "closed"].includes(rc.req.status)),
      cycle: cycle ? { id: cycle.id, label: cycle.label, status: cycle.status, dueOn: cycle.dueOn } : null,
    };
  });
}

/**
 * Preview of an output with no saved draft: built live from the request's current data (nothing is stored). When a
 * draft already exists, its id is returned so the page opens the saved draft instead.
 */
export async function outputPreviewData(auth: Auth, requestId: string, outputKey: string) {
  return read(auth, async (tx) => {
    let rc;
    try {
      rc = await loadRequestCtx(tx, auth, requestId, "staff");
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
    const [existing] = await tx.select({ id: outputs.id }).from(outputs).where(and(eq(outputs.requestId, requestId), eq(outputs.outputKey, outputKey))).limit(1);
    if (existing) return { rc, existingId: existing.id, preview: null };
    const preview = await livePreview(tx, rc, outputKey);
    if (!preview) return null;
    return {
      rc, existingId: null, preview,
      specialtyLabel: SPECIALTY_LABEL[preview.def.specialty], reviewLabel: REVIEW_LABEL[preview.def.review], formatLabel: PROFILE_FORMAT[preview.def.profile],
    };
  });
}
