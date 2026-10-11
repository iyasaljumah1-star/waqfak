import { describe, expect, it } from "vitest";
import { activationGate, licenceValid, PRACTICE_GATED_LICENSES } from "@/server/modules/nazara/licence";
import { ACTIVATION_TASKS, canTransition, checklistProgress, DEFAULT_CHECKLIST, freshChecklist, freshHandover, HANDOVER_KEYS, TRANSITIONS } from "@/server/modules/nazara/pure";
import { ROLES } from "@/server/authz/catalog";

const today = "2026-10-11";
const lic = (o: Partial<{ active: boolean; number: string; expiresOn: string }>) => ({ key: "gaa_nazara_license", ...o });

describe("nazara licence gate (لائحة تنظيم أعمال النظارة م5/2)", () => {
  it("a licence counts only when active, numbered and unexpired", () => {
    expect(licenceValid(lic({ active: true, number: "123", expiresOn: "2027-01-01" }), today)).toBe(true);
    expect(licenceValid(lic({ active: true, number: "", expiresOn: "2027-01-01" }), today)).toBe(false);
    expect(licenceValid(lic({ active: false, number: "123", expiresOn: "2027-01-01" }), today)).toBe(false);
    expect(licenceValid(lic({ active: true, number: "123", expiresOn: "2026-10-11" }), today)).toBe(false);
    expect(licenceValid(undefined, today)).toBe(false);
  });
  it("blocks activation on a real waqf without the licence, allows practice on a demo waqf, allows real activation with it", () => {
    expect(activationGate({ licence: undefined, today, waqfIsDemo: false }).allowed).toBe(false);
    expect(activationGate({ licence: undefined, today, waqfIsDemo: true })).toEqual({ allowed: true, practice: true });
    expect(activationGate({ licence: lic({ active: true, number: "9", expiresOn: "2030-01-01" }), today, waqfIsDemo: false })).toEqual({ allowed: true, practice: false });
    expect(activationGate({ licence: lic({ active: true, number: "9", expiresOn: "2030-01-01" }), today, waqfIsDemo: true })).toEqual({ allowed: true, practice: false });
  });
  it("the nazara licence gates practice, not intake", () => {
    expect(PRACTICE_GATED_LICENSES.has("gaa_nazara_license")).toBe(true);
  });
});

describe("engagement workflow", () => {
  it("allows only the defined transitions", () => {
    expect(canTransition("intake", "start_review")).toBe(true);
    expect(canTransition("intake", "accept")).toBe(false);
    expect(canTransition("under_review", "accept")).toBe(true);
    expect(canTransition("accepted", "activate")).toBe(true);
    expect(canTransition("under_review", "activate")).toBe(false);
    expect(canTransition("active", "end")).toBe(false);
    expect(canTransition("ending", "end")).toBe(true);
    expect(canTransition("ended", "resume")).toBe(false);
  });
  it("decisions need nazara.approve; running the file needs nazara.manage", () => {
    for (const k of ["accept", "reject", "activate", "suspend", "resume", "start_ending", "end"] as const) expect(TRANSITIONS[k].perm).toBe("nazara.approve");
    for (const k of ["start_review", "request_completion"] as const) expect(TRANSITIONS[k].perm).toBe("nazara.manage");
  });
  it("counts required items until received or marked not applicable", () => {
    const items = freshChecklist();
    expect(items.length).toBe(DEFAULT_CHECKLIST.length);
    expect(checklistProgress(items).requiredOpen.length).toBe(DEFAULT_CHECKLIST.filter((i) => i.required).length);
    const done = items.map((i) => ({ ...i, status: i.required ? ("received" as const) : i.status }));
    expect(checklistProgress(done).requiredOpen).toEqual([]);
  });
  it("every checklist item and activation task cites its source", () => {
    for (const i of DEFAULT_CHECKLIST) expect(i.source.length).toBeGreaterThan(10);
    for (const t of ACTIVATION_TASKS) expect(t.source.length).toBeGreaterThan(10);
  });
  it("handover covers assets, contracts, bank, finance, beneficiaries, documents, decisions, obligations and registration (م27/3)", () => {
    const h = freshHandover({ assets: "3 أصل" });
    expect(h.map((x) => x.key)).toEqual(HANDOVER_KEYS.map(([k]) => k));
    expect(h.find((x) => x.key === "assets")?.detail).toBe("3 أصل");
    expect(h.every((x) => x.status === "pending")).toBe(true);
  });
});

describe("roles", () => {
  it("only approvers decide; the officer runs the file without approving", () => {
    expect(ROLES.nazara_manager.permissions).toContain("nazara.approve");
    expect(ROLES.nazara_officer.permissions).not.toContain("nazara.approve");
    expect(ROLES.nazara_officer.globalAccess).toBeFalsy(); // reaches a waqf only through its team membership
  });
  it("full personal data is a separate permission, not part of user management", () => {
    expect(ROLES.system_admin.permissions).toContain("admin.users");
    expect(ROLES.system_admin.permissions).not.toContain("admin.pii.view");
    expect(ROLES.super_admin.permissions).toContain("admin.pii.view");
    expect(ROLES.nazara_reviewer.permissions.some((p) => p.endsWith(".edit") || p.endsWith(".manage") || p.endsWith(".approve"))).toBe(false);
  });
});
