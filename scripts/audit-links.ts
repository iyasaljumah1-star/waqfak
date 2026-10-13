/**
 * Read-only audit of the links between requests and the records they created or relate to (docs/SERVICE-FLOWS-AUDIT.md §5).
 * Prints counts and, for each finding, the record numbers so a person can decide the fix. Nothing is changed: a link is
 * never invented. Run against any environment with the owner role:
 *   npx tsx scripts/audit-links.ts
 */
import "dotenv/config";
import pg from "pg";

const CHECKS: { key: string; label: string; sql: string }[] = [
  { key: "contracts", label: "عقود تشير إلى طلب غير موجود", sql: "select number as ref from contracts c where request_id is not null and not exists (select 1 from service_requests r where r.id = c.request_id)" },
  { key: "invoices", label: "فواتير تشير إلى طلب غير موجود", sql: "select number as ref from invoices i where request_id is not null and not exists (select 1 from service_requests r where r.id = i.request_id)" },
  { key: "documents", label: "مستندات تشير إلى طلب غير موجود", sql: "select id::text as ref from documents d where request_id is not null and not exists (select 1 from service_requests r where r.id = d.request_id)" },
  { key: "tasks", label: "مهام تشير إلى طلب غير موجود", sql: "select id::text as ref from tasks t where request_id is not null and not exists (select 1 from service_requests r where r.id = t.request_id)" },
  { key: "engagements", label: "ملفات نظارة تشير إلى طلب غير موجود", sql: "select number as ref from nazara_engagements e where request_id is not null and not exists (select 1 from service_requests r where r.id = e.request_id)" },
  { key: "req_waqf", label: "طلبات تشير إلى وقف غير موجود", sql: "select number as ref from service_requests r where waqf_id is not null and not exists (select 1 from waqfs w where w.id = r.waqf_id)" },
  { key: "inv_waqf", label: "فواتير وقفها يخالف وقف طلبها", sql: "select i.number as ref from invoices i join service_requests r on r.id = i.request_id where i.waqf_id is distinct from r.waqf_id" },
  { key: "ctr_waqf", label: "عقود وقفها يخالف وقف طلبها", sql: "select c.number as ref from contracts c join service_requests r on r.id = c.request_id where c.waqf_id is distinct from r.waqf_id" },
  { key: "n01_unlinked", label: "طلبات تولي نظارة مرسلة بلا ملف نظارة مرتبط", sql: "select r.number || ' (' || r.status || ')' as ref from service_requests r join services s on s.id = r.service_id where s.code = 'N01' and r.status <> 'draft' and not exists (select 1 from request_links l where l.request_id = r.id and l.entity_type = 'nazara_engagement') and not exists (select 1 from nazara_engagements e where e.request_id = r.id)" },
  { key: "n01_candidates", label: "منها: يوجد لوقفها ملف نظارة كان مفتوحًا عند إرسالها (مرشح للربط بعد مراجعة بشرية)", sql: "select r.number || ' → ' || e.number as ref from service_requests r join services s on s.id = r.service_id join nazara_engagements e on e.waqf_id = r.waqf_id where s.code = 'N01' and r.status <> 'draft' and r.submitted_at is not null and e.created_at <= r.submitted_at and (e.status not in ('rejected','ended') or e.updated_at >= r.submitted_at) and not exists (select 1 from request_links l where l.request_id = r.id and l.entity_type = 'nazara_engagement') and (e.request_id is distinct from r.id)" },
  { key: "dup_open_eng", label: "أوقاف لها أكثر من ملف نظارة مفتوح", sql: "select waqf_id::text as ref from nazara_engagements where status not in ('rejected','ended') group by waqf_id having count(*) > 1" },
  { key: "deliverable_doc", label: "تسليمات مرفق بها مستند من طلب آخر", sql: "select v.id::text as ref from deliverables v join documents d on d.id = v.document_id where d.request_id is distinct from v.request_id" },
  { key: "running_no_tasks", label: "طلبات قيد التنفيذ بلا مهام تنفيذ (قبل هذا التحديث؛ تُنشأ عند الانتقال التالي أو يدويًا)", sql: "select r.number as ref from service_requests r where r.status in ('in_progress','quality_review') and not exists (select 1 from tasks t where t.request_id = r.id and t.kind is not null)" },
];

async function main() {
  const url = process.env.DATABASE_OWNER_URL;
  if (!url) throw new Error("DATABASE_OWNER_URL is required (read-only queries).");
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try {
    await c.query("begin read only");
    let issues = 0;
    for (const k of CHECKS) {
      const rows = (await c.query<{ ref: string }>(k.sql)).rows;
      issues += k.key === "n01_candidates" || k.key === "running_no_tasks" ? 0 : rows.length;
      console.log(`${rows.length ? "⚠" : "✓"} ${k.label}: ${rows.length}${rows.length ? `\n    ${rows.slice(0, 20).map((r) => r.ref).join("، ")}${rows.length > 20 ? " …" : ""}` : ""}`);
    }
    await c.query("rollback");
    console.log(issues ? `\n${issues} finding(s) need a documented fix. Nothing was changed.` : "\nNo broken links. Nothing was changed.");
  } finally {
    await c.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
