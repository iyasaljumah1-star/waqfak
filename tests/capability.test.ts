/**
 * Capability tokens — invitations, document shares, report shares (owner's order 2026-11-08, «ثانياً»/2). Part 1: the
 * keyed lookup and the binding, pure. Part 2: on the development database (synthetic rows, removed afterwards), the
 * attack a database writer could make before — planting a row, re-pointing a share to another document, extending it,
 * raising its uses, changing an invitation's phone or role — now refused at use, with the application role.
 */
import "dotenv/config";
import { afterAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray, isNull, ne } from "drizzle-orm";

vi.mock("server-only", () => ({}));

import { bindDocumentShare, bindInvitation, bindReportShare, capabilityBinding, capabilityLookup, verifyCapability } from "../src/server/lib/capability";
import { randomToken, sha256 } from "../src/server/lib/crypto";
import { withSystem } from "../src/server/db";
import * as schema from "../src/server/db/schema";

const D = (s: string) => new Date(s);

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
  it("the binding verifies the row as issued, and nothing else", () => {
    const row = { id: "11111111-1111-4111-8111-111111111111", documentId: "22222222-2222-4222-8222-222222222222", waqfId: "33333333-3333-4333-8333-333333333333", createdBy: "44444444-4444-4444-8444-444444444444", expiresAt: D("2026-12-01T00:00:00Z"), maxUses: 3 };
    const b = capabilityBinding("document_share", token, bindDocumentShare(row));
    expect(verifyCapability("document_share", token, b, bindDocumentShare(row))).toBe(true);
    for (const changed of [{ documentId: "55555555-5555-4555-8555-555555555555" }, { waqfId: null }, { expiresAt: D("2027-01-01T00:00:00Z") }, { maxUses: 50 }, { createdBy: "66666666-6666-4666-8666-666666666666" }, { id: "77777777-7777-4777-8777-777777777777" }])
      expect(verifyCapability("document_share", token, b, bindDocumentShare({ ...row, ...changed })), JSON.stringify(changed)).toBe(false);
    expect(verifyCapability("document_share", randomToken(24), b, bindDocumentShare(row))).toBe(false);
    expect(verifyCapability("report_share", token, b, bindDocumentShare(row))).toBe(false);
    expect(verifyCapability("document_share", token, null, bindDocumentShare(row))).toBe(false); // issued before the change
    expect(verifyCapability("document_share", token, `${b}x`, bindDocumentShare(row))).toBe(false);
    const inv = { id: row.id, waqfId: row.waqfId!, phone: "0500000001", roleKey: "viewer", invitedBy: row.createdBy, expiresAt: row.expiresAt, scope: { permissions: ["waqf.view"] } };
    const bi = capabilityBinding("invitation", token, bindInvitation(inv));
    expect(verifyCapability("invitation", token, bi, bindInvitation(inv))).toBe(true);
    for (const changed of [{ phone: "0500000002" }, { roleKey: "nazir" }, { scope: { permissions: ["waqf.view", "waqf.edit"] } }, { waqfId: row.documentId }, { expiresAt: D("2027-06-01T00:00:00Z") }])
      expect(verifyCapability("invitation", token, bi, bindInvitation({ ...inv, ...changed })), JSON.stringify(changed)).toBe(false);
    const rs = { id: row.id, reportId: row.documentId, waqfId: row.waqfId, createdBy: row.createdBy, expiresAt: row.expiresAt };
    const br = capabilityBinding("report_share", token, bindReportShare(rs));
    expect(verifyCapability("report_share", token, br, bindReportShare(rs))).toBe(true);
    expect(verifyCapability("report_share", token, br, bindReportShare({ ...rs, reportId: row.waqfId! }))).toBe(false);
  });
});

const devDb = /waqfak_dev/.test(process.env.DATABASE_URL ?? "");
describe.skipIf(!devDb)("capability tokens — use paths on the development database (synthetic rows)", () => {
  const created: { shares: string[]; invitations: string[] } = { shares: [], invitations: [] };
  afterAll(async () => {
    await withSystem(async (tx) => {
      if (created.shares.length) await tx.delete(schema.documentShares).where(inArray(schema.documentShares.id, created.shares));
      if (created.invitations.length) await tx.delete(schema.invitations).where(inArray(schema.invitations.id, created.invitations));
    });
  });

  async function fixtures() {
    return withSystem(async (tx) => {
      const docs = await tx.select({ d: schema.documents }).from(schema.documents)
        .innerJoin(schema.documentVersions, and(eq(schema.documentVersions.documentId, schema.documents.id), eq(schema.documentVersions.version, schema.documents.currentVersion)))
        .where(and(eq(schema.documents.status, "active"), isNull(schema.documents.archivedAt), ne(schema.documents.confidentiality, "secret"), eq(schema.documentVersions.scanStatus, "clean"))).limit(2);
      const [u] = await tx.select({ id: schema.users.id }).from(schema.users).limit(1);
      return { docs: docs.map((x) => x.d), user: u!.id };
    });
  }

  async function issueShare(documentId: string, waqfId: string | null, createdBy: string, maxUses = 2) {
    const token = randomToken(24);
    const row = { id: crypto.randomUUID(), documentId, waqfId, createdBy, expiresAt: new Date(Date.now() + 86_400_000), maxUses };
    await withSystem((tx) => tx.insert(schema.documentShares).values({ ...row, tokenHash: capabilityLookup("document_share", token), binding: capabilityBinding("document_share", token, bindDocumentShare(row)) }));
    created.shares.push(row.id);
    return { token, row };
  }

  it("a share link works as issued; re-pointed, extended or given more uses by a database writer, it is refused", async () => {
    const { viewShare, consumeShare } = await import("../src/server/modules/documents/share");
    const f = await fixtures();
    if (f.docs.length < 2) return expect.fail("development database lacks two clean documents");
    const [a, b] = f.docs as [typeof f.docs[0], typeof f.docs[0]];
    const s = await issueShare(a.id, a.waqfId, f.user);
    expect((await viewShare(s.token)).state).toBe("ok");
    // re-point to another document
    await withSystem((tx) => tx.update(schema.documentShares).set({ documentId: b.id }).where(eq(schema.documentShares.id, s.row.id)));
    expect((await viewShare(s.token)).state).toBe("not_found");
    expect((await consumeShare(s.token, "127.0.0.1")).file).toBeNull();
    // back, then extended
    await withSystem((tx) => tx.update(schema.documentShares).set({ documentId: a.id, expiresAt: new Date(Date.now() + 365 * 86_400_000) }).where(eq(schema.documentShares.id, s.row.id)));
    expect((await viewShare(s.token)).state).toBe("not_found");
    // back, then more uses
    await withSystem((tx) => tx.update(schema.documentShares).set({ expiresAt: s.row.expiresAt, maxUses: 50 }).where(eq(schema.documentShares.id, s.row.id)));
    expect((await viewShare(s.token)).state).toBe("not_found");
    await withSystem((tx) => tx.update(schema.documentShares).set({ maxUses: s.row.maxUses }).where(eq(schema.documentShares.id, s.row.id)));
    expect((await viewShare(s.token)).state).toBe("ok");
  });

  it("a share link's uses are limited, single uses not reusable, and revocation holds", async () => {
    const { viewShare } = await import("../src/server/modules/documents/share");
    const f = await fixtures();
    const a = f.docs[0]!;
    const s = await issueShare(a.id, a.waqfId, f.user, 1);
    // consume the one use directly (the decryption path is not the subject here): uses = maxUses
    await withSystem((tx) => tx.update(schema.documentShares).set({ uses: 1 }).where(eq(schema.documentShares.id, s.row.id)));
    expect((await viewShare(s.token)).state).toBe("used_up");
    const r = await issueShare(a.id, a.waqfId, f.user);
    await withSystem((tx) => tx.update(schema.documentShares).set({ revokedAt: new Date() }).where(eq(schema.documentShares.id, r.row.id)));
    expect((await viewShare(r.token)).state).toBe("revoked");
  });

  it("a row planted by a database writer (unkeyed, as before), or a token of another purpose, opens nothing", async () => {
    const { viewShare } = await import("../src/server/modules/documents/share");
    const { invitationByToken } = await import("../src/server/modules/waqf-core/queries");
    const f = await fixtures();
    const a = f.docs[0]!;
    const token = randomToken(24);
    const id = crypto.randomUUID();
    // the former scheme: sha256(token), no binding
    await withSystem((tx) => tx.insert(schema.documentShares).values({ id, documentId: a.id, waqfId: a.waqfId, createdBy: f.user, expiresAt: new Date(Date.now() + 86_400_000), maxUses: 5, tokenHash: sha256(token) }));
    created.shares.push(id);
    expect((await viewShare(token)).state).toBe("not_found");
    // the keyed lookup planted without the key's binding
    const id2 = crypto.randomUUID();
    await withSystem((tx) => tx.insert(schema.documentShares).values({ id: id2, documentId: a.id, waqfId: a.waqfId, createdBy: f.user, expiresAt: new Date(Date.now() + 86_400_000), maxUses: 5, tokenHash: capabilityLookup("document_share", `${token}2`), binding: "forged" }));
    created.shares.push(id2);
    expect((await viewShare(`${token}2`)).state).toBe("not_found");
    // a valid share token is not an invitation token
    const s = await issueShare(a.id, a.waqfId, f.user);
    expect(await invitationByToken(s.token)).toBeNull();
  });

  it("an invitation is bound to its phone, role, waqf, scope and expiry", async () => {
    const { invitationByToken } = await import("../src/server/modules/waqf-core/queries");
    const f = await fixtures();
    const waqfId = f.docs[0]!.waqfId!;
    const token = randomToken(24);
    const row = { id: crypto.randomUUID(), waqfId, phone: "0500000999", roleKey: "viewer", invitedBy: f.user, expiresAt: new Date(Date.now() + 7 * 86_400_000), scope: null };
    await withSystem((tx) => tx.insert(schema.invitations).values({ ...row, tokenHash: capabilityLookup("invitation", token), binding: capabilityBinding("invitation", token, bindInvitation(row)) }));
    created.invitations.push(row.id);
    expect(await invitationByToken(token)).toMatchObject({ id: row.id, phone: row.phone, roleKey: "viewer" });
    for (const set of [{ phone: "0500000998" }, { roleKey: "nazir" }, { scope: { permissions: ["waqf.edit"] } }, { expiresAt: new Date(Date.now() + 90 * 86_400_000) }]) {
      await withSystem((tx) => tx.update(schema.invitations).set(set).where(eq(schema.invitations.id, row.id)));
      expect(await invitationByToken(token), JSON.stringify(set)).toBeNull();
      await withSystem((tx) => tx.update(schema.invitations).set({ phone: row.phone, roleKey: row.roleKey, scope: null, expiresAt: row.expiresAt }).where(eq(schema.invitations.id, row.id)));
    }
    expect(await invitationByToken(token)).not.toBeNull();
  });
});
