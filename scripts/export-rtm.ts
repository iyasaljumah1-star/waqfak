/**
 * Exports the Requirement Traceability Matrix from the live database (the admin edits it at /admin/traceability):
 *   Source → Requirement → Feature (rule/obligation/flag/…) → Page / API / Database → Status
 * Run: npx tsx --conditions=react-server scripts/export-rtm.ts   → docs/RTM.md + docs/RTM.csv
 */
import "dotenv/config";
import { writeFileSync } from "node:fs";
import { Pool } from "pg";

const AREA: Record<string, { pages: string; api: string; db: string }> = {
  assessment: { pages: "/assessment, /app/assessments, /app/w/[id]/assessments, /admin/assessments", api: "/api/reports/assessment/[id]", db: "assessments, assessment_answers, axis_scores, critical_flags, recommendations, action_plans" },
  authz: { pages: "/admin/users/roles, /app/w/[id]/settings", api: "server actions (RBAC+ABAC) + PostgreSQL RLS", db: "roles, role_permissions, waqf_memberships, delegations" },
  beneficiaries: { pages: "/app/w/[id]/beneficiaries, /app/b/[waqfId]", api: "server actions", db: "beneficiary_classes, beneficiaries, entitlements, distributions, beneficial_owners" },
  billing: { pages: "/app/billing, /admin/finance", api: "server actions, payment adapter", db: "invoices, payments" },
  compliance: { pages: "/app/w/[id]/compliance, /app/calendar, /admin/compliance", api: "/api/jobs/daily, compliance engine", db: "obligations, obligation_instances, obligation_events, violations, penalty_schedule" },
  contracts: { pages: "/app/requests/[id], /admin/requests/[id]", api: "server actions (OTP e-sign)", db: "contract_templates, contracts, contract_signatures" },
  documents: { pages: "/app/w/[id]/documents, /s/[token]", api: "/api/files, /api/files/[documentId]", db: "documents, document_versions, document_access_log, document_shares" },
  establish: { pages: "/app/establish, /app/wills", api: "server actions", db: "waqfs (draft), deed_versions" },
  finance: { pages: "/app/w/[id]/finance", api: "server actions", db: "bank_accounts, budgets, ledger_entries, financial_statements" },
  governance: { pages: "/app/w/[id]/governance, /app/w/[id]/governance/meetings/[mid]", api: "server actions", db: "meetings, conflict_declarations, votes, resolutions, minutes, minute_signatures, policies" },
  integrations: { pages: "/app/w/[id]/reports", api: "export packages (PDF)", db: "reports" },
  investment: { pages: "/app/w/[id]/assets", api: "server actions", db: "assets, portfolios, investment_policies, investments" },
  launch: { pages: "/admin/settings", api: "—", db: "settings, feature_flags" },
  privacy: { pages: "/app/privacy, /admin/notifications/privacy, /legal/privacy", api: "server actions", db: "consents, data_subject_requests" },
  reports: { pages: "/app/w/[id]/reports", api: "PDF renderer", db: "reports, report_shares" },
  requests: { pages: "/app/requests, /app/requests/new, /admin/requests", api: "workflow engine (server actions)", db: "service_requests, request_stages, request_events, deliverables" },
  scope: { pages: "—", api: "—", db: "—" },
  security: { pages: "/app/security, /admin/audit", api: "auth actions, audit chain", db: "sessions, mfa_factors, audit_logs" },
  settings: { pages: "/admin/settings", api: "server actions", db: "settings, feature_flags" },
  waqf: { pages: "/app/waqfs, /app/w/[id], /app/w/[id]/identity, /app/w/[id]/parties", api: "server actions", db: "waqfs, waqf_classifications, waqf_registrations, trustees" },
};

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL });
  const { rows } = await pool.query(`
    select q.code, q.article, q.title, q.feature_area, q.status, q.verification_status, q.implemented_as, q.exclusion_reason,
           r.code ref_code, r.source_name, r.binding_level
    from regulatory_requirements q left join regulatory_references r on r.id = q.reference_id order by q.code`);
  await pool.end();
  const esc = (s: unknown) => String(s ?? "—").replace(/\|/g, "\\|").replace(/\n/g, " ");
  const md = [
    "# Requirement Traceability Matrix — وقفك",
    "",
    `Generated from the live database on ${new Date().toISOString().slice(0, 10)}. Source of truth: /admin/traceability (editable without code changes).`,
    "",
    `Total: ${rows.length} · implemented: ${rows.filter((r) => r.status === "implemented").length} · pending verification: ${rows.filter((r) => r.status === "pending_verification" || r.verification_status === "pending_verification").length} · planned: ${rows.filter((r) => r.status === "planned").length} · excluded: ${rows.filter((r) => r.status === "excluded").length}`,
    "",
    "| Req | Source (article) | Requirement | Implemented as | Pages | API | Database | Status |",
    "|---|---|---|---|---|---|---|---|",
    ...rows.map((r) => {
      const a = AREA[r.feature_area] ?? { pages: "—", api: "—", db: "—" };
      const impl = (r.implemented_as as { kind: string; ref: string }[]).map((i) => `${i.kind}: ${i.ref}`).join("; ");
      const status = r.status === "excluded" ? `excluded (${r.exclusion_reason ?? ""})` : `${r.status}${r.verification_status === "pending_verification" ? " · pending verification" : ""}`;
      return `| ${r.code} | ${esc(r.source_name)}${r.article ? ` — ${esc(r.article)}` : ""} | ${esc(r.title)} | ${esc(impl)} | ${a.pages} | ${a.api} | ${a.db} | ${status} |`;
    }),
  ].join("\n");
  writeFileSync("docs/RTM.md", md + "\n");
  const csvCell = (s: unknown) => `"${String(s ?? "").replace(/"/g, '""')}"`;
  const csv = ["code,source,article,binding,title,feature_area,implemented_as,pages,api,database,status,verification"]
    .concat(rows.map((r) => {
      const a = AREA[r.feature_area] ?? { pages: "", api: "", db: "" };
      return [r.code, r.source_name, r.article, r.binding_level, r.title, r.feature_area, (r.implemented_as as { kind: string; ref: string }[]).map((i) => `${i.kind}:${i.ref}`).join("; "), a.pages, a.api, a.db, r.status, r.verification_status].map(csvCell).join(",");
    }))
    .join("\n");
  writeFileSync("docs/RTM.csv", "﻿" + csv + "\n");
  console.log(`RTM exported: ${rows.length} requirements → docs/RTM.md, docs/RTM.csv`);
}
main().catch((e) => { console.error(e); process.exit(1); });
