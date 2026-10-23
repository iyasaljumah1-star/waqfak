-- READ-ONLY report of the trial data of given client accounts (phase 1 — nothing is changed).
--
-- Usage (inside the app container, which reaches the private database; owner or admin role):
--   psql "$DATABASE_ADMIN_URL" -X -v ON_ERROR_STOP=1 -v phones="'+966540210059','+966592525191'" -f scripts/maintenance/test-accounts-report.sql
-- The whole report runs in a READ ONLY transaction: any write would be refused by PostgreSQL itself.
\set QUIET on
begin transaction read only;
\pset footer off
\pset null '—'

-- the sets, as subqueries (a read-only transaction cannot create even temporary objects)
\set U '(select id from users where phone in (' :phones '))'
-- waqfs linked to the accounts: created by them or with them as members
\set WALL '(select w.id from waqfs w where w.created_by in ' :U ' union select m.waqf_id from waqf_memberships m where m.user_id in ' :U ')'
-- trial waqfs: linked, and no member who is not one of the accounts
\set W '(select x.id from ' :WALL ' x where not exists (select 1 from waqf_memberships m where m.waqf_id = x.id and m.user_id not in ' :U '))'
\set R '(select id from service_requests where requester_user_id in ' :U ' or waqf_id in ' :W ')'
\set D '(select id from documents where waqf_id in ' :W ' or request_id in ' :R ' or (owner_user_id in ' :U ' and waqf_id is null and request_id is null))'
\unset QUIET

\echo '\n== 1. Accounts (kept: login, roles, sessions, consents, audit)'
select u.id, regexp_replace(u.phone, '(\d{3})\d{4}(\d{2})$', '\1****\2') as phone, u.full_name, u.is_staff, u.created_at::date, u.last_login_at::date,
  (select string_agg(r.key, ',') from user_roles ur join roles r on r.id = ur.role_id where ur.user_id = u.id) as platform_roles
from users u where u.id in :U order by u.created_at;

\echo '\n== 2. Waqfs linked to the accounts (trial = created by them or with no other member)'
select w.internal_number, w.name, w.status, w.created_at::date, (w.id in :W) as trial_will_delete,
  (select count(*) from waqf_memberships m where m.waqf_id = w.id and m.user_id not in :U) as other_members,
  (select count(*) from service_requests r where r.waqf_id = w.id) as requests,
  (select count(*) from documents d where d.waqf_id = w.id) as documents, w.id
from waqfs w where w.id in :WALL order by w.created_at;

\echo '\n== 3. Requests to delete (by the accounts, or on the trial waqfs)'
select r.number, s.code, r.status, (r.intake->>'waqfMode') as waqf_mode, w.internal_number as waqf, r.created_at::date,
  (r.requester_user_id in :U) as by_account
from service_requests r join services s on s.id = r.service_id left join waqfs w on w.id = r.waqf_id
where r.id in :R order by r.created_at;

\echo '\n== 4. Requests by OTHER users on the trial waqfs (deleted with the waqf — check)'
select r.number, s.code, r.status, u.full_name as requester from service_requests r join services s on s.id = r.service_id join users u on u.id = r.requester_user_id
where r.waqf_id in :W and r.requester_user_id not in :U;

\echo '\n== 5. Rows to delete per table (waqf, request or document scope; audit_logs excluded)'
select string_agg(q, ' union all ' order by q) || ' order by 1' from (
select format('select %L as table_name, count(*) as rows from %I where %s having count(*) > 0', c.table_name, c.table_name,
  string_agg(case c.column_name
    when 'waqf_id' then 'waqf_id in ' || :'W'
    when 'request_id' then 'request_id in ' || :'R'
    when 'service_request_id' then 'service_request_id in ' || :'R'
    when 'document_id' then 'document_id in ' || :'D' end, ' or '))
from information_schema.columns c join information_schema.tables t on t.table_name = c.table_name and t.table_schema = c.table_schema and t.table_type = 'BASE TABLE'
where c.table_schema = 'public' and c.column_name in ('waqf_id', 'request_id', 'service_request_id', 'document_id') and c.table_name not in ('audit_logs')
group by c.table_name) x(q)
\gexec

\echo '\n== 6. Account-level trial records (deleted: notifications, assessments, AI chats, invoices/payments of the accounts)'
select 'notifications' t, count(*) from notifications where user_id in :U
union all select 'assessments', count(*) from assessments where user_id in :U
union all select 'ai_interactions', count(*) from ai_interactions where user_id in :U
union all select 'invoices (any)', count(*) from invoices where user_id in :U or request_id in :R or waqf_id in :W
union all select 'invoices issued (tax documents)', count(*) from invoices where (user_id in :U or request_id in :R or waqf_id in :W) and status not in ('draft', 'void')
union all select 'payments', count(*) from payments where user_id in :U or invoice_id in (select id from invoices where user_id in :U or request_id in :R)
union all select 'staff notifications pointing to these requests', count(*) from notifications where user_id not in :U and exists (select 1 from :R rr where notifications.link like '%' || rr.id || '%');

\echo '\n== 7. Kept (not touched)'
select 'audit_logs about the trial waqfs/requests (hash-chained, kept)' t, count(*) from audit_logs where waqf_id in :W or entity_id in (select id::text from :R) or entity_id in (select id::text from :W)
union all select 'sessions of the accounts', count(*) from sessions where user_id in :U
union all select 'consents of the accounts', count(*) from consents where user_id in :U
union all select 'memberships of the accounts in NON-trial waqfs', count(*) from waqf_memberships where user_id in :U and waqf_id not in :W;

\echo '\n== 8. Stored files of the documents to delete (encrypted blobs under $STORAGE_DIR/blobs)'
select (select count(*) from documents where id in :D) as documents, count(*) as files, pg_size_pretty(coalesce(sum(size_bytes), 0)) as size from document_versions where document_id in :D;

\echo '\n== 9. Orphans already present before any change (baseline: rows whose waqf_id points to no waqf)'
select coalesce(string_agg(format('select %L as table_name, count(*) as orphans from %I x where x.waqf_id is not null and not exists (select 1 from waqfs w where w.id = x.waqf_id) having count(*) > 0', table_name, table_name), ' union all ' order by table_name), 'select 1 where false') || ' order by 1'
from information_schema.columns where table_schema = 'public' and column_name = 'waqf_id' and table_name not in ('audit_logs')
  and table_name in (select table_name from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE')
\gexec

rollback;
