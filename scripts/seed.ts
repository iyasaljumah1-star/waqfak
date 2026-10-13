/**
 * Seeds reference data (idempotent): roles & permissions, assessment bank, rules, obligations, penalties,
 * references & requirements, services, packages, templates, settings, feature flags, holidays, content.
 * Runs with the owner role (bypasses RLS). Demo data is separate: scripts/seed-demo.ts.
 */
import "dotenv/config";
import { and, eq, isNull, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as s from "../src/server/db/schema";
import { PERMISSIONS, ROLES } from "../src/server/authz/catalog";
import { AXES, FLAG_DEFS, QUESTIONS } from "../src/server/seed/data/assessment";
import { NEEDS, RULES } from "../src/server/seed/data/rules";
import { CATEGORIES, PACKAGES, SERVICES, WORKFLOWS } from "../src/server/seed/data/services";
import { HOLIDAYS, OBLIGATIONS, PENALTIES, PENALTY_NOTE, REFERENCES, REQUIREMENTS } from "../src/server/seed/data/compliance";
import { CONTRACT_TEMPLATES, FEATURE_FLAGS, LEGACY_NAZARA_FLAG_REASON, NOTIFICATION_TEMPLATES, SETTINGS } from "../src/server/seed/data/system";
import { ARTICLES, FAQS, GLOSSARY } from "../src/server/seed/data/content";

const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL });
const db = drizzle(pool, { schema: s, casing: "snake_case" });

async function seedRoles() {
  // Permissions that existed before this run: a permission added to the catalog later is granted once to the roles
  // that declare it (tracked in settings), without re-adding permissions an admin removed from a role.
  const before = new Set((await db.select({ key: s.permissions.key }).from(s.permissions)).map((p) => p.key));
  const [trackedRow] = await db.select().from(s.settings).where(eq(s.settings.key, "seed.granted_permissions")).limit(1);
  const granted = new Set<string>((trackedRow?.value as string[] | undefined) ?? [...before]);
  for (const [key, [nameAr, domain]] of Object.entries(PERMISSIONS)) {
    await db.insert(s.permissions).values({ key, nameAr, domain }).onConflictDoUpdate({ target: s.permissions.key, set: { nameAr, domain } });
  }
  const perms = await db.select().from(s.permissions);
  const pid = new Map(perms.map((p) => [p.key, p.id]));
  for (const [key, r] of Object.entries(ROLES)) {
    const [role] = await db.insert(s.roles).values({ key, nameAr: r.nameAr, scope: r.scope }).onConflictDoUpdate({ target: s.roles.key, set: { nameAr: r.nameAr, scope: r.scope } }).returning();
    // Only fill permissions for a role the first time (admin edits must survive re-seeding).
    const existing = await db.select().from(s.rolePermissions).where(eq(s.rolePermissions.roleId, role.id));
    if (existing.length === 0) {
      await db.insert(s.rolePermissions).values(r.permissions.map((p) => ({ roleId: role.id, permissionId: pid.get(p)! })));
    } else {
      const fresh = r.permissions.filter((p) => !granted.has(p));
      if (fresh.length) await db.insert(s.rolePermissions).values(fresh.map((p) => ({ roleId: role.id, permissionId: pid.get(p)! }))).onConflictDoNothing();
    }
  }
  const all = Object.keys(PERMISSIONS);
  await db.insert(s.settings).values({ key: "seed.granted_permissions", value: all }).onConflictDoUpdate({ target: s.settings.key, set: { value: all } });
}

async function seedAssessment() {
  const [existing] = await db.select().from(s.questionBankVersions).where(eq(s.questionBankVersions.version, 1));
  if (existing) return;
  const [ver] = await db.insert(s.questionBankVersions).values({ version: 1, status: "published", publishedAt: new Date(), notes: "الإصدار الأول المبني على ملفات المشروع" }).returning();
  await db.insert(s.assessmentAxes).values(AXES.map((a, i) => ({ bankVersionId: ver.id, code: a.code, nameAr: a.nameAr, description: a.description, weightSmall: String(a.weightSmall), weightMedium: String(a.weightMedium), weightLarge: String(a.weightLarge), position: i + 1 })));
  await db.insert(s.assessmentQuestions).values(QUESTIONS.map((q, i) => ({
    bankVersionId: ver.id, code: q.code, axisCode: q.axisCode, textAr: q.textAr, helpAr: q.helpAr ?? null, answerType: q.answerType,
    options: q.options ?? null, weight: q.weight, referenceText: q.referenceText ?? null, criticalFlagCode: q.criticalFlagCode ?? null,
    criticalWhen: q.criticalWhen ?? null, showIf: q.showIf ?? null, factKey: q.factKey ?? null, depth: q.depth ?? "basic", position: i + 1,
  })));
}

async function seedFlagsRules() {
  for (const f of FLAG_DEFS) {
    await db.insert(s.criticalFlagDefs).values({ ...f, penaltyCode: f.penaltyCode ?? null, axisCode: f.axisCode ?? null }).onConflictDoUpdate({ target: s.criticalFlagDefs.code, set: { titleAr: f.titleAr, referenceText: f.referenceText } });
  }
  for (const n of NEEDS) await db.insert(s.needs).values(n).onConflictDoNothing();
  for (const r of RULES) {
    await db.insert(s.recommendationRules).values({
      code: r.code, version: 1, status: "published", titleAr: r.titleAr, condition: r.condition, needCode: r.needCode, severity: r.severity,
      urgencyDays: r.urgencyDays, leverage: String(r.leverage ?? 1), reasonAr: r.reasonAr, whyItMattersAr: r.whyItMattersAr ?? null,
      reference: r.reference ?? null, serviceCodes: r.serviceCodes, suppressIf: r.suppressIf ?? null, selfServiceHintAr: r.selfServiceHintAr ?? null, publishedAt: new Date(),
    }).onConflictDoNothing();
  }
}

async function seedCompliance() {
  for (const r of REFERENCES) {
    await db.insert(s.regulatoryReferences).values({ ...r, bindingLevel: r.bindingLevel, verificationStatus: r.verificationStatus, lastVerifiedOn: r.verificationStatus === "verified" ? "2026-10-07" : null } as typeof s.regulatoryReferences.$inferInsert).onConflictDoNothing();
  }
  const refs = await db.select().from(s.regulatoryReferences);
  const refId = new Map(refs.map((r) => [r.code, r.id]));
  for (const q of REQUIREMENTS) {
    await db.insert(s.regulatoryRequirements).values({
      code: q.code, referenceId: refId.get(q.ref) ?? null, article: q.article ?? null, title: q.title, implementedAs: q.implementedAs,
      featureArea: q.featureArea, status: q.status ?? "implemented", verificationStatus: (q.verificationStatus as "verified" | "pending_verification") ?? "verified", exclusionReason: q.exclusionReason ?? null,
    }).onConflictDoNothing();
  }
  const reqs = await db.select().from(s.regulatoryRequirements);
  const reqId = new Map(reqs.map((r) => [r.code, r.id]));
  for (const o of OBLIGATIONS) {
    await db.insert(s.obligations).values({
      code: o.code, titleAr: o.titleAr, referenceText: o.ref, requirementId: o.req ? reqId.get(o.req) ?? null : null,
      authority: o.authority as "gaa", obligationType: o.type, triggerEvent: o.trigger, offsetValue: o.value, offsetUnit: o.unit,
      recurrence: o.recurrence ?? "none", appliesTo: o.appliesTo ?? {}, severity: o.severity, requiredAction: o.action, evidenceRequired: o.evidence ?? null,
      penaltyCode: o.penalty ?? null, defaultAssigneeRole: o.assignee ?? "nazir", reminderOffsetsDays: o.reminders ?? [30, 7, 1],
      status: "published", verificationStatus: o.verification ?? "verified", notes: o.notes ?? null,
    }).onConflictDoNothing();
  }
  for (const p of PENALTIES) {
    await db.insert(s.penaltySchedule).values({ ...p, largeText: null, mediumText: null, smallText: null, maxFine: 500000, notes: PENALTY_NOTE, verificationStatus: "pending_verification" }).onConflictDoNothing();
  }
  for (const [day, name] of HOLIDAYS) await db.insert(s.holidays).values({ day, name }).onConflictDoNothing();
}

async function seedServices() {
  for (const c of CATEGORIES) await db.insert(s.serviceCategories).values(c).onConflictDoNothing();
  const cats = await db.select().from(s.serviceCategories);
  const catId = new Map(cats.map((c) => [c.code, c.id]));
  for (const w of WORKFLOWS) await db.insert(s.workflowTemplates).values(w).onConflictDoNothing();
  let pos = 0;
  for (const x of SERVICES) {
    await db.insert(s.services).values({
      code: x.code, categoryId: catId.get(x.cat)!, nameAr: x.nameAr, summary: x.summary, outputs: x.outputs, pricingModel: x.pricingModel,
      basePrice: null, slaDays: x.slaDays ?? null, departmentKey: x.dept, regulatoryRestrictions: x.restriction ?? null,
      conflictRule: x.conflictRule ?? "none", requiresLicenseKey: x.license ?? null, workflowTemplateCode: x.workflow ?? (x.pricingModel === "hourly" ? "opinion" : "standard"),
      audiences: x.audiences, stage: x.stage ?? null, requiredDocuments: x.docs ?? [], position: pos++,
    }).onConflictDoUpdate({
      // Refresh seeded copy only on rows nobody edited from the admin panel (updated_by stays null until then).
      target: s.services.code,
      set: { nameAr: x.nameAr, summary: x.summary, outputs: x.outputs, regulatoryRestrictions: x.restriction ?? null, requiredDocuments: x.docs ?? [] },
      setWhere: sql`${s.services.updatedBy} is null`,
    });
  }
  const svcs = await db.select().from(s.services);
  const sid = new Map(svcs.map((x) => [x.code, x.id]));
  for (const p of PACKAGES) {
    const [pkg] = await db.insert(s.packages).values({ code: p.code, nameAr: p.nameAr, description: p.description, audience: p.audience, targetSizeClasses: p.targetSizeClasses, position: p.position, isClosed: p.isClosed ?? false }).onConflictDoNothing().returning();
    if (pkg) await db.insert(s.packageItems).values(p.services.map((c) => ({ packageId: pkg.id, serviceId: sid.get(c)! })));
  }
}

async function seedSystem() {
  // Templates have no updated_by: a row whose updated_at is not newer than the previous seed run was never edited → refresh its text.
  const [prev] = await db.select().from(s.settings).where(eq(s.settings.key, "seed.last_run_at"));
  const lastRun = prev ? new Date(String(prev.value)) : null;
  for (const t of NOTIFICATION_TEMPLATES) {
    await db.insert(s.notificationTemplates).values(t).onConflictDoUpdate({
      target: s.notificationTemplates.key,
      set: { titleAr: t.titleAr, bodyAr: t.bodyAr, updatedAt: new Date() },
      setWhere: lastRun ? sql`${s.notificationTemplates.updatedAt} <= ${lastRun.toISOString()}::timestamptz + interval '5 minutes'` : sql`true`, // first run of this logic: nothing has been edited through the admin yet
    });
  }
  for (const c of CONTRACT_TEMPLATES) {
    await db.insert(s.contractTemplates).values(c).onConflictDoUpdate({
      target: [s.contractTemplates.code, s.contractTemplates.version],
      set: { nameAr: c.nameAr, body: c.body },
      setWhere: sql`${s.contractTemplates.updatedBy} is null`,
    });
  }
  for (const [key, value, description] of SETTINGS) await db.insert(s.settings).values({ key, value, description }).onConflictDoNothing();
  for (const f of FEATURE_FLAGS) await db.insert(s.featureFlags).values(f).onConflictDoNothing();
  // N01 intake used to be switched off until the nazara licence; the licence now gates only the start of nazara
  // (activation), so an untouched legacy flag is re-seeded. A flag an admin changed (updated_by set) is left alone.
  const nz = FEATURE_FLAGS.find((f) => f.key === "service.nazara")!;
  await db
    .update(s.featureFlags)
    .set({ enabled: nz.enabled, description: nz.description, reason: nz.reason })
    .where(and(eq(s.featureFlags.key, nz.key), isNull(s.featureFlags.updatedBy), eq(s.featureFlags.reason, LEGACY_NAZARA_FLAG_REASON)));
}

async function seedContent() {
  // Seeded copy is refreshed on every run, except rows an editor changed in the admin CMS (updated_by set).
  for (const a of ARTICLES) {
    const { slug, kind, ...rest } = a;
    await db
      .insert(s.contentItems)
      .values({ ...a, status: "published", publishedAt: new Date(), lastVerifiedAt: "2026-10-07" })
      .onConflictDoUpdate({ target: [s.contentItems.kind, s.contentItems.slug], set: { ...rest }, setWhere: sql`${s.contentItems.updatedBy} is null` });
    void slug; void kind;
  }
  // FAQs have no natural key: replace the untouched seeded rows; keep rows created or edited by staff.
  const kept = await db.select({ position: s.faqs.position }).from(s.faqs).where(sql`${s.faqs.createdBy} is not null or ${s.faqs.updatedBy} is not null`);
  const keptPos = new Set(kept.map((k) => k.position));
  await db.delete(s.faqs).where(sql`${s.faqs.createdBy} is null and ${s.faqs.updatedBy} is null`);
  const fresh = FAQS.map((f, i) => ({ ...f, position: i })).filter((f) => !keptPos.has(f.position));
  if (fresh.length) await db.insert(s.faqs).values(fresh);
  for (const g of GLOSSARY) {
    await db.insert(s.glossaryTerms).values(g).onConflictDoUpdate({
      target: s.glossaryTerms.slug,
      set: { term: g.term, definition: g.definition, synonyms: g.synonyms, related: g.related, source: g.source ?? null },
      setWhere: sql`${s.glossaryTerms.updatedBy} is null`,
    });
  }
}

async function main() {
  await seedRoles();
  await seedAssessment();
  await seedFlagsRules();
  await seedCompliance();
  await seedServices();
  await seedSystem();
  await seedContent();
  await db.insert(s.settings).values({ key: "seed.last_run_at", value: new Date().toISOString() as never, description: "آخر تشغيل لبذر البيانات المرجعية" })
    .onConflictDoUpdate({ target: s.settings.key, set: { value: new Date().toISOString() as never } });
  await pool.end();
  console.log("reference data seeded");
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
