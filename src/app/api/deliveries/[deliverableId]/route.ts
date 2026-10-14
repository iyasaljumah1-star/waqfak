import type { NextRequest } from "next/server";
import { and, eq, isNotNull } from "drizzle-orm";
import { withContext } from "@/server/db";
import { deliverables, serviceCycles } from "@/server/db/schema";
import { ForbiddenError, getAuth } from "@/server/authz/context";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { jsonError } from "@/server/modules/documents/http";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /api/deliveries/[deliverableId] — opens a delivered file of a continuous-service cycle. The first time a client
 * party of the request opens it, the cycle records «اطّلع عليه العميل» (the platform records only what happened).
 * Access is checked here on the request, then again by /api/files on the document itself.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ deliverableId: string }> }) {
  const { deliverableId } = await ctx.params;
  const auth = await getAuth();
  if (!auth || (auth.user.mfaEnabled && !auth.session.mfaVerified)) return jsonError(401, "سجّل الدخول أولًا.");
  if (!UUID.test(deliverableId)) return jsonError(404, "الملف غير موجود.");
  const out = await withContext(auth.db, async (tx) => {
    const [d] = await tx.select().from(deliverables).where(and(eq(deliverables.id, deliverableId), isNotNull(deliverables.releasedAt), isNotNull(deliverables.cycleId))).limit(1);
    if (!d || !d.documentId) return null;
    try {
      const rc = await loadRequestCtx(tx, auth, d.requestId, "any");
      if (!rc.clientSide && !rc.staffSide) return null;
      if (rc.clientSide && !auth.isStaff) {
        const [cy] = await tx.select().from(serviceCycles).where(eq(serviceCycles.id, d.cycleId!)).limit(1);
        if (cy && !cy.viewedAt && cy.sentAt) {
          const now = new Date();
          await tx.update(serviceCycles).set({ viewedAt: now, clientEvents: [...(cy.clientEvents ?? []), { at: now.toISOString(), by: auth.user.id, kind: "viewed", version: d.version, note: null }] }).where(eq(serviceCycles.id, cy.id));
        }
      }
      return d.documentId;
    } catch (e) {
      if (e instanceof ForbiddenError) return null;
      throw e;
    }
  });
  if (!out) return jsonError(404, "الملف غير موجود أو لا تملك صلاحية الوصول إليه.");
  return new Response(null, { status: 303, headers: { Location: `/api/files/${out}?disposition=inline` } });
}
