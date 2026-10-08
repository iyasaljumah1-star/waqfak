import "dotenv/config";
import { describe, expect, it } from "vitest";
import { Client } from "pg";
import {
  checkQuorum, composeMeetingTitle, decide, independenceSummary, inlineRuns, minutesTemplate, parseMd, quorumRequired, splitMeetingTitle, tally,
  type BoardSeat,
} from "../src/server/modules/governance/pure";
import { canSeeTask, computeProgress, dueBucket, isOverdue, sanitizeChecklist } from "../src/server/modules/tasks/pure";
import { slaDueDate, slaState } from "../src/server/modules/complaints/pure";

const seat = (id: string, o: Partial<BoardSeat> = {}): BoardSeat => ({ membershipId: id, userId: `u-${id}`, name: id, role: "member", isIndependent: false, hasVote: true, ...o });
// Board of waqf C (demo): chair, member1, member2 (independent), secretary (no vote)
const board = [seat("chair", { role: "chair" }), seat("m1"), seat("m2", { isIndependent: true }), seat("sec", { role: "secretary", hasVote: false })];
const att = (present: string[]) => new Map(board.map((s) => [s.membershipId, present.includes(s.membershipId) ? "present" : "absent"]));

describe("quorum", () => {
  it("computes the required count per rule", () => {
    expect(quorumRequired(3, "majority")).toBe(2);
    expect(quorumRequired(4, "majority")).toBe(3);
    expect(quorumRequired(5, "two_thirds")).toBe(4);
    expect(quorumRequired(3, "all")).toBe(3);
  });

  it("counts only voting members (the secretary does not make quorum)", () => {
    const q = checkQuorum(board, att(["chair", "sec"]), { rule: "majority", requireIndependent: false });
    expect(q.votingMembers).toBe(3);
    expect(q.presentVoting).toBe(1);
    expect(q.met).toBe(false);
  });

  it("requires an independent member when the policy says so", () => {
    const noInd = checkQuorum(board, att(["chair", "m1"]), { rule: "majority", requireIndependent: true });
    expect(noInd.met).toBe(false);
    expect(noInd.reasons.join(" ")).toMatch(/مستقل/);
    expect(checkQuorum(board, att(["chair", "m1", "m2"]), { rule: "majority", requireIndependent: true }).met).toBe(true);
  });

  it("counts conflicted members out of quorum for that item", () => {
    const all = att(["chair", "m1", "m2"]);
    expect(checkQuorum(board, all, { rule: "majority", requireIndependent: false, excludeUserIds: new Set(["u-m1"]) }).met).toBe(true);
    expect(checkQuorum(board, all, { rule: "majority", requireIndependent: false, excludeUserIds: new Set(["u-m1", "u-chair"]) }).met).toBe(false);
    expect(checkQuorum(board, all, { rule: "majority", requireIndependent: true, excludeUserIds: new Set(["u-m2"]) }).met).toBe(false);
  });

  it("treats proxy attendance as present", () => {
    const m = new Map([["chair", "present"], ["m1", "proxy"], ["m2", "apologized"], ["sec", "present"]]);
    expect(checkQuorum(board, m, { rule: "majority", requireIndependent: false }).presentVoting).toBe(2);
  });
});

describe("vote decision", () => {
  it("simple majority ignores abstentions", () => {
    expect(decide(tally(["for", "abstain", "abstain"]), 3, "simple", { enabled: true, chairVote: "for" }).outcome).toBe("approved");
    expect(decide(tally(["for", "against", "against"]), 3, "simple", { enabled: true, chairVote: "for" }).outcome).toBe("rejected");
  });

  it("the chair's casting vote settles a tie when enabled", () => {
    const t = tally(["for", "against", "abstain"]);
    const d = decide(t, 3, "simple", { enabled: true, chairVote: "for" });
    expect(d).toMatchObject({ outcome: "approved", casting: true });
    expect(decide(t, 3, "simple", { enabled: true, chairVote: "against" }).outcome).toBe("rejected");
    expect(decide(t, 3, "simple", { enabled: false, chairVote: "for" })).toMatchObject({ outcome: "rejected", casting: false });
    expect(decide(t, 3, "simple", { enabled: true, chairVote: "abstain" }).outcome).toBe("rejected");
  });

  it("recused votes are counted separately and never as for/against", () => {
    const t = tally(["for", "for", "recused"]);
    expect(t).toEqual({ for: 2, against: 0, abstain: 0, recused: 1 });
    expect(decide(t, 2, "absolute", { enabled: false, chairVote: null }).outcome).toBe("approved");
  });

  it("absolute and two-thirds rules use the eligible voters", () => {
    expect(decide(tally(["for", "abstain", "abstain"]), 3, "absolute", { enabled: true, chairVote: "for" }).outcome).toBe("rejected");
    expect(decide(tally(["for", "for", "against"]), 3, "two_thirds", { enabled: true, chairVote: "for" }).outcome).toBe("approved");
    expect(decide(tally(["for", "for", "against", "against"]), 4, "two_thirds", { enabled: true, chairVote: "for" }).outcome).toBe("rejected");
  });

  it("no votes for → rejected", () => {
    expect(decide(tally([]), 3, "simple", { enabled: true, chairVote: null }).outcome).toBe("rejected");
  });
});

describe("meeting number & minutes", () => {
  it("round-trips the meeting number stored in the title", () => {
    const s = composeMeetingTitle("MTG-000012", "الاجتماع · الرابع");
    expect(splitMeetingTitle(s)).toEqual({ number: "MTG-000012", title: "الاجتماع · الرابع" });
    expect(splitMeetingTitle("بدون رقم")).toEqual({ number: null, title: "بدون رقم" });
  });

  it("lists decisions and recusals automatically", () => {
    const body = minutesTemplate({
      waqfName: "وقف (تجريبي)", meetingNumber: "MTG-000001", meetingTitle: "اجتماع", kind: "regular", when: "اليوم", place: "المقر",
      attendees: [{ name: "فهد", role: "chair", status: "present", independent: false }, { name: "نورة", role: "member", status: "present", independent: false }, { name: "هند", role: "secretary", status: "apologized", independent: false }],
      quorum: { required: 2, present: 2, met: true },
      items: [
        { position: 1, title: "بند أول", kind: "decision", conflicts: ["نورة"], resolution: { number: "RES-000001", text: "اعتماد", status: "approved", tally: { for: 1, against: 0, abstain: 0, recused: 1 } } },
        { position: 2, title: "بند ثانٍ", kind: "info", conflicts: [], resolution: null },
      ],
    });
    expect(body).toContain("RES-000001");
    expect(body).toContain("مستبعد 1");
    expect(body).toMatch(/أفصح نورة عن تعارض/);
    expect(body).toMatch(/هند — اعتذر/);
    expect(body).toContain("ملخص المداولة:");
  });

  it("parses the safe markdown subset without HTML", () => {
    const b = parseMd("# عنوان\n\nفقرة **عريض**\n- أ\n- ب\n<script>x</script>");
    expect(b[0]).toEqual({ t: "h", level: 1, text: "عنوان" });
    expect(b.find((x) => x.t === "ul")).toEqual({ t: "ul", items: ["أ", "ب"] });
    expect(b.at(-1)).toEqual({ t: "p", text: "<script>x</script>" }); // rendered as text by React, never as HTML
    expect(inlineRuns("أ **ب** ج")).toEqual([{ bold: false, text: "أ " }, { bold: true, text: "ب" }, { bold: false, text: " ج" }]);
  });

  it("summarises independence against the target", () => {
    const s = independenceSummary(board, 1 / 3);
    expect(s).toMatchObject({ voting: 3, independent: 1, meetsTarget: true });
    expect(independenceSummary(board, 0.5).meetsTarget).toBe(false);
  });
});

describe("tasks", () => {
  it("derives progress from the checklist", () => {
    expect(computeProgress("in_progress", [{ text: "a", done: true }, { text: "b", done: false }])).toBe(50);
    expect(computeProgress("done", [{ text: "a", done: false }])).toBe(100);
    expect(computeProgress("todo", [], 40)).toBe(0);
    expect(computeProgress("in_progress", [], 140)).toBe(99);
  });

  it("flags overdue open tasks only", () => {
    expect(isOverdue("2026-10-01", "todo", "2026-10-07")).toBe(true);
    expect(isOverdue("2026-10-01", "done", "2026-10-07")).toBe(false);
    expect(isOverdue(null, "todo", "2026-10-07")).toBe(false);
    expect(dueBucket("2026-10-10", "todo", "2026-10-07")).toBe("week");
    expect(dueBucket("2026-11-10", "in_progress", "2026-10-07")).toBe("later");
  });

  it("hides internal tasks from client members", () => {
    const t = { visibility: "internal", createdBy: "staff", assigneeUserId: "x" };
    expect(canSeeTask(t, { id: "client", isStaff: false })).toBe(false);
    expect(canSeeTask(t, { id: "x", isStaff: false })).toBe(true);
    expect(canSeeTask(t, { id: "other-staff", isStaff: true })).toBe(true);
    expect(canSeeTask({ ...t, visibility: "shared" }, { id: "client", isStaff: false })).toBe(true);
  });

  it("sanitises checklist json", () => {
    expect(sanitizeChecklist([{ text: " a ", done: true }, { text: "" }, null, "x"])).toEqual([{ text: "a", done: true }]);
  });
});

describe("complaint SLA (business days)", () => {
  it("skips Friday/Saturday and holidays", () => {
    // 2026-10-07 is a Wednesday → 10 business days (Thu 8, Sun 11 … Wed 21)
    expect(slaDueDate("2026-10-07", 10, new Set())).toBe("2026-10-21");
    expect(slaDueDate("2026-10-07", 10, new Set(["2026-10-11"]))).toBe("2026-10-22");
    expect(slaDueDate("2026-10-08", 1, new Set())).toBe("2026-10-11"); // Thu → Sun
  });

  it("reports SLA state", () => {
    const now = new Date("2026-10-07T10:00:00Z");
    expect(slaState(new Date("2026-10-06T10:00:00Z"), "open", now)).toBe("overdue");
    expect(slaState(new Date("2026-10-06T10:00:00Z"), "answered", now)).toBe("met");
    expect(slaState(new Date("2026-10-08T10:00:00Z"), "open", now)).toBe("due_soon");
    expect(slaState(new Date("2026-10-20T10:00:00Z"), "in_progress", now)).toBe("on_track");
  });
});

// The DB trigger (security.sql: protect_locked_minutes) is the last line of defence for locked minutes.
const dbUrl = process.env.DATABASE_OWNER_URL ?? process.env.DATABASE_URL;
describe.skipIf(!dbUrl)("locked minutes trigger", () => {
  it("rejects updates and deletes once minutes are locked", async () => {
    const c = new Client({ connectionString: dbUrl });
    await c.connect();
    try {
      await c.query("begin");
      await c.query("select set_config('app.global_access','on',true)");
      const w = await c.query("insert into waqfs (internal_number, name, is_demo) values ('WQF-TEST-LOCK', 'اختبار (تجريبي)', true) returning id");
      const wid = w.rows[0].id;
      const m = await c.query("insert into meetings (waqf_id, title, scheduled_at) values ($1, 'MTG-T · اختبار', now()) returning id", [wid]);
      const mn = await c.query("insert into minutes (meeting_id, waqf_id, body) values ($1, $2, 'نص') returning id", [m.rows[0].id, wid]);
      const id = mn.rows[0].id;
      await c.query("update minutes set status = 'locked', locked_at = now() where id = $1", [id]); // locking itself is allowed
      await c.query("savepoint s1");
      await expect(c.query("update minutes set body = 'تعديل' where id = $1", [id])).rejects.toThrow(/minutes are locked/);
      await c.query("rollback to savepoint s1");
      await expect(c.query("delete from minutes where id = $1", [id])).rejects.toThrow(/minutes are locked/);
    } finally {
      await c.query("rollback").catch(() => undefined);
      await c.end();
    }
  });
});
