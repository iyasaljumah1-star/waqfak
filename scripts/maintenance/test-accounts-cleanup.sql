-- Cleanup of the trial data of given client accounts (phase 2 — run only after the report was reviewed and approved).
--
-- Keeps the accounts (id, phone, login, roles, sessions, consents) and every audit log. Deletes, for the approved
-- trial waqfs and the accounts' requests: the waqf records and everything scoped to them, the requests and everything
-- scoped to them, their documents (rows; the encrypted files are listed for removal), and the accounts' own trial
-- records (notifications, assessments, AI chats, invoices and payments, personal tasks).
--
-- One transaction. Guards abort it (nothing changed) when the accounts or the approved waqfs are not exactly what the
-- report showed, or when a row outside this scope still references a row to delete (a constraint is never bypassed).
--
-- Usage (owner/admin role, inside the app container):
--   psql "$DATABASE_ADMIN_URL" -X -v ON_ERROR_STOP=1 \
--     -v phones="'+966540210059','+966592525191'" -v expect_users=2 \
--     -v waqfs="'<uuid>','<uuid>'" -v expect_waqfs=2 \
--     -v execute=no  -v blobs_out=/data/backups/cleanup-blobs.txt \
--     -f scripts/maintenance/test-accounts-cleanup.sql
-- execute=no: dry run (counts, then ROLLBACK). execute=yes: COMMIT. Use waqfs="'00000000-0000-0000-0000-000000000000'" and
-- expect_waqfs=0 when no waqf is to be deleted.
\set ON_ERROR_STOP on
\set QUIET on
begin;
set local lock_timeout = '10s';

create temp table _p (expect_users int, expect_waqfs int, execute text) on commit drop;
insert into _p values (:expect_users, :expect_waqfs, :'execute');
create temp table _u on commit drop as select id from users where phone in (:phones);
-- trial definition (same as the report): created by the accounts or linked to them, with no other member
create temp table _w on commit drop as
  select w.id from waqfs w
  where w.id in (:waqfs)
    and (w.created_by in (select id from _u) or exists (select 1 from waqf_memberships m where m.waqf_id = w.id and m.user_id in (select id from _u)))
    and not exists (select 1 from waqf_memberships m where m.waqf_id = w.id and m.user_id not in (select id from _u));
create temp table _r on commit drop as select id from service_requests where requester_user_id in (select id from _u) or waqf_id in (select id from _w);
create temp table _d on commit drop as select id from documents where waqf_id in (select id from _w) or request_id in (select id from _r)
  or (owner_user_id in (select id from _u) and waqf_id is null and request_id is null);
create temp table _inv on commit drop as select id from invoices where user_id in (select id from _u) or request_id in (select id from _r) or waqf_id in (select id from _w);
create temp table _blobs on commit drop as select storage_key from document_versions where document_id in (select id from _d);

do $$
declare p record;
begin
  select * into p from _p;
  if (select count(*) from _u) <> p.expect_users then raise exception 'guard: % accounts match the phones, % expected — nothing changed', (select count(*) from _u), p.expect_users; end if;
  if exists (select 1 from users where id in (select id from _u) and is_staff) then raise exception 'guard: one of the accounts is a staff account — nothing changed'; end if;
  if (select count(*) from _w) <> p.expect_waqfs then raise exception 'guard: % of the approved waqfs are trial waqfs of these accounts, % expected (one is unknown or now has another member) — nothing changed', (select count(*) from _w), p.expect_waqfs; end if;
  if exists (select 1 from _blobs where storage_key !~ '^(w|u)/[0-9a-f-]{36}/[0-9a-f-]{36}$') then raise exception 'guard: unexpected storage key format — nothing changed'; end if;
end $$;

-- every table scoped to a waqf, a request or a document (audit_logs excluded: kept, and hash-chained)
create temp table _t on commit drop as
select c.table_name::text as t, string_agg(case c.column_name
    when 'waqf_id' then 'waqf_id in (select id from _w)'
    when 'request_id' then 'request_id in (select id from _r)'
    when 'service_request_id' then 'service_request_id in (select id from _r)'
    when 'document_id' then 'document_id in (select id from _d)' end, ' or ') as pred
from information_schema.columns c join information_schema.tables x on x.table_name = c.table_name and x.table_schema = c.table_schema and x.table_type = 'BASE TABLE'
where c.table_schema = 'public' and c.column_name in ('waqf_id', 'request_id', 'service_request_id', 'document_id')
  and c.table_name not in ('audit_logs', 'service_requests', 'documents', 'invoices', 'payments', 'notifications', 'tasks')
group by c.table_name;
-- the accounts' own trial records, and records pointing to the rows above
insert into _t values
  ('notifications', 'user_id in (select id from _u) or waqf_id in (select id from _w) or exists (select 1 from _r where notifications.link like ''%'' || _r.id || ''%'') or exists (select 1 from _w where notifications.link like ''%'' || _w.id || ''%'')'),
  ('assessments', 'user_id in (select id from _u)'),
  ('ai_interactions', 'user_id in (select id from _u)'),
  ('payments', 'user_id in (select id from _u) or invoice_id in (select id from _inv)'),
  ('invoices', 'id in (select id from _inv)'),
  ('tasks', 'waqf_id in (select id from _w) or request_id in (select id from _r) or (created_by in (select id from _u) and waqf_id is null and request_id is null)'),
  ('service_requests', 'id in (select id from _r)'),
  ('documents', 'id in (select id from _d)'),
  ('waqfs', 'id in (select id from _w)');

create temp table _log (t text, deleted bigint, pass int) on commit drop;
-- delete in passes: a table whose rows are still referenced (by a row to be deleted later) waits for the next pass;
-- no progress in a full pass means something outside the scope references them → abort, nothing changed
do $$
declare r record; n bigint; progress boolean; left_ bigint; pass int := 0; last_err text;
begin
  loop
    pass := pass + 1;
    progress := false;
    for r in select t, pred from _t order by t loop
      begin
        execute format('delete from %I where %s', r.t, r.pred);
        get diagnostics n = row_count;
        if n > 0 then insert into _log values (r.t, n, pass); progress := true; end if;
      exception when foreign_key_violation then
        last_err := r.t || ': ' || sqlerrm;
      end;
    end loop;
    left_ := 0;
    for r in select t, pred from _t loop
      execute format('select count(*) from %I where %s', r.t, r.pred) into n;
      left_ := left_ + n;
    end loop;
    exit when left_ = 0;
    if not progress or pass > 40 then raise exception 'blocked: rows still referenced from outside the scope — nothing changed. Last: %', last_err; end if;
  end loop;
end $$;

\unset QUIET
\echo '\n== Deleted rows per table'
select t as table_name, sum(deleted) as rows from _log group by t order by t;
\echo '\n== Accounts kept'
select count(*) as accounts_kept from users where id in (select id from _u);
\echo '\n== Encrypted files to remove after COMMIT (keys written to :blobs_out)'
select count(*) as files from _blobs;
select storage_key from _blobs order by 1 \g (format=unaligned tuples_only=on) :blobs_out

select case when execute = 'yes' then 'COMMIT' else 'ROLLBACK (dry run: nothing changed)' end as outcome from _p \gset
\echo '\n== Outcome:' :outcome
select (execute = 'yes') as do_commit from _p \gset
\if :do_commit
commit;
\else
rollback;
\endif
