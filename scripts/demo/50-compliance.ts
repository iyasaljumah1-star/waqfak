/**
 * Demo compliance data (fictional, marked "(تجريبي)"). Run by seed-demo after the core data, or directly:
 *   npx tsx --conditions=react-server scripts/demo/50-compliance.ts
 * Idempotent: events dedupe on waqf + obligation + period; evidence documents are reused by title.
 *
 * Result (today = 2026-10-07): A has an overdue material-change update, due-soon BO update and GAA request,
 * an upcoming certificate renewal and FY2025 items done with evidence; B has an overdue annual BO verification;
 * C has a due-soon donations-licence extension and a violation with its objection deadline.
 */
import "../jobs/_shim";
import "dotenv/config";
import { readFileSync } from "node:fs";
import { and, eq, like } from "drizzle-orm";
import { withSystem, type Tx } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import type { Auth } from "../../src/server/authz/context";
import { emit, recomputeStatuses, sync } from "../../src/server/modules/compliance/engine";

type Ctx = { users: Record<string, string>; waqfs: { A: string; B: string; C: string } };

const DEMO_META = { ip: "demo-seed", userAgent: "scripts/demo/50-compliance.ts" };

/** Minimal Auth for server-side demo uploads (the documents service only reads id / staff / global flags). */
const actorAuth = (userId: string) =>
  ({ user: { id: userId, mfaEnabled: false }, session: { mfaVerified: true }, globalRoles: [], perms: new Set<string>(), globalAccess: false, isStaff: false, db: { userId, globalAccess: false } }) as unknown as Auth;

async function evidenceDoc(tx: Tx, waqfId: string, userId: string, title: string, docType: string, extra: { number?: string; issuedOn?: string; expiresOn?: string } = {}) {
  const [existing] = await tx.select({ id: s.documents.id }).from(s.documents).where(and(eq(s.documents.waqfId, waqfId), eq(s.documents.title, title))).limit(1);
  if (existing) return existing.id;
  try {
    const { ingestUpload } = await import("../../src/server/modules/documents/service");
    const body = `${title}\nوثيقة تجريبية أنشأها سكربت العرض — لا تمثل مستندًا حقيقيًا.\n`;
    const r = await ingestUpload(
      tx,
      actorAuth(userId),
      DEMO_META,
      { data: Buffer.from(body, "utf8"), originalName: "demo-evidence.txt", kind: "txt", mime: "text/plain", waqfId, docType, title, confidentiality: "internal", number: extra.number ?? null, issuedOn: extra.issuedOn ?? null, expiresOn: extra.expiresOn ?? null },
      () => undefined,
    );
    return r.documentId;
  } catch (e) {
    // Documents module not available: create a metadata-only record so the demo still shows evidence titles.
    console.warn("  · documents service unavailable, creating metadata-only evidence:", (e as Error).message);
    const [d] = await tx
      .insert(s.documents)
      .values({ waqfId, ownerUserId: userId, docType, title, number: extra.number ?? null, issuedOn: extra.issuedOn ?? null, expiresOn: extra.expiresOn ?? null, status: "active", createdBy: userId })
      .returning({ id: s.documents.id });
    return d.id;
  }
}

async function instanceOf(tx: Tx, waqfId: string, code: string, periodKey?: string) {
  const rows = await tx
    .select({ i: s.obligationInstances })
    .from(s.obligationInstances)
    .innerJoin(s.obligations, eq(s.obligations.id, s.obligationInstances.obligationId))
    .where(and(eq(s.obligationInstances.waqfId, waqfId), eq(s.obligations.code, code), periodKey ? eq(s.obligationInstances.periodKey, periodKey) : like(s.obligationInstances.periodKey, "%")));
  return rows[0]?.i ?? null;
}

/** Marks an instance done with evidence (as the waqf manager would from the compliance tab). */
async function complete(tx: Tx, waqfId: string, userId: string, code: string, periodKey: string, completedOn: string, evidenceTitle: string, docType: string) {
  const inst = await instanceOf(tx, waqfId, code, periodKey);
  if (!inst || inst.status === "done") return;
  const docId = await evidenceDoc(tx, waqfId, userId, evidenceTitle, docType, { issuedOn: completedOn });
  await tx.insert(s.documentLinks).values({ documentId: docId, entityType: "obligation_instance", entityId: inst.id, waqfId }).onConflictDoNothing();
  await tx
    .update(s.obligationInstances)
    .set({ status: "done", completedAt: new Date(`${completedOn}T12:00:00+03:00`), completedBy: userId, evidenceDocumentId: docId })
    .where(eq(s.obligationInstances.id, inst.id));
  await tx.insert(s.obligationEvents).values([
    { instanceId: inst.id, waqfId, action: "evidence", note: evidenceTitle, actorUserId: userId },
    { instanceId: inst.id, waqfId, action: "completed", note: "(تجريبي)", actorUserId: userId },
  ]);
}

export default async function demoCompliance(tx: Tx, ctx: Ctx) {
  const { A, B, C } = ctx.waqfs;
  const u = ctx.users;

  // ── Standing / annual instances first
  for (const w of [A, B, C]) await sync(tx, w);

  // ── A: medium public waqf, registered; certificate expires 2027-05-01
  await emit(tx, { waqfId: A, event: "documentation", date: "2023-03-14", actorUserId: u.nazir });
  await emit(tx, { waqfId: A, event: "registration", date: "2023-05-02", actorUserId: u.nazir });
  await evidenceDoc(tx, A, u.nazir, "شهادة تسجيل الوقف (تجريبي)", "registration_certificate", { number: "DEMO-REG-001", issuedOn: "2023-05-02", expiresOn: "2027-05-01" });
  await emit(tx, { waqfId: A, event: "cert_expiry", date: "2027-05-01", actorUserId: u.nazir });
  await complete(tx, A, u.nazir, "OB-FIN-01", "FY2025", "2025-12-18", "الموازنة التقديرية 2026 المعتمدة (تجريبي)", "financial_statement");
  await complete(tx, A, u.nazir, "OB-BO-02", "FY2025", "2025-12-28", "حزمة التحقق السنوي من المستفيد الحقيقي 2025 (تجريبي)", "other");
  await complete(tx, A, u.nazir, "OB-GOV-02", "FY2025", "2025-12-20", "قرار مراجعة سياسات التحصيل والصرف والاستثمار (تجريبي)", "resolution");
  await complete(tx, A, u.nazir, "OB-DIS-01", "FY2025", "2026-03-10", "كشف صرف عوائد 2025 (تجريبي)", "bank_statement");
  const stA = await evidenceDoc(tx, A, u.nazir, "القوائم المالية المدققة 2025 (تجريبي)", "financial_statement", { issuedOn: "2026-04-20" });
  await emit(tx, { waqfId: A, event: "statements_final", date: "2026-04-20", refId: stA, meta: { documentId: stA }, actorUserId: u.nazir });
  await complete(tx, A, u.nazir, "OB-FIN-04", `ref:${stA}`, "2026-04-29", "إيصال رفع البيانات المالية للهيئة (تجريبي)", "official_letter");
  await emit(tx, { waqfId: A, event: "material_change", date: "2026-09-01", refId: "8a1f0c52-0000-4000-8000-00000000a001", actorUserId: u.nazir }); // → overdue
  await emit(tx, { waqfId: A, event: "bo_change", date: "2026-09-28", refId: "8a1f0c52-0000-4000-8000-00000000a002", actorUserId: u.nazir }); // → due soon
  await emit(tx, { waqfId: A, event: "gaa_request", date: "2026-10-01", refId: "8a1f0c52-0000-4000-8000-00000000a003", dueOverride: "2026-10-18", actorUserId: u.nazir }); // → due soon

  // ── B: small private waqf with a documentation date
  await emit(tx, { waqfId: B, event: "documentation", date: "2024-09-02", actorUserId: u.waqif });
  await complete(tx, B, u.waqif, "OB-DIS-01", "FY2025", "2026-02-15", "كشف صرف غلة 2025 للمستحقين (تجريبي)", "bank_statement");

  // ── C: large public waqf, board, FYE 12-31, donations licence
  await emit(tx, { waqfId: C, event: "donation_license_expiry", date: "2026-11-05", refId: "8a1f0c52-0000-4000-8000-00000000c001", actorUserId: u.chair }); // → due soon
  await complete(tx, C, u.chair, "OB-FIN-01", "FY2025", "2025-12-22", "موازنة 2026 المعتمدة من مجلس النظارة (تجريبي)", "resolution");
  await complete(tx, C, u.chair, "OB-BO-02", "FY2025", "2025-12-30", "حزمة المستفيد الحقيقي 2025 (تجريبي)", "other");
  await complete(tx, C, u.chair, "OB-GOV-02", "FY2025", "2025-12-15", "محضر مراجعة اللوائح والسياسات 2025 (تجريبي)", "minutes");
  await complete(tx, C, u.chair, "OB-DIS-01", "FY2025", "2026-03-25", "كشف صرف عوائد 2025 (تجريبي)", "bank_statement");
  const stC = await evidenceDoc(tx, C, u.chair, "القوائم المالية المدققة 2025 (تجريبي)", "financial_statement", { issuedOn: "2026-04-28" });
  await emit(tx, { waqfId: C, event: "statements_final", date: "2026-04-28", refId: stC, meta: { documentId: stC }, actorUserId: u.chair });
  await complete(tx, C, u.chair, "OB-FIN-04", `ref:${stC}`, "2026-05-07", "إيصال رفع القوائم المدققة للهيئة (تجريبي)", "official_letter");
  const [existingV] = await tx.select({ id: s.violations.id }).from(s.violations).where(and(eq(s.violations.waqfId, C), eq(s.violations.authorityRef, "DEMO-GAA-1448-0915"))).limit(1);
  if (!existingV) {
    const [v] = await tx
      .insert(s.violations)
      .values({ waqfId: C, penaltyCode: "5-6", occurrence: 1, noticedOn: "2026-09-15", authorityRef: "DEMO-GAA-1448-0915", sanction: "إنذار (تجريبي)", status: "open", correctiveDeadline: "2026-11-15", createdBy: u.chair })
      .returning({ id: s.violations.id });
    await emit(tx, { waqfId: C, event: "violation_decision", date: "2026-09-15", refId: v.id, actorUserId: u.chair }); // → objection deadline
  }

  await recomputeStatuses(tx);
}

// Direct run: reads the demo context from storage/demo-credentials.json.
if (process.argv[1]?.includes("50-compliance")) {
  const creds = JSON.parse(readFileSync("storage/demo-credentials.json", "utf8")) as { waqfs: Ctx["waqfs"]; users: Record<string, { id: string }> };
  const ctx: Ctx = { waqfs: creds.waqfs, users: Object.fromEntries(Object.entries(creds.users).map(([k, v]) => [k, v.id])) };
  withSystem((tx) => demoCompliance(tx, ctx)).then(
    () => {
      console.log("✓ demo compliance data");
      process.exit(0);
    },
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
