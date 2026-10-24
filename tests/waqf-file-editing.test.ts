/**
 * Editing a waqf file after creation, and keeping waqfs apart from service requests (order of 2026-10-24).
 */
import { describe, expect, it } from "vitest";
import { completeness, reviewReason, reviewSection } from "@/server/modules/waqf-core/file-review-pure";
import { ESTABLISHING_FOUNDER_PERMS, ESTABLISHING_STATUSES, FILE_CONTENT_PERMS, ROLES, STAFF_WAQF_EDIT_PERMS } from "@/server/authz/catalog";

const full = { status: "registered", archived: false, deedInVault: true, assets: 2, classes: 3, trustees: 1, boardMembers: 0 };

describe("a waqf is complete only from its records", () => {
  it("documented with its deed in the vault, assets, masarif and a nazara", () => {
    expect(completeness(full)).toEqual({ complete: true, missing: [] });
    expect(completeness({ ...full, trustees: 0, boardMembers: 3 }).complete).toBe(true);
  });
  it("a draft, an establishment idea or a file opened from a request is not complete, whatever its data", () => {
    for (const status of ["idea", "draft", "documenting"]) {
      const c = completeness({ ...full, status });
      expect(c.complete).toBe(false);
      expect(c.missing).toContain("لم يُوثَّق الوقف بعد");
    }
  });
  it("no status without evidence: «registered» without the deed in the vault is not complete", () => {
    expect(completeness({ ...full, deedInVault: false })).toEqual({ complete: false, missing: ["صك الوقف غير مرفوع في الوثائق"] });
  });
  it("each missing part is named", () => {
    const c = completeness({ ...full, assets: 0, classes: 0, trustees: 0 });
    expect(c.missing).toEqual(["لا أصول موقوفة مسجلة", "لا مصارف أو مستحقين مسجلين", "لا ناظر أو مجلس نظارة مسجل"]);
  });
  it("an archived or ended waqf is never listed as complete", () => {
    expect(completeness({ ...full, archived: true }).complete).toBe(false);
    expect(completeness({ ...full, status: "ended" }).complete).toBe(false);
  });
});

describe("who may edit a waqf file after creation", () => {
  it("the system administrator and the operations manager hold «admin.waqfs.edit»; management and other staff do not", () => {
    expect(ROLES.super_admin.permissions).toContain("admin.waqfs.edit");
    expect(ROLES.ops_manager.permissions).toContain("admin.waqfs.edit");
    for (const r of ["management", "system_admin", "employee", "nazara_officer", "consultant_sharia", "content_editor"]) expect(ROLES[r].permissions).not.toContain("admin.waqfs.edit");
  });
  it("staff editing a file get its data, never finance, distributions, beneficial owners or membership", () => {
    for (const p of ["waqf.edit", "deed.edit", "assets.edit", "beneficiaries.edit", "governance.manage", "documents.upload"]) expect(STAFF_WAQF_EDIT_PERMS).toContain(p);
    for (const p of ["finance.edit", "finance.approve", "distributions.approve", "bo.edit", "waqf.members.manage", "documents.view_secret"]) expect(STAFF_WAQF_EDIT_PERMS).not.toContain(p);
  });
  it("the founder keeps the file at every stage until a nazir or chair holds it (not only while establishing)", () => {
    for (const s of ["idea", "draft", "documenting", "documented", "registered", "active"]) expect(ESTABLISHING_STATUSES as readonly string[]).toContain(s);
    expect(ESTABLISHING_STATUSES as readonly string[]).not.toContain("ended");
    for (const p of FILE_CONTENT_PERMS) expect(ESTABLISHING_FOUNDER_PERMS).toContain(p);
    expect(ESTABLISHING_FOUNDER_PERMS).not.toContain("finance.edit");
  });
  it("the founder role alone (with a nazir on the platform) stays read-only on the file's data", () => {
    for (const p of FILE_CONTENT_PERMS) expect(ROLES.founder.permissions).not.toContain(p);
  });
});

describe("which changes go to review", () => {
  it("terms, masarif and beneficiaries, nazara and board, assets and identity are the file's substance", () => {
    expect(reviewSection("deed.condition_updated")).toBe("الوثيقة والشروط");
    expect(reviewSection("beneficiaries.class_added")).toBe("المصارف والمستحقون");
    expect(reviewSection("beneficiaries.updated")).toBe("المصارف والمستحقون");
    expect(reviewSection("waqf.trustee_updated")).toBe("الأطراف والنظارة");
    expect(reviewSection("waqf.body_member_added")).toBe("الأطراف والنظارة");
    expect(reviewSection("assets.added")).toBe("الأصول الموقوفة");
    expect(reviewSection("waqf.identity_updated")).toBe("الهوية والتسجيل");
  });
  it("operations, interpretations and meetings are not", () => {
    for (const a of ["assets.lease_added", "assets.valuation_added", "distribution.created", "governance.meeting_create", "deed.interpretation_added", "bo.added", "waqf.timeline_added"])
      expect(reviewSection(a)).toBeNull();
  });
  it("the reason names the approved output and says it is not changed", () => {
    const r = reviewReason("approved_output", ["OUT-000150 «مسودة وثيقة وقف للمراجعة قبل التوثيق» (REQ-000525)"]);
    expect(r).toContain("OUT-000150");
    expect(r).toContain("لم يتغير المخرج المعتمد");
  });
});
