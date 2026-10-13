import { describe, expect, it } from "vitest";
import { waqfCenter, type WaqfFacts } from "@/server/modules/operations/waqf-center";

const W = "00000000-0000-4000-8000-0000000000aa";
const base = (p: Partial<WaqfFacts> = {}): WaqfFacts => ({
  today: "2026-10-13", waqfakIsNazir: false,
  deed: { no: "123", date: "2020-01-01", docs: 1, conditions: 3 }, registration: { on: "2021-01-01", expiresOn: "2027-01-01" },
  assets: { count: 2, staleValuation: 0 }, leases: { arrears: 0, endingIn90: 0 }, beneficiaries: { total: 5, classes: 1 },
  finance: { entries90d: 4, lastEntry: "2026-10-01" }, budget: { year: 2026, status: "approved", currentYear: 2026 }, distributions: { overdue: 0 },
  governance: { missingPolicies: 0, totalPolicies: 12, meetings12m: 2 }, bo: { total: 1, unverified: 0, dueSoon: 0 },
  obligations: { overdue: [], dueSoon: 0 }, tasks: { open: 0, overdue: 0 }, requests: [], nazara: null, ...p,
});

describe("waqf operations center", () => {
  it("a complete file has nothing required", () => {
    const c = waqfCenter(W, base());
    expect(c.counts.required).toBe(0);
    expect(c.items.every((i) => i.state === "done")).toBe(true);
  });

  it("derives required actions from the records, each with why, owner, link and output", () => {
    const c = waqfCenter(W, base({ deed: { no: null, date: null, docs: 0, conditions: 0 }, registration: { on: "2020-01-01", expiresOn: "2026-01-01" }, assets: { count: 3, staleValuation: 2 }, bo: { total: 0, unverified: 0, dueSoon: 0 }, obligations: { overdue: [{ title: "الإفصاح السنوي", dueOn: "2026-09-01" }], dueSoon: 0 }, distributions: { overdue: 1 } }));
    const req = c.items.filter((i) => i.state === "required").map((i) => i.key);
    expect(req).toEqual(expect.arrayContaining(["deed", "deed_doc", "conditions", "registration", "bo", "obligations", "distributions"]));
    expect(c.items.find((i) => i.key === "assets")?.state).toBe("soon");
    const ob = c.items.find((i) => i.key === "obligations")!;
    expect(ob.why).toContain("الإفصاح السنوي");
    expect(ob.href).toBe(`/app/w/${W}/compliance`);
    expect(c.items[0].state).toBe("required");
    for (const i of c.items) expect(i.owner && i.output && i.perm).toBeTruthy();
  });

  it("owner is the Waqfak team when Waqfak is the nazir", () => {
    const c = waqfCenter(W, base({ waqfakIsNazir: true, deed: { no: null, date: null, docs: 1, conditions: 1 } }));
    expect(c.items.find((i) => i.key === "deed")?.owner).toContain("وقفك");
  });

  it("open requests link both ways and show who waits", () => {
    const c = waqfCenter(W, base({ requests: [{ id: "r1", number: "REQ-1", service: "صياغة الوصية", status: "quote", waitingClient: true }, { id: "r2", number: "REQ-2", service: "بيان مالي", status: "in_progress", waitingClient: false }] }));
    expect(c.items.find((i) => i.key === "req:r1")).toMatchObject({ state: "required", href: "/app/requests/r1" });
    expect(c.items.find((i) => i.key === "req:r2")?.state).toBe("soon");
  });

  it("nazara: request, acceptance, readiness and practice are distinct", () => {
    const nz = (status: string, appointmentComplete = false) => waqfCenter(W, base({ nazara: { id: "e", number: "NZR-1", status, checklistMissing: 2, appointmentComplete, appointmentMissing: appointmentComplete ? [] : ["رقم قرار التعيين"], isPractice: false, startedOn: status === "active" ? "2026-09-01" : null } })).nazara!;
    const st = (s: ReturnType<typeof nz>) => s.map((x) => x.state);
    expect(st(nz("under_review"))).toEqual(["current", "pending", "pending", "pending"]);
    const acc = nz("accepted");
    expect(st(acc)).toEqual(["done", "done", "blocked", "pending"]);
    expect(acc[2].detail).toContain("رقم قرار التعيين");
    expect(acc[1].detail).toContain("ليس تعيينًا");
    expect(st(nz("accepted", true))).toEqual(["done", "done", "current", "pending"]);
    expect(st(nz("active", true))).toEqual(["done", "done", "done", "done"]);
    expect(st(nz("rejected"))).toEqual(["blocked", "blocked", "pending", "pending"]);
  });
});
