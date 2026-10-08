import "server-only";
import { desc, eq, inArray } from "drizzle-orm";
import type { Auth } from "@/server/authz/context";
import { screeningResults, suspicionReports, users } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { decryptNullable } from "@/server/lib/crypto";
import { audit } from "@/server/lib/audit";
import { requestInfo } from "@/server/lib/request-info";
import { readPayload, withMlro } from "./shared";

async function staffNames(auth: Auth, ids: string[]) {
  const u = [...new Set(ids.filter(Boolean))];
  if (!u.length) return new Map<string, string>();
  const rows = await read(auth, (tx) => tx.select({ id: users.id, name: users.fullName }).from(users).where(inArray(users.id, u)));
  return new Map(rows.map((r) => [r.id, r.name ?? "—"]));
}

export async function mlroOverview(auth: Auth) {
  const { reports, screenings } = await withMlro(auth, async (tx) => ({
    reports: await tx.select().from(suspicionReports).orderBy(desc(suspicionReports.createdAt)).limit(200),
    screenings: await tx.select().from(screeningResults).orderBy(desc(screeningResults.createdAt)).limit(200),
  }));
  const names = await staffNames(auth, [...reports.map((r) => r.createdBy), ...screenings.map((s) => s.reviewedBy ?? "")]);
  return {
    reports: reports.map((r) => {
      const p = readPayload(r.summaryEnc);
      return { id: r.id, status: r.status, createdAt: r.createdAt, updatedAt: r.updatedAt, reportedToFiuOn: r.reportedToFiuOn, waqfNumber: p.waqfNumber, waqfName: p.waqfName, summary: p.summary, indicators: p.indicators, createdBy: names.get(r.createdBy) ?? "—" };
    }),
    screenings: screenings.map((s) => {
      let details: { label?: string; notes?: string } = {};
      try {
        details = JSON.parse(decryptNullable(s.detailsEnc) ?? "{}");
      } catch {}
      return { ...s, detailsEnc: undefined, label: details.label ?? s.subjectId, notes: details.notes ?? "", reviewer: s.reviewedBy ? names.get(s.reviewedBy) ?? "—" : null };
    }),
  };
}

export async function suspicionReport(auth: Auth, id: string) {
  const { ip, userAgent } = await requestInfo();
  // Reading a restricted record is itself recorded (who looked, when).
  const row = await withMlro(
    auth,
    async (tx) => (await tx.select().from(suspicionReports).where(eq(suspicionReports.id, id)).limit(1))[0],
    async (tx, r) => {
      if (r) await audit(tx, { actorUserId: auth.user.id, action: "mlro.report_viewed", entityType: "suspicion_report", entityId: r.id, ip, userAgent });
    },
  );
  if (!row) return null;
  const p = readPayload(row.summaryEnc);
  const names = await staffNames(auth, [row.createdBy]);
  return { ...row, summaryEnc: undefined, fiuReferenceEnc: undefined, fiuReference: decryptNullable(row.fiuReferenceEnc), payload: p, createdByName: names.get(row.createdBy) ?? "—" };
}
