/**
 * Demo governance, tasks and beneficiary-portal data (fictional, marked "(تجريبي)"). Run by seed-demo after the core
 * data, or directly:  npx tsx --conditions=react-server scripts/demo/40-governance.ts
 * Idempotent: skips what already exists.
 *
 * Waqf C (board-run): governance profile (majority quorum incl. an independent member), board body mirroring the
 * board memberships, the 12 supporting policies (two missing, one review overdue), a past held meeting with locked
 * minutes signed by all attendees, two resolutions, one execution task, and a board performance review.
 * Waqf B: a paid 2025 distribution (lines for all four beneficiaries; the portal shows each beneficiary only theirs)
 * and one answered inquiry from the demo beneficiary.
 */
import "../jobs/_shim";
import "dotenv/config";
import { readFileSync } from "node:fs";
import { and, eq, isNull } from "drizzle-orm";
import { withSystem, type Tx } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import { nextNumber } from "../../src/server/lib/audit";
import { sha256 } from "../../src/server/lib/crypto";
import { composeMeetingTitle, minutesTemplate } from "../../src/server/modules/governance/pure";

type Ctx = { users: Record<string, string>; waqfs: { A: string; B: string; C: string } };

async function governanceC(tx: Tx, ctx: Ctx) {
  const C = ctx.waqfs.C;
  const u = ctx.users;
  const [prof] = await tx.select().from(s.waqfGovernanceProfiles).where(eq(s.waqfGovernanceProfiles.waqfId, C)).limit(1);
  if (!prof) {
    await tx.insert(s.waqfGovernanceProfiles).values({ waqfId: C, quorumRule: "majority", majorityRule: "simple", meetingsPerYear: 4, independentRatioTarget: "0.33", requireIndependentForQuorum: true, createdBy: u.admin });
  }

  let [body] = await tx.select().from(s.bodies).where(and(eq(s.bodies.waqfId, C), eq(s.bodies.kind, "board"))).limit(1);
  if (!body) {
    [body] = await tx.insert(s.bodies).values({ waqfId: C, kind: "board", name: "مجلس النظارة (تجريبي)", charter: "يتكون المجلس من ثلاثة أعضاء مصوّتين أحدهم مستقل، وأمين سر بلا صوت.", createdBy: u.admin }).returning();
  }
  const seats = [
    { key: "chair", name: "رئيس مجلس تجريبي — فهد", role: "chair", isIndependent: false, hasVote: true },
    { key: "member1", name: "عضو مجلس تجريبي — نورة", role: "member", isIndependent: false, hasVote: true },
    { key: "member2", name: "عضو مستقل تجريبي — خالد", role: "member", isIndependent: true, hasVote: true },
    { key: "secretary", name: "أمين سر تجريبي — هند", role: "secretary", isIndependent: false, hasVote: false },
  ];
  const bm = new Map<string, string>();
  for (const st of seats) {
    const [ex] = await tx.select({ id: s.bodyMemberships.id }).from(s.bodyMemberships).where(and(eq(s.bodyMemberships.bodyId, body.id), eq(s.bodyMemberships.userId, u[st.key]), isNull(s.bodyMemberships.endsOn))).limit(1);
    if (ex) bm.set(st.key, ex.id);
    else {
      const [r] = await tx.insert(s.bodyMemberships).values({ bodyId: body.id, waqfId: C, userId: u[st.key], personName: st.name, role: st.role, isIndependent: st.isIndependent, hasVote: st.hasVote, startsOn: "2025-01-01", createdBy: u.admin }).returning({ id: s.bodyMemberships.id });
      bm.set(st.key, r.id);
    }
  }

  // Past meeting with locked minutes
  const [past] = await tx.select({ id: s.meetings.id }).from(s.meetings).where(and(eq(s.meetings.waqfId, C), eq(s.meetings.status, "held"))).limit(1);
  const resIds: string[] = [];
  if (!past) {
    const number = await nextNumber(tx, "MTG");
    const title = "الاجتماع الدوري الثاني لعام 2026 (تجريبي)";
    const heldAt = new Date("2026-06-15T10:00:00+03:00");
    const [m] = await tx.insert(s.meetings).values({
      waqfId: C, bodyId: body.id, kind: "regular", title: composeMeetingTitle(number, title), scheduledAt: heldAt, location: "مقر الوقف — الرياض (تجريبي)",
      status: "held", invitationsSentAt: new Date("2026-06-01T09:00:00+03:00"), quorumRequired: 2, quorumMet: true, heldAt, createdBy: u.secretary,
    }).returning({ id: s.meetings.id });
    await tx.insert(s.attendance).values(seats.map((st) => ({ meetingId: m.id, bodyMembershipId: bm.get(st.key)!, waqfId: C, status: "present", mode: "in_person", recordedAt: heldAt })));
    const items = [
      { title: "اعتماد الموازنة التقديرية للنصف الثاني", text: "اعتماد الموازنة التقديرية للنصف الثاني من عام 2026 كما عرضتها الإدارة التنفيذية.", category: "budget" },
      { title: "تجديد عقد صيانة المستوصف الوقفي", text: "تجديد عقد الصيانة الوقائية للمستوصف الوقفي لمدة سنة بعد المقارنة بين ثلاثة عروض.", category: "asset_disposal" },
    ];
    const resolved: { number: string; text: string; status: string; tally: { for: number; against: number; abstain: number; recused: number } }[] = [];
    for (const [i, it] of items.entries()) {
      const [a] = await tx.insert(s.agendaItems).values({ meetingId: m.id, waqfId: C, position: i + 1, title: it.title, kind: "decision", createdBy: u.secretary }).returning({ id: s.agendaItems.id });
      const conflicted = i === 1 ? "member1" : null;
      for (const k of ["chair", "member1", "member2", "secretary"]) {
        await tx.insert(s.conflictDeclarations).values({ waqfId: C, userId: u[k], meetingId: m.id, agendaItemId: a.id, kind: k === conflicted ? "potential" : "none", action: k === conflicted ? "recuse" : "none", description: k === conflicted ? "قريب من الدرجة الثانية يعمل لدى أحد مقدمي العروض (تجريبي)" : null, relationDegree: k === conflicted ? 2 : null, year: 2026, declaredAt: heldAt });
      }
      const rn = await nextNumber(tx, "RES");
      const tally = conflicted ? { for: 2, against: 0, abstain: 0, recused: 1 } : { for: 2, against: 0, abstain: 1, recused: 0 };
      const [r] = await tx.insert(s.resolutions).values({
        waqfId: C, meetingId: m.id, agendaItemId: a.id, number: rn, text: it.text, category: it.category, status: "approved",
        votesFor: tally.for, votesAgainst: tally.against, votesAbstain: tally.abstain, votesRecused: tally.recused, decidedAt: heldAt, reviewNote: "أغلبية بسيطة", createdBy: u.secretary,
      }).returning({ id: s.resolutions.id });
      resIds.push(r.id);
      const v = conflicted
        ? [["chair", "for"], ["member2", "for"], ["member1", "recused"]]
        : [["chair", "for"], ["member1", "for"], ["member2", "abstain"]];
      await tx.insert(s.votes).values(v.map(([k, val]) => ({ resolutionId: r.id, userId: u[k], waqfId: C, value: val as "for", castAt: heldAt })));
      resolved.push({ number: rn, text: it.text, status: "approved", tally });
    }
    const minutesBody = minutesTemplate({
      waqfName: "وقف الإحسان الصحي (تجريبي)", meetingNumber: number, meetingTitle: title, kind: "regular", when: "15 يونيو 2026، 10:00 ص", place: "مقر الوقف — الرياض (تجريبي)",
      attendees: seats.map((st) => ({ name: st.name, role: st.role, status: "present", independent: st.isIndependent })),
      quorum: { required: 2, present: 3, met: true },
      items: items.map((it, i) => ({ position: i + 1, title: it.title, kind: "decision", conflicts: i === 1 ? ["عضو مجلس تجريبي — نورة"] : [], resolution: resolved[i] })),
    }).replace(/ملخص المداولة: \n/g, "ملخص المداولة: عرضت الإدارة التنفيذية البند وناقشه الأعضاء (نص تجريبي).\n");
    const hash = sha256(minutesBody);
    const [mn] = await tx.insert(s.minutes).values({ meetingId: m.id, waqfId: C, body: minutesBody, status: "circulated", preparedBy: u.secretary, circulatedAt: new Date("2026-06-16T09:00:00+03:00"), contentHash: hash, createdBy: u.secretary }).returning({ id: s.minutes.id });
    await tx.insert(s.minuteSignatures).values(seats.map((st) => ({ minuteId: mn.id, userId: u[st.key], waqfId: C, contentHash: hash, signedAt: new Date("2026-06-17T12:00:00+03:00") })));
    await tx.update(s.minutes).set({ status: "locked", lockedAt: new Date("2026-06-18T09:00:00+03:00"), approvedAt: new Date("2026-06-18T09:00:00+03:00") }).where(eq(s.minutes.id, mn.id));
    const tn = await nextNumber(tx, "TSK");
    await tx.insert(s.tasks).values({
      waqfId: C, sourceType: "resolution", sourceId: resIds[1], title: "توقيع عقد الصيانة مع المورد المختار (تجريبي)", description: `${tn} — تنفيذ القرار ${resolved[1].number}`,
      assigneeUserId: u.secretary, dueOn: "2026-09-30", priority: "high", status: "in_progress", progress: 50, visibility: "shared",
      checklist: [{ text: "مراجعة مسودة العقد قانونيًا", done: true }, { text: "توقيع العقد", done: false }], createdBy: u.chair,
    });
  }

  // Policies (12 supporting requirements; two missing, one overdue for review)
  const [anyPol] = await tx.select({ id: s.policies.id }).from(s.policies).where(eq(s.policies.waqfId, C)).limit(1);
  if (!anyPol) {
    const rows: [string, string, string, string | null, string | null][] = [
      ["governance_bylaw", "لائحة الحوكمة الداخلية (تجريبي)", "approved", "2025-03-10", "2027-03-10"],
      ["authority_matrix", "مصفوفة الصلاحيات (تجريبي)", "approved", "2025-03-10", "2027-03-10"],
      ["conflict_of_interest", "سياسة تعارض المصالح (تجريبي)", "approved", "2025-03-10", "2026-09-30"],
      ["distribution", "سياسة الصرف (تجريبي)", "approved", "2025-06-01", "2026-12-01"],
      ["investment", "سياسة الاستثمار (تجريبي)", "approved", "2025-06-01", "2027-06-01"],
      ["financial_bylaw", "اللائحة المالية (تجريبي)", "approved", "2024-12-15", "2026-10-30"],
      ["complaints", "آلية التواصل والشكاوى (تجريبي)", "approved", "2025-09-01", "2027-09-01"],
      ["beneficiary_register", "سجل المستفيدين (تجريبي)", "approved", "2025-01-20", "2027-01-20"],
      ["risk_register", "سجل المخاطر (تجريبي)", "approved", "2025-01-20", "2026-12-20"],
      ["maintenance_plan", "خطة الصيانة الدورية (تجريبي)", "draft", null, null],
    ];
    await tx.insert(s.policies).values(rows.map(([policyType, title, status, approvedOn, reviewDue]) => ({ waqfId: C, policyType, title, status, approvedOn, reviewDue, createdBy: u.secretary })));
  }

  const [anyRev] = await tx.select({ id: s.performanceReviews.id }).from(s.performanceReviews).where(eq(s.performanceReviews.waqfId, C)).limit(1);
  if (!anyRev) {
    await tx.insert(s.performanceReviews).values([
      { waqfId: C, subjectType: "board", subjectName: "مجلس النظارة (تجريبي)", year: 2025, score: "82.50", notes: "انتظام الاجتماعات واكتمال المحاضر؛ يوصى بتسريع مراجعة السياسات (تجريبي).", createdBy: u.chair },
    ]);
  }
}

async function beneficiaryB(tx: Tx, ctx: Ctx) {
  const B = ctx.waqfs.B;
  const bens = await tx.select({ id: s.beneficiaries.id, userId: s.beneficiaries.userId }).from(s.beneficiaries).where(eq(s.beneficiaries.waqfId, B));
  if (!bens.length) return;
  const [dist] = await tx.select({ id: s.distributions.id }).from(s.distributions).where(and(eq(s.distributions.waqfId, B), eq(s.distributions.period, "2025"))).limit(1);
  if (!dist) {
    const [d] = await tx.insert(s.distributions).values({ waqfId: B, period: "2025", totalAmount: String(21500 * bens.length), status: "paid", dueBy: "2026-02-15", paidOn: "2026-02-12", createdBy: ctx.users.waqif }).returning({ id: s.distributions.id });
    await tx.insert(s.distributionLines).values(bens.map((b, i) => ({ distributionId: d.id, waqfId: B, beneficiaryId: b.id, amount: "21500", referenceNo: `DEMO-TRF-2025-${String(i + 1).padStart(3, "0")}`, status: "paid", paidOn: "2026-02-12", createdBy: ctx.users.waqif })));
  }
  const me = ctx.users.beneficiary;
  const [prev] = await tx.select({ id: s.complaints.id }).from(s.complaints).where(and(eq(s.complaints.waqfId, B), eq(s.complaints.raisedByUserId, me))).limit(1);
  if (!prev && bens.some((b) => b.userId === me)) {
    await tx.insert(s.complaints).values({
      waqfId: B, number: await nextNumber(tx, "CMP"), raisedByUserId: me, beneficiaryId: bens.find((b) => b.userId === me)!.id, kind: "inquiry",
      subject: "موعد صرف غلة 2025 (تجريبي)", body: "متى يُصرف نصيبي من غلة عام 2025؟ (نص تجريبي)", status: "closed",
      slaDueAt: new Date("2026-01-29T23:59:59+03:00"), response: "يُصرف في منتصف فبراير 2026 بعد اعتماد القوائم المالية (رد تجريبي).",
      respondedAt: new Date("2026-01-20T11:00:00+03:00"), respondedBy: ctx.users.waqif, createdAt: new Date("2026-01-15T09:00:00+03:00"), createdBy: me,
    });
  }
}

export default async function demoGovernance(tx: Tx, ctx: Ctx) {
  await governanceC(tx, ctx);
  await beneficiaryB(tx, ctx);
}

// Direct run: reads the demo context from storage/demo-credentials.json.
if (process.argv[1]?.includes("40-governance")) {
  const creds = JSON.parse(readFileSync("storage/demo-credentials.json", "utf8")) as { waqfs: Ctx["waqfs"]; users: Record<string, { id: string }> };
  const ctx: Ctx = { waqfs: creds.waqfs, users: Object.fromEntries(Object.entries(creds.users).map(([k, v]) => [k, v.id])) };
  withSystem((tx) => demoGovernance(tx, ctx)).then(
    () => {
      console.log("✓ demo governance data");
      process.exit(0);
    },
    (e) => {
      console.error(e);
      process.exit(1);
    },
  );
}
