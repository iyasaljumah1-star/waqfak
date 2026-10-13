import { describe, expect, it } from "vitest";
import { draftDeed, draftWill, type DraftInput } from "@/server/modules/outputs/drafting";
import { applyEdits, mergeRegenerated, readiness } from "@/server/modules/outputs/pure";
import type { OutputSection } from "@/server/db/schema/operations";

const will = (keys: Record<string, string>, tables: DraftInput["tables"] = {}, attached: Record<string, number> = {}): DraftInput => ({ keys, tables, attached, requesterName: "موصٍ تجريبي" });
const text = (d: ReturnType<typeof draftWill>) => d.clauses.map((c) => c.text).join("\n");

const FULL_WILL = will(
  { testatorName: "عبدالله التجريبي", testatorId: "1000000001", hasPreviousWill: "yes", previousWillDate: "2020-05-01", previousWillAction: "revoke", includesWaqf: "yes", waqfName: "وقف تجريبي", waqfNazir: "خالد التجريبي", waqfSuccession: "eldest", executorName: "سعد التجريبي", executorRelation: "heir", documentation: "najiz" },
  { bequests: [{ kind: "waqf", recipient: "الفقراء والمساكين", relation: "entity", basis: "share", percent: "20" }, { kind: "charity", recipient: "جمعية تجريبية", relation: "entity", basis: "share", percent: "10" }], waqfMasarif: [{ beneficiary: "الفقراء", share: "60" }, { beneficiary: "طلبة العلم", share: "40" }] },
  { previousWill: 1 },
);

describe("will drafting (W01)", () => {
  it("writes every clause from the structured answers, with references, and no gaps when complete", () => {
    const d = draftWill(FULL_WILL);
    const t = text(d);
    expect(t).toContain("أنا عبدالله التجريبي، صاحب الهوية الوطنية رقم 1000000001");
    expect(t).toContain("أُلغي جميع وصاياي السابقة، ومنها وصيتي المؤرخة في 2020-05-01");
    expect(t).toContain("أوصي بنسبة 20٪ من تركتي وقفًا بعد وفاتي على الفقراء والمساكين.");
    expect(t).toContain("يُسمّى «وقف تجريبي»");
    expect(t).toContain("فإن خلت النظارة تولاها الأصلح فالأصلح من الموقوف عليهم");
    expect(t).toContain("أُسند تنفيذ هذه الوصية إلى سعد التجريبي، وهو من ورثتي");
    expect(t).toContain("«ناجز»");
    expect(t).not.toContain("[يُستكمل");
    expect(d.gaps.filter((g) => g.severity === "blocking")).toEqual([]);
    expect(d.clauses.every((c) => c.refs?.length)).toBe(true);
    expect(d.checks.every((c) => c.ok)).toBe(true);
  });

  it("never invents: missing values become placeholders and gaps naming the field and owner", () => {
    const d = draftWill(will({ hasPreviousWill: "no", documentation: "witnesses" }, { bequests: [{ kind: "person", recipient: "", relation: "no", basis: "amount" }] }));
    expect(text(d)).toContain("[يُستكمل: اسم الموصي]");
    const g = d.gaps.find((x) => x.key === "field:testatorName")!;
    expect(g).toMatchObject({ severity: "blocking", owner: "client", field: "testatorName" });
    expect(d.gaps.some((x) => x.key === "field:executorName")).toBe(true);
    expect(d.gaps.some((x) => x.key === "field:witnesses")).toBe(true);
    expect(d.gaps.some((x) => x.key === "field:bequests:0:amount")).toBe(true);
  });

  it("checks the third of the estate and flags bequests to an heir for the specialist", () => {
    const over = draftWill(will({ ...FULL_WILL.keys }, { ...FULL_WILL.tables, bequests: [{ kind: "person", recipient: "ابن تجريبي", relation: "yes", basis: "share", percent: "40" }] }, { previousWill: 1 }));
    expect(text(over)).toContain("وما زاد من وصاياي على ثلث تركتي فلا ينفذ إلا بإجازة الورثة");
    expect(over.gaps.find((g) => g.key === "third_over")).toMatchObject({ severity: "warning", owner: "specialist" });
    expect(over.gaps.find((g) => g.key === "heir_bequest")?.owner).toBe("specialist");
    expect(over.checks.find((c) => c.label.includes("ثلث"))?.ok).toBe(false);
    // amounts: unknown without an estate estimate, computed with it
    const amt = { bequests: [{ kind: "charity", recipient: "جمعية", relation: "entity", basis: "amount", amount: "100000" }] };
    expect(draftWill(will({ ...FULL_WILL.keys, includesWaqf: "no" }, amt, { previousWill: 1 })).gaps.some((g) => g.key === "third_unknown")).toBe(true);
    const ok = draftWill(will({ ...FULL_WILL.keys, includesWaqf: "no", estimatedEstate: "1000000" }, amt, { previousWill: 1 }));
    expect(ok.gaps.some((g) => g.key.startsWith("third"))).toBe(false);
    expect(ok.checks.find((c) => c.label.includes("ثلث"))?.detail).toContain("10٪");
  });

  it("detects a waqf choice that the bequests table does not carry", () => {
    const d = draftWill(will({ ...FULL_WILL.keys }, { ...FULL_WILL.tables, bequests: [{ kind: "charity", recipient: "جهة", relation: "entity", basis: "share", percent: "5" }] }, { previousWill: 1 }));
    expect(d.gaps.some((g) => g.key === "waqf_missing_row" && g.severity === "blocking")).toBe(true);
  });
});

describe("deed drafting (T03)", () => {
  const deed = (k: Record<string, string>, masarif: Record<string, string>[] = [], attached: Record<string, number> = { ownership: 1 }) => draftDeed({ keys: k, tables: { masarif }, attached, requesterName: "واقف" });
  const FULL = { waqifName: "واقف تجريبي", waqifId: "1000000002", waqfName: "وقف الاختبار", waqfKind: "general", assetType: "real_estate", assetDescription: "أرض تجريبية في حي تجريبي مساحتها 500م²", ownershipDeedNo: "T-123", registeredToWaqif: "yes", mortgaged: "no", share: "whole", appurtenances: "all", alternateMasraf: "الفقراء والمساكين", reservePercent: "10", selfBenefit: "no", nazirType: "named", nazirName: "ناظر تجريبي", succession: "authority", investmentAllowed: "yes", amendmentRight: "no" };
  const M = [{ tier: "1", beneficiary: "أولاد الواقف", division: "equal" }, { tier: "2", beneficiary: "طلبة العلم", division: "na" }];

  it("writes the clauses of the drafting guide from the answers", () => {
    const d = deed(FULL, M);
    const t = d.clauses.map((c) => `${c.title}: ${c.text}`).join("\n");
    expect(t).toContain("وقفًا عامًّا (خيريًّا)، تحبيسًا لأصله وتسبيلًا لمنفعته");
    expect(t).toContain("الصك رقم T-123");
    expect(t).toContain("كامل الأصل، بجميع حقوقه وما يلحق به وما فيه");
    expect(t).toContain("بعد استقطاع 10٪ من صافي الريع");
    expect(t).toContain("على أولاد الواقف بالتساوي بينهم؛ فإن انقرضوا أو انقطعوا فعلى طلبة العلم");
    expect(t).toContain("فإن انقطع المستحقون جميعًا صُرفت الغلة إلى الفقراء والمساكين");
    expect(t).toContain("يتولى نظارة الوقف ناظر تجريبي، فإن خلت النظارة تولاها من تعيّنه الجهة المختصة");
    expect(d.gaps.filter((g) => g.severity === "blocking")).toEqual([]);
  });

  it("blocks on ownership and mortgage, and leaves board rules and partial self-benefit to the specialist", () => {
    const d = deed({ ...FULL, registeredToWaqif: "no", mortgaged: "yes", nazirType: "board", boardSize: "5", selfBenefit: "yes", selfBenefitScope: "part" }, M, {});
    expect(d.gaps.find((g) => g.key === "ownership")?.severity).toBe("blocking");
    expect(d.gaps.find((g) => g.key === "mortgaged")?.severity).toBe("blocking");
    expect(d.gaps.find((g) => g.key === "doc:ownership")?.severity).toBe("blocking");
    expect(d.gaps.find((g) => g.key === "board_rules")?.owner).toBe("specialist");
    expect(d.gaps.find((g) => g.key === "self_benefit_amount")?.owner).toBe("specialist");
    expect(d.clauses.some((c) => c.key === "board")).toBe(true);
  });
});

describe("clause edits survive regeneration", () => {
  const sec = (txt: string): OutputSection[] => [{ key: "will_clauses", title: "نص الوصية", required: true, blocks: [{ type: "clause", key: "executor", n: 1, title: "منفذ الوصية", text: txt, generated: txt, prov: "client" }] }];

  it("an edited clause keeps the human text; an untouched clause follows fresh data; a changed source is flagged", () => {
    const v1 = sec("أُسند تنفيذ هذه الوصية إلى سعد.");
    const edited = applyEdits(v1, { "clause:will_clauses:executor": "أُسند تنفيذ هذه الوصية إلى سعد بن تجريبي، ويعاونه أخوه." });
    expect(edited.changed).toBe(true);
    // same data → human text kept, no conflict
    const same = mergeRegenerated(edited.sections, v1, []);
    expect((same.sections[0].blocks[0] as { text: string }).text).toContain("ويعاونه أخوه");
    expect(same.gaps).toEqual([]);
    // data changed → human text kept, conflict flagged for review
    const changed = mergeRegenerated(edited.sections, sec("أُسند تنفيذ هذه الوصية إلى فهد."), []);
    expect((changed.sections[0].blocks[0] as { text: string }).text).toContain("ويعاونه أخوه");
    expect(changed.gaps[0].key).toBe("conflict:will_clauses:executor");
    // untouched clause → fresh wording
    const fresh = mergeRegenerated(v1, sec("أُسند تنفيذ هذه الوصية إلى فهد."), []);
    expect((fresh.sections[0].blocks[0] as { text: string }).text).toContain("فهد");
  });

  it("an emptied clause counts as unwritten and blocks submission", () => {
    const v = sec("");
    expect(readiness(v, []).ready).toBe(false);
  });
});
