/**
 * Admin editors: validation helpers (pure) + an obligation added as data applying through the real
 * compliance engine (DB, inside a rolled-back system transaction).
 */
import "dotenv/config";
import { describe, expect, it, vi } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import {
  bankPublishProblems, buildRtm, citesArticle, articleTokens, diffFields, filterRtm, nextReqCode, overlappingPrice, parseIntList, parseLogic,
  rtmCsvRows, unknownVars, validateOptions, validateStages, weightSums, WAQF_FACT_KEYS,
} from "../src/server/modules/admin/editors/pure";

vi.mock("server-only", () => ({}));

describe("parseLogic", () => {
  it("accepts valid JSON-logic and empty optional input", () => {
    expect(parseLogic('{"==": [{"var": "sizeClass"}, "large"]}')).toEqual({ ok: true, value: { "==": [{ var: "sizeClass" }, "large"] } });
    expect(parseLogic("", { optional: true })).toEqual({ ok: true, value: null });
    expect(parseLogic("true")).toEqual({ ok: true, value: true });
  });
  it("rejects invalid JSON, unknown operators, multi-key nodes and arrays with Arabic messages", () => {
    const bad = parseLogic('{"==": [{"var": "sizeClass"}, "large"', { label: "قاعدة الانطباق" });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.error).toMatch(/قاعدة الانطباق: ليست JSON صالحًا/);
    const op = parseLogic('{"foo": [1, 2]}');
    expect(!op.ok && op.error).toMatch(/العامل «foo» غير مدعوم/);
    const multi = parseLogic('{"==": [1, 1], "!=": [1, 2]}');
    expect(!multi.ok && multi.error).toMatch(/عاملًا واحدًا/);
    expect(parseLogic("[1,2]").ok).toBe(false);
    expect(parseLogic('"text"').ok).toBe(false);
    expect(parseLogic("", { optional: false }).ok).toBe(false);
  });
  it("finds nested invalid operators", () => {
    expect(parseLogic('{"and": [{"==": [1, 1]}, {"regex": ["a", "b"]}]}').ok).toBe(false);
  });
  it("flags unknown waqf facts", () => {
    expect(unknownVars({ and: [{ "==": [{ var: "sizeClass" }, "large"] }, { var: "assessment.hasPortfolio" }, { var: "sizeKlass" }] }, WAQF_FACT_KEYS)).toEqual(["sizeKlass"]);
  });
});

describe("workflow stages", () => {
  it("validates keys, SLA, roles, duplicates and unknown fields", () => {
    expect(validateStages([{ key: "intake", name: "استلام", slaDays: 3, role: "employee" }]).ok).toBe(true);
    expect(validateStages([]).ok).toBe(false);
    expect(validateStages([{ key: "Bad Key", name: "x", slaDays: 1, role: "r" }]).ok).toBe(false);
    expect(validateStages([{ key: "a1", name: "أ", slaDays: 1, role: "r" }, { key: "a1", name: "ب", slaDays: 1, role: "r" }]).ok).toBe(false);
    expect(validateStages([{ key: "a1", name: "أب", slaDays: -1, role: "r" }]).ok).toBe(false);
    expect(validateStages([{ key: "a1", name: "أب", slaDays: 1, role: "" }]).ok).toBe(false);
    expect(validateStages([{ key: "a1", name: "أب", slaDays: 1, role: "r", extra: 1 }]).ok).toBe(false);
    const r = validateStages([{ key: "client_ok", name: "اعتماد", slaDays: 5, role: "client", clientApproval: true }]);
    expect(r.ok && r.value[0].clientApproval).toBe(true);
  });
});

describe("question bank", () => {
  it("weight sums must be 100 per size class", () => {
    expect(weightSums([{ code: "A1", weightSmall: 60, weightMedium: "50", weightLarge: 40 }, { code: "A2", weightSmall: 40, weightMedium: 50, weightLarge: "60" }]).ok).toBe(true);
    const w = weightSums([{ code: "A1", weightSmall: 60, weightMedium: 50, weightLarge: 40 }]);
    expect(w).toMatchObject({ ok: false, small: 60, medium: 50, large: 40 });
  });
  it("options: choice types need ≥2 unique options with scores 0..5", () => {
    expect(validateOptions("yes_no", [{ value: "yes", label: "نعم", score: 5 }, { value: "no", label: "لا", score: 0 }]).ok).toBe(true);
    expect(validateOptions("yes_no", null).ok).toBe(false);
    expect(validateOptions("maturity", null).ok).toBe(true);
    expect(validateOptions("text", null).ok).toBe(true);
    expect(validateOptions("text", [{ value: "a", label: "a" }, { value: "b", label: "b" }]).ok).toBe(false);
    expect(validateOptions("select", [{ value: "a", label: "a" }, { value: "a", label: "b" }]).ok).toBe(false);
    expect(validateOptions("select", [{ value: "a", label: "a", score: 7 }, { value: "b", label: "b" }]).ok).toBe(false);
  });
  it("lists publish problems", () => {
    const axes = [{ code: "A1", weightSmall: 100, weightMedium: 100, weightLarge: 100 }];
    const q = (o: Partial<Parameters<typeof bankPublishProblems>[1][number]>) => ({ code: "Q1", axisCode: "A1", answerType: "yes_no", options: [{ value: "y", label: "y", score: 5 }, { value: "n", label: "n", score: 0 }], showIf: null, criticalWhen: null, criticalFlagCode: null, factKey: "f1", ...o });
    expect(bankPublishProblems(axes, [q({})], [])).toEqual([]);
    expect(bankPublishProblems(axes, [q({ axisCode: "A9" })], []).join()).toMatch(/A9/);
    expect(bankPublishProblems(axes, [q({ showIf: { nope: [] } })], []).join()).toMatch(/شرط الظهور/);
    expect(bankPublishProblems(axes, [q({ criticalFlagCode: "R99" })], ["R01"]).join()).toMatch(/R99/);
    expect(bankPublishProblems(axes, [q({}), q({ code: "Q2" })], []).join()).toMatch(/مستخدم أيضًا/);
    expect(bankPublishProblems([{ code: "A1", weightSmall: 90, weightMedium: 100, weightLarge: 100 }], [q({})], []).join()).toMatch(/100/);
  });
});

describe("pricing and logs", () => {
  it("rejects overlapping price periods for the same size class", () => {
    const rows = [{ id: "1", sizeClass: "large", validFrom: "2026-01-01", validTo: "2026-06-30" }];
    expect(overlappingPrice(rows, { sizeClass: "large", validFrom: "2026-06-01", validTo: null })).not.toBeNull();
    expect(overlappingPrice(rows, { sizeClass: "large", validFrom: "2026-07-01", validTo: null })).toBeNull();
    expect(overlappingPrice(rows, { sizeClass: "medium", validFrom: "2026-03-01", validTo: null })).toBeNull();
    expect(overlappingPrice(rows, { id: "1", sizeClass: "large", validFrom: "2026-02-01", validTo: null })).toBeNull();
    expect(overlappingPrice([{ sizeClass: null, validFrom: null, validTo: null }], { sizeClass: null, validFrom: "2030-01-01", validTo: null })).not.toBeNull();
  });
  it("diffFields reports real changes only (numeric strings compare by value)", () => {
    expect(diffFields({ price: "100.00", a: null }, { price: 100, a: "" })).toEqual([]);
    expect(diffFields({ price: "100.00" }, { price: 120 })).toEqual([{ field: "price", oldValue: "100.00", newValue: "120" }]);
    expect(diffFields(null, { x: { a: 1 } })).toEqual([{ field: "x", oldValue: null, newValue: '{"a":1}' }]);
  });
  it("misc parsers", () => {
    expect(nextReqCode(["REQ-001", "REQ-045", "OTHER"])).toBe("REQ-046");
    expect(nextReqCode([])).toBe("REQ-001");
    expect(parseIntList("30، 7, 1")).toEqual({ ok: true, value: [30, 7, 1] });
    expect(parseIntList("a").ok).toBe(false);
  });
});

describe("traceability matrix", () => {
  const input = {
    references: [{ id: "ref1", code: "NAZARA-REG", sourceName: "لائحة تنظيم أعمال النظارة", verificationStatus: "pending_verification" }],
    requirements: [
      { id: "r1", code: "REQ-001", title: "تسجيل", article: "م8/1", featureArea: "compliance", status: "implemented", verificationStatus: "verified", referenceId: "ref1", implementedAs: [{ kind: "obligation", ref: "OB-REG-01" }, { kind: "rule", ref: "R-X-404" }] },
      { id: "r2", code: "REQ-002", title: "بلا تنفيذ", article: null, featureArea: null, status: "planned", verificationStatus: "pending_verification", referenceId: null, implementedAs: [] },
    ],
    obligations: [{ id: "o1", code: "OB-REG-01", titleAr: "تسجيل الوقف", requirementId: "r1", status: "published" }, { id: "o2", code: "OB-NEW", titleAr: "جديد", requirementId: "r1", status: "draft" }],
    rules: [{ code: "R-REG-001", titleAr: "تسجيل", reference: "لائحة تنظيم أعمال النظارة م8/1؛ جدول المخالفات 7-2", status: "published" }, { code: "R-REG-009", titleAr: "أخرى", reference: "لائحة تنظيم أعمال النظارة م18/1", status: "published" }],
    flags: [],
  };
  it("derives links from implementedAs, obligation.requirementId and rule references", () => {
    const [r1, r2] = buildRtm(input);
    const kinds = r1.links.map((l) => `${l.kind}:${l.ref}:${l.linkStatus}:${l.derived}`);
    expect(kinds).toContain("obligation:OB-REG-01:ok:false");
    expect(kinds).toContain("rule:R-X-404:missing:false");
    expect(kinds).toContain("obligation:OB-NEW:inactive:true");
    expect(kinds).toContain("rule:R-REG-001:ok:true");
    expect(kinds.join()).not.toContain("R-REG-009"); // م18/1 must not match م8/1
    expect(r1.sourceCode).toBe("NAZARA-REG");
    expect(r2.links).toEqual([]);
    expect(filterRtm([r1, r2], { gaps: true }).map((r) => r.reqCode)).toEqual(["REQ-001", "REQ-002"]);
    expect(filterRtm([r1, r2], { q: "OB-NEW" }).map((r) => r.reqCode)).toEqual(["REQ-001"]);
    expect(filterRtm([r1, r2], { kind: "rule" }).map((r) => r.reqCode)).toEqual(["REQ-001"]);
    expect(rtmCsvRows([r2])[0]).toContain("لا يوجد تنفيذ");
  });
  it("article tokens", () => {
    expect(articleTokens("م15/4 و5")).toEqual(["م15/4"]);
    expect(articleTokens("م23/7 وم25")).toEqual(["م23/7", "م25"]);
    expect(citesArticle("لائحة م8/1؛", "م8/1")).toBe(true);
    expect(citesArticle("لائحة م18/1", "م8/1")).toBe(false);
    expect(citesArticle("لائحة م8/12", "م8/1")).toBe(false);
  });
});

// ───────────── DB: an admin-defined obligation applies through the engine (rolled back) ─────────────

const hasDemo = existsSync("storage/demo-credentials.json") && !!process.env.DATABASE_URL;
const demo = hasDemo ? (JSON.parse(readFileSync("storage/demo-credentials.json", "utf8")) as { waqfs: { A: string; B: string; C: string } }) : null;
class Rollback extends Error {}

describe.skipIf(!hasDemo)("obligation defined as data (DB, rolled back)", () => {
  it("a standing obligation with a JSON-logic rule reaches the large waqf only after resyncAllWaqfs", async () => {
    const { withSystem } = await import("../src/server/db");
    const { obligations, obligationInstances } = await import("../src/server/db/schema");
    const { resyncAllWaqfs } = await import("../src/server/modules/compliance/engine");
    const { applicabilityAcrossWaqfs } = await import("../src/server/modules/admin/editors/compliance.queries");
    const { eq } = await import("drizzle-orm");
    try {
      await withSystem(async (tx) => {
        const [o] = await tx
          .insert(obligations)
          .values({
            code: "OB-UNIT-01", titleAr: "اختبار وحدة", referenceText: "اختبار", authority: "internal", obligationType: "governance", triggerEvent: "standing",
            offsetUnit: "none", appliesTo: { rule: { "==": [{ var: "sizeClass" }, "large"] } } as never, severity: "medium", requiredAction: "اختبار", status: "published",
          })
          .returning();
        const preview = await applicabilityAcrossWaqfs(tx, { ...o, reminderOffsetsDays: o.reminderOffsetsDays } as never);
        expect(preview.find((r) => r.id === demo!.waqfs.C)?.applies).toBe(true);
        expect(preview.find((r) => r.id === demo!.waqfs.A)?.applies).toBe(false);
        await resyncAllWaqfs(tx, null);
        const inst = await tx.select().from(obligationInstances).where(eq(obligationInstances.obligationId, o.id));
        const waqfIds = inst.map((i) => i.waqfId);
        expect(waqfIds).toContain(demo!.waqfs.C);
        expect(waqfIds).not.toContain(demo!.waqfs.A);
        // Retiring it removes untouched instances on the next resync.
        await tx.update(obligations).set({ status: "retired" }).where(eq(obligations.id, o.id));
        await resyncAllWaqfs(tx, null);
        const after = await tx.select().from(obligationInstances).where(eq(obligationInstances.obligationId, o.id));
        expect(after.filter((i) => ["upcoming", "due_soon", "overdue"].includes(i.status))).toHaveLength(0);
        throw new Rollback();
      });
    } catch (e) {
      if (!(e instanceof Rollback)) throw e;
    }
  }, 60_000);
});
