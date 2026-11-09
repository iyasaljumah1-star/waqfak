/**
 * Capability tokens — invitations, document shares, report shares (orders of 2026-11-08 «ثانياً»/2 and 2026-11-09
 * «رابعاً»: N9-2, N9-3). Part 1: the keyed lookup and the binding, pure. Part 2: on the development database, the
 * round-9 attacks a database writer could make — K1 uses reset, K2 un-revoke, K3/K3b version content swapped or moved,
 * K4 waqf changed, K5 confidentiality changed, R1 report re-pointed, I1 invitation accepted twice, I2 note changed — and
 * the use limit under concurrent requests. Changes made through the share functions are committed and cleaned up;
 * direct tampering runs in rolled-back transactions with the application role.
 */
import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, isNull, ne } from "drizzle-orm";
import { Client } from "pg";

vi.mock("server-only", () => ({}));

import { bindDocumentShare, bindInvitation, bindReportShare, capabilityBinding, capabilityLookup, verifyCapability, type ShareContent } from "../src/server/lib/capability";
import { randomToken, sha256 } from "../src/server/lib/crypto";
import { withSystem } from "../src/server/db";
import * as schema from "../src/server/db/schema";

const D = (s: string) => new Date(s);
const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const content = (o: Partial<ShareContent["doc"]> = {}, v: Partial<NonNullable<ShareContent["version"]>> = {}): ShareContent => ({
  doc: { id: U(2), waqfId: U(3), confidentiality: "internal", currentVersion: 1, ...o },
  version: { id: U(9), documentId: U(2), version: 1, storageKey: "k/1", sha256: "a".repeat(64), iv: "iv", authTag: "tag", ...v },
});

describe("capability tokens — pure", () => {
  const token = randomToken(24);
  it("the raw token is never what is stored; one purpose's token is not another's", () => {
    const a = capabilityLookup("invitation", token);
    expect(a).not.toContain(token);
    expect(a).not.toBe(sha256(token));
    expect(capabilityLookup("document_share", token)).not.toBe(a);
    expect(capabilityLookup("report_share", token)).not.toBe(a);
    expect(capabilityLookup("invitation", token)).toBe(a);
  });
  it("a document share is bound to the row AND to the content: version, storage, hash, waqf, confidentiality", () => {
    const row = { id: U(1), documentId: U(2), waqfId: U(3), createdBy: U(4), expiresAt: D("2026-12-01T00:00:00Z"), maxUses: 3 };
    const b = capabilityBinding("document_share", token, bindDocumentShare(row, content()));
    expect(verifyCapability("document_share", token, b, bindDocumentShare(row, content()))).toBe(true);
    for (const changed of [{ documentId: U(5) }, { waqfId: null }, { expiresAt: D("2027-01-01T00:00:00Z") }, { maxUses: 50 }, { createdBy: U(6) }])
      expect(verifyCapability("document_share", token, b, bindDocumentShare({ ...row, ...changed }, content())), JSON.stringify(changed)).toBe(false);
    for (const [d, v] of [[{ waqfId: U(7) }, {}], [{ confidentiality: "secret" }, {}], [{ currentVersion: 2 }, {}], [{}, { id: U(8) }], [{}, { storageKey: "k/other" }],
      [{}, { sha256: "b".repeat(64) }], [{}, { iv: "iv2" }], [{}, { authTag: "tag2" }], [{}, { documentId: U(10) }]] as const)
      expect(verifyCapability("document_share", token, b, bindDocumentShare(row, content(d, v))), JSON.stringify([d, v])).toBe(false);
    expect(verifyCapability("document_share", token, b, bindDocumentShare(row, { ...content(), version: null }))).toBe(false);
    expect(verifyCapability("document_share", randomToken(24), b, bindDocumentShare(row, content()))).toBe(false);
    expect(verifyCapability("report_share", token, b, bindDocumentShare(row, content()))).toBe(false);
    expect(verifyCapability("document_share", token, null, bindDocumentShare(row, content()))).toBe(false);
  });
  it("an invitation is bound to its phone, role, waqf, scope, expiry and note; a report share to its assessment and result", () => {
    const inv = { id: U(1), waqfId: U(3), phone: "0500000001", roleKey: "viewer", invitedBy: U(4), expiresAt: D("2026-12-01T00:00:00Z"), scope: { permissions: ["waqf.view"] }, note: "مرحبًا" };
    const bi = capabilityBinding("invitation", token, bindInvitation(inv));
    expect(verifyCapability("invitation", token, bi, bindInvitation(inv))).toBe(true);
    for (const changed of [{ phone: "0500000002" }, { roleKey: "nazir" }, { scope: { permissions: ["waqf.edit"] } }, { waqfId: U(2) }, { expiresAt: D("2027-06-01T00:00:00Z") }, { note: "افتح الرابط وأدخل رمزك" }])
      expect(verifyCapability("invitation", token, bi, bindInvitation({ ...inv, ...changed })), JSON.stringify(changed)).toBe(false);
    const rs = { id: U(1), reportId: U(2), waqfId: U(3), createdBy: U(4), expiresAt: D("2026-12-01T00:00:00Z") };
    const rc = { reportWaqf: U(3), reportNumber: "RPT-1", assessmentId: U(5), assessmentWaqf: U(3), resultAt: "2026-11-01T00:00:00.000Z" };
    const br = capabilityBinding("report_share", token, bindReportShare(rs, rc));
    expect(verifyCapability("report_share", token, br, bindReportShare(rs, rc))).toBe(true);
    for (const changed of [{ assessmentId: U(6) }, { assessmentWaqf: U(7) }, { resultAt: "2026-11-02T00:00:00.000Z" }, { reportWaqf: null }])
      expect(verifyCapability("report_share", token, br, bindReportShare(rs, { ...rc, ...changed })), JSON.stringify(changed)).toBe(false);
  });
});

const devDb = /waqfak_dev/.test(process.env.DATABASE_URL ?? "");
describe.skipIf(!devDb)("capability tokens — use paths on the development database (synthetic rows)", () => {
  const created: { shares: string[]; invitations: string[]; reports: string[] } = { shares: [], invitations: [], reports: [] };
  const copies: string[] = [];
  afterAll(async () => {
    // the application never deletes a link, an invitation or a report (N10-1, N10c-2): test rows go as the cluster's owner
    if (created.reports.length) {
      const { execFileSync } = await import("node:child_process");
      execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-q", "-d", "waqfak_dev", "-c", `set session_replication_role = replica; delete from report_shares where report_id in (${created.reports.map((x) => `'${x}'`).join(",")}); delete from reports where id in (${created.reports.map((x) => `'${x}'`).join(",")})`]);
    }
    if (created.invitations.length) {
      const { execFileSync } = await import("node:child_process");
      execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-q", "-d", "waqfak_dev", "-c", `set session_replication_role = replica; delete from invitations where id in (${created.invitations.map((x) => `'${x}'`).join(",")})`]);
    }
    if (created.shares.length) {
      const { execFileSync } = await import("node:child_process");
      execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-q", "-d", "waqfak_dev", "-c", `set session_replication_role = replica; delete from document_share_uses where share_id in (${created.shares.map((x) => `'${x}'`).join(",")}); delete from document_shares where id in (${created.shares.map((x) => `'${x}'`).join(",")})`]);
    }
    if (copies.length) {
      const { execFileSync } = await import("node:child_process");
      execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-q", "-d", "waqfak_dev", "-c", `set session_replication_role = replica; delete from document_access_log where document_id in (${copies.map((x) => `'${x}'`).join(",")}); delete from document_versions where document_id in (${copies.map((x) => `'${x}'`).join(",")}); delete from documents where id in (${copies.map((x) => `'${x}'`).join(",")})`]);
    }
  });

  async function fixtures() {
    return withSystem(async (tx) => {
      const docs = await tx.select({ d: schema.documents, v: schema.documentVersions }).from(schema.documents)
        .innerJoin(schema.documentVersions, and(eq(schema.documentVersions.documentId, schema.documents.id), eq(schema.documentVersions.version, schema.documents.currentVersion)))
        .where(and(eq(schema.documents.status, "active"), isNull(schema.documents.archivedAt), ne(schema.documents.confidentiality, "secret"), eq(schema.documentVersions.scanStatus, "clean"))).limit(2);
      const [u] = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
      return { docs, user: u!.id };
    });
  }
  async function issueShare(f: Awaited<ReturnType<typeof fixtures>>["docs"][number], createdBy: string, maxUses = 2) {
    const token = randomToken(24);
    const row = { id: crypto.randomUUID(), documentId: f.d.id, waqfId: f.d.waqfId, createdBy, expiresAt: new Date(Date.now() + 86_400_000), maxUses };
    await withSystem((tx) => tx.insert(schema.documentShares).values({ ...row, tokenHash: capabilityLookup("document_share", token), binding: capabilityBinding("document_share", token, bindDocumentShare(row, { doc: f.d, version: f.v })) }));
    created.shares.push(row.id);
    return { token, row };
  }
  /** A tampering statement then a check, with the application role in the system context, rolled back. */
  async function tamper(stmts: string[], check: () => Promise<unknown>): Promise<{ refused: string | null; after: unknown }> {
    const c = new Client({ connectionString: process.env.DATABASE_URL }); await c.connect();
    await c.query("begin");
    await c.query(`select set_config('app.user_id', '', true), set_config('app.global_access', 'on', true)`);
    let refused: string | null = null;
    try { for (const s of stmts) await c.query(s); } catch (e) { refused = (e as Error).message; }
    // the check reads through the application's own path, which cannot see this uncommitted transaction: run the
    // change for real only where the database accepted it, inside this same transaction, via a savepointless read
    let after: unknown = null;
    if (!refused) after = await check();
    await c.query("rollback"); await c.end();
    return { refused, after };
  }

  it("works as issued; a version swapped or moved, a waqf or a confidentiality changed: the link opens nothing (K3, K3b, K4, K5)", async () => {
    const { viewShare, consumeShare } = await import("../src/server/modules/documents/share");
    const f = await fixtures();
    if (f.docs.length < 2) return expect.fail("development database lacks two clean documents");
    // private copies of two documents (same encrypted blobs, new rows): the tampering below never touches rows another
    // test file may be reading at the same time
    const { execFileSync: ex } = await import("node:child_process");
    const own = (q: string) => ex("sudo", ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", "waqfak_dev", "-c", q]);
    const copy = async (x: typeof f.docs[0]) => {
      const d = crypto.randomUUID(), v = crypto.randomUUID();
      own(`insert into documents select (jsonb_populate_record(d, jsonb_build_object('id', '${d}'))).* from documents d where id = '${x.d.id}';
           insert into document_versions select (jsonb_populate_record(v, jsonb_build_object('id', '${v}', 'document_id', '${d}'))).* from document_versions v where id = '${x.v.id}'`);
      copies.push(d);
      return withSystem(async (tx) => {
        const [r] = await tx.select({ d: schema.documents, v: schema.documentVersions }).from(schema.documents).innerJoin(schema.documentVersions, eq(schema.documentVersions.documentId, schema.documents.id)).where(eq(schema.documents.id, d));
        return r!;
      });
    };
    const [a, b] = [await copy(f.docs[0]!), await copy(f.docs[1]!)];
    const s = await issueShare(a, f.user);
    expect((await viewShare(s.token)).state).toBe("ok");
    // each change committed through the owner, checked, then put back
    const { execFileSync } = await import("node:child_process");
    const owner = (q: string) => execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-v", "ON_ERROR_STOP=1", "-q", "-d", "waqfak_dev", "-c", q]);
    const cases: [string, string, string][] = [
      ["K3 content of B's version under A's", `update document_versions set storage_key = '${b.v.storageKey}', iv = ${b.v.iv ? `'${b.v.iv}'` : "null"}, auth_tag = ${b.v.authTag ? `'${b.v.authTag}'` : "null"}, sha256 = '${b.v.sha256}' where id = '${a.v.id}'`,
        `update document_versions set storage_key = '${a.v.storageKey}', iv = ${a.v.iv ? `'${a.v.iv}'` : "null"}, auth_tag = ${a.v.authTag ? `'${a.v.authTag}'` : "null"}, sha256 = '${a.v.sha256}' where id = '${a.v.id}'`],
      ["K3b B's version row moved under A as its current version", `update document_versions set document_id = '${a.d.id}', version = 9999 where id = '${b.v.id}'; update documents set current_version = 9999 where id = '${a.d.id}'`,
        `update documents set current_version = ${a.d.currentVersion} where id = '${a.d.id}'; update document_versions set document_id = '${b.d.id}', version = ${b.v.version} where id = '${b.v.id}'`],
      ["K4 waqf of the document changed", `update documents set waqf_id = ${b.d.waqfId && b.d.waqfId !== a.d.waqfId ? `'${b.d.waqfId}'` : `gen_random_uuid()`} where id = '${a.d.id}'`, `update documents set waqf_id = ${a.d.waqfId ? `'${a.d.waqfId}'` : "null"} where id = '${a.d.id}'`],
      ["K5 confidentiality changed", `update documents set confidentiality = 'confidential' where id = '${a.d.id}'`, `update documents set confidentiality = '${a.d.confidentiality}' where id = '${a.d.id}'`],
    ];
    for (const [label, change, undo] of cases) {
      owner(change);
      try {
        expect((await viewShare(s.token)).state, label).toBe("not_found");
        expect((await consumeShare(s.token, "127.0.0.1")).file, label).toBeNull();
      } finally { owner(undo); }
    }
    expect((await viewShare(s.token)).state).toBe("ok");
  });

  it("one use: two concurrent requests on a single-use link — exactly one gets the file; the second and later are refused", async () => {
    const { consumeShare, viewShare } = await import("../src/server/modules/documents/share");
    const f = await fixtures();
    const s = await issueShare(f.docs[0]!, f.user, 1);
    const [r1, r2] = await Promise.all([consumeShare(s.token, "127.0.0.1"), consumeShare(s.token, "127.0.0.2")]);
    expect([r1, r2].filter((r) => r.file).length).toBe(1);
    expect([r1, r2].filter((r) => r.state === "used_up").length).toBe(1);
    expect((await consumeShare(s.token, "127.0.0.3")).state).toBe("used_up");
    expect((await viewShare(s.token)).state).toBe("used_up");
    const uses = await withSystem((tx) => tx.select().from(schema.documentShareUses).where(eq(schema.documentShareUses.shareId, s.row.id)));
    expect(uses).toHaveLength(1);
  });

  it("K1/K2: the use count, the use log and a revocation are not undone by a database writer", async () => {
    const { consumeShare } = await import("../src/server/modules/documents/share");
    const f = await fixtures();
    const s = await issueShare(f.docs[0]!, f.user, 1);
    expect((await consumeShare(s.token, "127.0.0.1")).file).not.toBeNull();
    const k1 = await tamper([`update document_shares set uses = 0 where id = '${s.row.id}'`], async () => null);
    expect(k1.refused).toMatch(/do not go back/);
    const k1b = await tamper([`delete from document_share_uses where share_id = '${s.row.id}'`], async () => null);
    expect(k1b.refused).toMatch(/permission denied|append-only|not allowed/i);
    const k1c = await tamper([`update document_shares set max_uses = 50 where id = '${s.row.id}'`], async () => null);
    expect(k1c.refused).toMatch(/do not go back/);
    const r = await issueShare(f.docs[0]!, f.user);
    await withSystem((tx) => tx.update(schema.documentShares).set({ revokedAt: new Date() }).where(eq(schema.documentShares.id, r.row.id)));
    const k2 = await tamper([`update document_shares set revoked_at = null where id = '${r.row.id}'`], async () => null);
    expect(k2.refused).toMatch(/revocation is not undone/);
    const k2b = await tamper([`update document_shares set expires_at = now() + interval '1 year' where id = '${r.row.id}'`], async () => null);
    expect(k2b.refused).toMatch(/does not change/);
  });

  it("N10-1: a revoked link, a used link or an accepted invitation is not deleted and inserted again as issued", async () => {
    const f = await fixtures();
    const r = await issueShare(f.docs[0]!, f.user);
    await withSystem((tx) => tx.update(schema.documentShares).set({ revokedAt: new Date() }).where(eq(schema.documentShares.id, r.row.id)));
    const reissue = (table: string, id: string, cols: string) =>
      tamper([`with old as (delete from ${table} where id = '${id}' returning *) insert into ${table} (${cols}) select ${cols} from old`], async () => null);
    const d = await reissue("document_shares", r.row.id, "id, document_id, waqf_id, token_hash, binding, created_by, expires_at, max_uses, created_at");
    expect(d.refused).toMatch(/permission denied|never deleted/);
    const plain = await tamper([`delete from document_shares where id = '${r.row.id}'`], async () => null);
    expect(plain.refused).toMatch(/permission denied|never deleted/);
    const token = randomToken(24);
    const inv = { id: crypto.randomUUID(), waqfId: f.docs[0]!.d.waqfId!, phone: "0500000996", roleKey: "viewer", invitedBy: f.user, expiresAt: new Date(Date.now() + 86_400_000), scope: null, note: null };
    await withSystem((tx) => tx.insert(schema.invitations).values({ ...inv, tokenHash: capabilityLookup("invitation", token), binding: capabilityBinding("invitation", token, bindInvitation(inv)), acceptedAt: new Date(), acceptedBy: f.user }));
    created.invitations.push(inv.id);
    const i = await reissue("invitations", inv.id, "id, waqf_id, phone, role_key, invited_by, expires_at, scope, note, token_hash, binding, created_at");
    expect(i.refused).toMatch(/permission denied|never deleted/);
    const rs = await tamper([`delete from report_shares where true`], async () => null);
    expect(rs.refused).toMatch(/permission denied|never deleted/);
    const tr = await tamper([`truncate document_shares cascade`], async () => null);
    expect(tr.refused).toMatch(/permission denied|must be owner/);
  });

  it("a link the operator expired (owner) says it expired and opens nothing; an extended one is unknown", async () => {
    const { viewShare, consumeShare } = await import("../src/server/modules/documents/share");
    const { execFileSync } = await import("node:child_process");
    const f = await fixtures();
    const owner = (q: string) => execFileSync("sudo", ["-n", "-u", "postgres", "psql", "-q", "-d", "waqfak_dev", "-c", q]);
    const a = await issueShare(f.docs[0]!, f.user);
    owner(`update document_shares set expires_at = now() - interval '1 minute' where id = '${a.row.id}'`);
    expect((await viewShare(a.token)).state).toBe("expired");
    expect((await consumeShare(a.token, "127.0.0.1")).file).toBeNull();
    const b = await issueShare(f.docs[0]!, f.user);
    owner(`update document_shares set expires_at = now() + interval '1 year' where id = '${b.row.id}'`);
    expect((await viewShare(b.token)).state).toBe("not_found");
    expect((await consumeShare(b.token, "127.0.0.1")).file).toBeNull();
  });

  it("R1: a report share opens nothing once its report points at another assessment or the result is recomputed", async () => {
    const { reportContent } = await import("../src/server/modules/assessment/share-content");
    const token = randomToken(24);
    const rep = crypto.randomUUID();
    const f = await fixtures();
    await withSystem((tx) => tx.insert(schema.reports).values({ id: rep, number: `TEST-R1-${rep.slice(0, 6)}`, kind: "assessment", title: "تقرير اختبار", verificationCode: randomToken(9), assessmentId: U(91) }));
    created.reports.push(rep);
    const row = { id: crypto.randomUUID(), reportId: rep, waqfId: null, createdBy: f.user, expiresAt: new Date(Date.now() + 86_400_000) };
    const binding = await withSystem(async (tx) => capabilityBinding("report_share", token, bindReportShare(row, await reportContent(tx, rep))));
    expect(await withSystem(async (tx) => verifyCapability("report_share", token, binding, bindReportShare(row, await reportContent(tx, rep))))).toBe(true);
    await withSystem((tx) => tx.update(schema.reports).set({ assessmentId: U(92) }).where(eq(schema.reports.id, rep)));
    expect(await withSystem(async (tx) => verifyCapability("report_share", token, binding, bindReportShare(row, await reportContent(tx, rep))))).toBe(false);
  });

  it("N10b-2/N10b-3: a revoked report is not brought back; a second report-share row with the same token is refused", async () => {
    const f = await fixtures();
    const rep = crypto.randomUUID();
    await withSystem((tx) => tx.insert(schema.reports).values({ id: rep, number: `TEST-N10B-${rep.slice(0, 6)}`, kind: "assessment", title: "تقرير اختبار", verificationCode: randomToken(9), revokedAt: new Date() }));
    created.reports.push(rep);
    const back = await tamper([`update reports set revoked_at = null where id = '${rep}'`], async () => null);
    expect(back.refused).toMatch(/revocation is not undone/);
    const again = await tamper([`with old as (delete from reports where id = '${rep}' returning *) insert into reports (id, number, kind, title, verification_code) select id, number, kind, title, verification_code from old`], async () => null);
    expect(again.refused).toMatch(/permission denied|never deleted/);
    const renamed = await tamper([`update reports set number = number || '-old', verification_code = verification_code || 'x' where id = '${rep}'`], async () => null);
    expect(renamed.refused).toMatch(/keeps its id, number and verification code/);
    const lookup = capabilityLookup("report_share", randomToken(24));
    const twice = await tamper([
      `insert into report_shares (report_id, token_hash, binding, created_by, expires_at) values ('${rep}', '${lookup}', 'x', '${f.user}', now() + interval '1 day')`,
      `insert into report_shares (report_id, token_hash, binding, created_by, expires_at) values ('${rep}', '${lookup}', 'y', '${f.user}', now() + interval '1 day')`,
    ], async () => null);
    expect(twice.refused).toMatch(/rs_token_uq|duplicate key/);
  });

  it("I1/I2: an invitation accepted is not accepted again; its note, phone or role do not change after issue", async () => {
    const f = await fixtures();
    const waqfId = f.docs[0]!.d.waqfId!;
    const token = randomToken(24);
    const row = { id: crypto.randomUUID(), waqfId, phone: "0500000999", roleKey: "viewer", invitedBy: f.user, expiresAt: new Date(Date.now() + 7 * 86_400_000), scope: null, note: "دعوة اختبار" };
    await withSystem((tx) => tx.insert(schema.invitations).values({ ...row, tokenHash: capabilityLookup("invitation", token), binding: capabilityBinding("invitation", token, bindInvitation(row)), acceptedAt: new Date(), acceptedBy: f.user }));
    created.invitations.push(row.id);
    const i1 = await tamper([`update invitations set accepted_at = null, accepted_by = null where id = '${row.id}'`], async () => null);
    expect(i1.refused).toMatch(/acceptance is not undone/);
    const i2 = await tamper([`update invitations set note = 'ادخل على الرابط التالي' where id = '${row.id}'`], async () => null);
    expect(i2.refused).toMatch(/does not change/);
    const i2b = await tamper([`update invitations set phone = '0500000998', role_key = 'nazir' where id = '${row.id}'`], async () => null);
    expect(i2b.refused).toMatch(/does not change/);
    const { invitationByToken } = await import("../src/server/modules/waqf-core/queries");
    expect(await invitationByToken(token)).toMatchObject({ id: row.id, note: "دعوة اختبار" });
  });

  it("a declined invitation records the decline (the only change allowed besides acceptance), once", async () => {
    const f = await fixtures();
    const row = { id: crypto.randomUUID(), waqfId: f.docs[0]!.d.waqfId!, phone: "0500000997", roleKey: "viewer", invitedBy: f.user, expiresAt: new Date(Date.now() + 86_400_000), scope: { a: 1 }, note: null };
    const token = randomToken(24);
    await withSystem((tx) => tx.insert(schema.invitations).values({ ...row, tokenHash: capabilityLookup("invitation", token), binding: capabilityBinding("invitation", token, bindInvitation(row)) }));
    created.invitations.push(row.id);
    const ok = await tamper([`update invitations set revoked_at = now(), scope = scope || '{"declinedAt":"2026-11-10","declinedBy":"x"}'::jsonb where id = '${row.id}'`], async () => null);
    expect(ok.refused).toBeNull();
    const bad = await tamper([`update invitations set scope = '{"a":2}'::jsonb where id = '${row.id}'`], async () => null);
    expect(bad.refused).toMatch(/does not change/);
  });
});
