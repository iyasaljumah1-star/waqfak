import { deflateRawSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { DEFAULT_SEPARATION, makerChecker, separationPolicy } from "@/server/authz/separation";
import { approvalCheck } from "@/server/modules/outputs/pure";
import { officePreview } from "@/server/adapters/office-preview";
import { ROLES } from "@/server/authz/catalog";

/** A minimal zip (deflated entries + central directory) for the Office preview tests. */
function zip(files: Record<string, string>) {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const [name, text] of Object.entries(files)) {
    const data = Buffer.from(text, "utf8");
    const comp = deflateRawSync(data);
    const n = Buffer.from(name, "utf8");
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(data.length, 22); lh.writeUInt16LE(n.length, 26);
    locals.push(lh, n, comp);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(data.length, 24); ch.writeUInt16LE(n.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, n);
    offset += 30 + n.length + comp.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(Object.keys(files).length, 8); end.writeUInt16LE(Object.keys(files).length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe("separation of duties (policy-driven)", () => {
  const fallback = "يعتمده زميل.";
  it("no written policy: the direct approver may approve what he prepared (recorded as self); others may not", () => {
    expect(makerChecker({ key: "quote", isMaker: true, canDirect: true, policy: DEFAULT_SEPARATION, fallback })).toEqual({ ok: true, self: true, direct: true });
    expect(makerChecker({ key: "quote", isMaker: true, canDirect: false, policy: DEFAULT_SEPARATION, fallback })).toEqual({ ok: false, error: fallback });
    expect(makerChecker({ key: "quote", isMaker: false, canDirect: false, policy: DEFAULT_SEPARATION, fallback })).toEqual({ ok: true, self: false, direct: false });
  });
  it("a written policy applies to everyone, the system administrator included, with its reference", () => {
    const policy = separationPolicy({ contract: { enforced: true, reference: "سياسة الاعتمادات المالية رقم 3/2026" } });
    const r = makerChecker({ key: "contract", isMaker: true, canDirect: true, policy, fallback });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.error).toContain("سياسة الاعتمادات المالية رقم 3/2026");
    // other actions stay as they were
    expect(makerChecker({ key: "quote", isMaker: true, canDirect: true, policy, fallback }).ok).toBe(true);
  });
  it("an enforced rule without a reference is not enforced (no invented constraint)", () => {
    expect(separationPolicy({ quote: { enforced: true, reference: "" } }).quote.enforced).toBe(false);
    expect(separationPolicy(null)).toEqual(DEFAULT_SEPARATION);
  });
  it("outputs: independent policy — direct approver allowed and recorded; colleague rule kept for other staff; written policy wins", () => {
    const base = { policy: "independent" as const, approverId: "u1", preparers: ["u1"], canReview: true, isManager: true };
    expect(approvalCheck(base).ok).toBe(false);
    expect(approvalCheck({ ...base, direct: true })).toEqual({ ok: true, self: true });
    const enforced = separationPolicy({ output: { enforced: true, reference: "دليل الجودة الداخلي" } });
    expect(approvalCheck({ ...base, direct: true, separation: enforced }).ok).toBe(false);
    expect(approvalCheck({ ...base, approverId: "u2", direct: false }).ok).toBe(true); // not a preparer
  });
  it("only the system administrator holds direct approval by default; other roles are unchanged", () => {
    const holders = Object.entries(ROLES).filter(([, r]) => (r.permissions as string[]).includes("approvals.direct")).map(([k]) => k);
    expect(holders).toEqual(["super_admin"]);
  });
});

describe("Office preview (Word / Excel)", () => {
  const docXml = `<?xml version="1.0"?><w:document xmlns:w="w"><w:body>
<w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>صياغة الوقف</w:t></w:r></w:p>
<w:p><w:r><w:rPr><w:b/></w:rPr><w:t>البند الأول:</w:t></w:r><w:r><w:t xml:space="preserve"> نص &lt;script&gt;alert(1)&lt;/script&gt;</w:t></w:r></w:p>
<w:tbl><w:tr><w:tc><w:p><w:r><w:t>الطبقة</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>1</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
</w:body></w:document>`;
  it("shows the Word text, headings and tables, escaped (no script)", () => {
    const r = officePreview(zip({ "word/document.xml": docXml }), "docx", "مسودة");
    expect(r.ok).toBe(true);
    const html = r.ok ? r.html : "";
    expect(html).toContain("<h2>صياغة الوقف</h2>");
    expect(html).toContain("<strong>البند الأول:</strong>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("<td><p>الطبقة</p></td>");
    expect(html).toContain("لا يظهر التنسيق الدقيق");
  });
  it("shows Excel sheets as tables of their values", () => {
    const r = officePreview(zip({
      "xl/workbook.xml": `<workbook><sheets><sheet name="الميزانية" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      "xl/_rels/workbook.xml.rels": `<Relationships><Relationship Id="rId1" Type="x" Target="worksheets/sheet1.xml"/></Relationships>`,
      "xl/sharedStrings.xml": `<sst><si><t>البند</t></si><si><t>المبلغ</t></si></sst>`,
      "xl/worksheets/sheet1.xml": `<worksheet><sheetData><row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="s"><v>1</v></c></row><row r="2"><c r="A2" t="inlineStr"><is><t>صيانة</t></is></c><c r="B2"><v>7300</v></c></row></sheetData></worksheet>`,
    }), "xlsx", "ميزانية");
    expect(r.ok).toBe(true);
    const html = r.ok ? r.html : "";
    expect(html).toContain("ورقة: الميزانية");
    expect(html).toContain("<td>البند</td><td>المبلغ</td>");
    expect(html).toContain("<td>صيانة</td><td>7300</td>");
  });
  it("a broken file states why it cannot be previewed", () => {
    const r = officePreview(Buffer.from("not a zip"), "docx", "x");
    expect(r).toEqual({ ok: false, reason: expect.stringContaining("تعذر قراءة الملف") });
    const empty = officePreview(zip({ "word/document.xml": "<w:document><w:body></w:body></w:document>" }), "docx", "x");
    expect(empty.ok).toBe(false);
  });
});
