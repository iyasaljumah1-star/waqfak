/**
 * Demo documents (fictional, marked "(تجريبي)"): a few encrypted files per demo waqf covering
 * approval states, confidentiality levels and expiry badges (expired, 25 and 50 days ahead).
 * Waqf A deliberately misses some required documents (ownership deeds) so the checklist shows gaps.
 * Idempotent: skips any document whose title already exists in that waqf.
 */
import { and, eq, inArray } from "drizzle-orm";
import type { Tx } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import { encryptBuffer, newDataKey, sha256, unwrapDataKey } from "../../src/server/lib/crypto";
import { getStorage, newStorageKey } from "../../src/server/adapters/storage";
import type { DemoCtx } from "../seed-demo";

/** Minimal one-page PDF with an ASCII caption (Helvetica has no Arabic glyphs). */
function demoPdf(caption: string) {
  const text = `BT /F1 16 Tf 40 100 Td (${caption.replace(/[()\\]/g, "")}) Tj ET`;
  const objs = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${text.length} >>\nstream\n${text}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objs.forEach((o, i) => {
    offsets.push(out.length);
    out += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xref = out.length;
  out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("")}`;
  out += `trailer << /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(out, "latin1");
}

const day = (n: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function keyFor(tx: Tx, waqfId: string) {
  const [k] = await tx.select().from(s.waqfKeys).where(eq(s.waqfKeys.waqfId, waqfId)).limit(1);
  if (k) return unwrapDataKey(k.wrappedKey);
  const nk = newDataKey();
  await tx.insert(s.waqfKeys).values({ waqfId, wrappedKey: nk.wrapped });
  return nk.raw;
}

type Spec = {
  docType: string; title: string; number?: string; issuer?: string; issuedOn?: string; issuedOnHijri?: string; expiresOn?: string;
  confidentiality?: "internal" | "confidential" | "secret"; approval?: "none" | "approved" | "in_review"; caption: string; file: string;
};

export default async function demoDocuments(tx: Tx, ctx: DemoCtx) {
  const storage = getStorage();
  const plan: { waqfId: string; owner: string; docs: Spec[] }[] = [
    {
      waqfId: ctx.waqfs.A,
      owner: ctx.users.nazir,
      docs: [
        { docType: "waqf_deed", title: "صك وقف النور التعليمي (تجريبي)", number: "DEMO-4410-001", issuer: "محكمة تجريبية", issuedOn: "2023-03-14", issuedOnHijri: "1444/08/22", approval: "approved", caption: "DEMO - Waqf deed (fictional)", file: "waqf-deed-demo.pdf" },
        { docType: "registration_certificate", title: "شهادة تسجيل الوقف (تجريبي)", number: "DEMO-REG-001", issuer: "الهيئة العامة للأوقاف (تجريبي)", issuedOn: "2023-05-02", expiresOn: day(25), approval: "approved", caption: "DEMO - Registration certificate", file: "registration-demo.pdf" },
        { docType: "lease", title: "عقد إيجار المبنى التعليمي (تجريبي)", number: "DEMO-L-17", issuer: "منصة إيجار (تجريبي)", issuedOn: day(-320), expiresOn: day(50), approval: "none", caption: "DEMO - Lease contract", file: "lease-demo.pdf" },
        { docType: "permission", title: "إذن صيانة المبنى (تجريبي)", issuer: "البلدية (تجريبي)", issuedOn: day(-400), expiresOn: day(-12), caption: "DEMO - Maintenance permit", file: "permit-demo.pdf" },
        { docType: "nazara_deed", title: "صك نظارة وقف النور (تجريبي)", number: "DEMO-NZ-001", issuer: "محكمة تجريبية", issuedOn: "2023-03-14", issuedOnHijri: "1444/08/22", approval: "approved", caption: "DEMO - Nazara deed", file: "nazara-deed-demo.pdf" },
        { docType: "bo_register", title: "سجل المستفيد الحقيقي (تجريبي)", issuedOn: day(-90), confidentiality: "confidential", approval: "approved", caption: "DEMO - Beneficial owner register", file: "bo-register-demo.pdf" },
        { docType: "financial_statement", title: "القوائم المالية 2025 (تجريبي)", issuer: "مراجع خارجي (تجريبي)", issuedOn: "2026-03-30", confidentiality: "confidential", approval: "in_review", caption: "DEMO - Financial statements 2025", file: "fs-2025-demo.pdf" },
        { docType: "bank_statement", title: "كشف الحساب البنكي — سبتمبر (تجريبي)", confidentiality: "secret", caption: "DEMO - Bank statement", file: "bank-demo.pdf" },
      ],
    },
    {
      waqfId: ctx.waqfs.B,
      owner: ctx.users.waqif,
      docs: [
        { docType: "waqf_deed", title: "صك وقف آل سالم الأهلي (تجريبي)", number: "DEMO-4412-207", issuer: "محكمة تجريبية", issuedOn: "2024-01-10", issuedOnHijri: "1445/06/28", approval: "none", caption: "DEMO - Family waqf deed", file: "family-waqf-deed-demo.pdf" },
        { docType: "registration_certificate", title: "شهادة تسجيل وقف آل سالم (تجريبي)", number: "DEMO-REG-207", issuer: "الهيئة العامة للأوقاف (تجريبي)", issuedOn: "2024-02-01", expiresOn: day(-5), approval: "none", caption: "DEMO - Registration certificate (expired)", file: "registration-b-demo.pdf" },
      ],
    },
    {
      waqfId: ctx.waqfs.C,
      owner: ctx.users.chair,
      docs: [
        { docType: "minutes", title: "محضر اجتماع مجلس النظارة الأول (تجريبي)", issuedOn: day(-60), approval: "approved", caption: "DEMO - Board minutes", file: "minutes-demo.pdf" },
        { docType: "policy", title: "سياسة تعارض المصالح (تجريبي)", issuedOn: day(-200), approval: "approved", caption: "DEMO - COI policy", file: "coi-policy-demo.pdf" },
      ],
    },
  ];

  for (const p of plan) {
    const existing = await tx
      .select({ title: s.documents.title })
      .from(s.documents)
      .where(and(eq(s.documents.waqfId, p.waqfId), inArray(s.documents.title, p.docs.map((d) => d.title))));
    const have = new Set(existing.map((e) => e.title));
    const todo = p.docs.filter((d) => !have.has(d.title));
    if (!todo.length) continue;
    const key = await keyFor(tx, p.waqfId);
    for (const d of todo) {
      const data = demoPdf(d.caption);
      const enc = encryptBuffer(data, key);
      const storageKey = newStorageKey({ waqfId: p.waqfId, userId: p.owner });
      await storage.put(storageKey, enc.ct);
      const [doc] = await tx
        .insert(s.documents)
        .values({
          waqfId: p.waqfId, ownerUserId: p.owner, docType: d.docType, title: d.title, number: d.number ?? null, issuer: d.issuer ?? null,
          issuedOn: d.issuedOn ?? null, issuedOnHijri: d.issuedOnHijri ?? null, expiresOn: d.expiresOn ?? null,
          confidentiality: d.confidentiality ?? "internal", status: "active", approvalStatus: d.approval ?? "none", currentVersion: 1,
          createdBy: p.owner, updatedBy: p.owner,
        })
        .returning({ id: s.documents.id });
      await tx.insert(s.documentVersions).values({
        documentId: doc.id, waqfId: p.waqfId, version: 1, storageKey, sha256: sha256(data), sizeBytes: data.length, mimeType: "application/pdf",
        originalName: d.file, encrypted: true, iv: enc.iv, authTag: enc.tag, scanStatus: "clean", scanDetail: "builtin: clean", uploadedBy: p.owner,
      });
      await tx.insert(s.documentAccessLog).values({ documentId: doc.id, waqfId: p.waqfId, userId: p.owner, action: "upload" });
    }
  }
}
