/**
 * Pure governance rules (no I/O) — quorum, vote tally, minutes template and labels.
 * Sources: مبادئ حوكمة الأوقاف (المبدأ الرابع: فاعلية النظارة، والخامس: تعارض المصالح)،
 * لائحة تنظيم أعمال النظارة م14 (إدارة الوقف) و م18 (تعارض المصالح).
 */

export type QuorumRule = "majority" | "two_thirds" | "all";
export type MajorityRule = "simple" | "absolute" | "two_thirds";
export type VoteValue = "for" | "against" | "abstain" | "recused";

export type BoardSeat = {
  membershipId: string;
  userId: string | null;
  name: string;
  role: string; // chair | vice_chair | member | secretary | observer
  isIndependent: boolean;
  hasVote: boolean;
};

export type AttendanceStatus = "invited" | "present" | "apologized" | "absent" | "proxy";

export const isPresent = (s: string | null | undefined) => s === "present" || s === "proxy";

/** Number of voting members needed for a valid meeting under the waqf's quorum rule. */
export function quorumRequired(votingMembers: number, rule: QuorumRule): number {
  if (votingMembers <= 0) return 1;
  if (rule === "all") return votingMembers;
  if (rule === "two_thirds") return Math.ceil((2 * votingMembers) / 3);
  return Math.floor(votingMembers / 2) + 1;
}

export type QuorumResult = {
  required: number;
  presentVoting: number;
  votingMembers: number;
  independentPresent: number;
  needsIndependent: boolean;
  met: boolean;
  reasons: string[];
};

/**
 * Meeting quorum: voting members present (or by proxy) must reach the required count,
 * and — when the waqf's policy requires it — at least one independent member must be present.
 * `excludeUserIds` removes conflicted members (they are counted out of quorum for that agenda item).
 */
export function checkQuorum(
  seats: BoardSeat[],
  attendance: Map<string, string>, // membershipId → status
  opts: { rule: QuorumRule; requireIndependent: boolean; excludeUserIds?: Set<string> },
): QuorumResult {
  const voting = seats.filter((s) => s.hasVote);
  const required = quorumRequired(voting.length, opts.rule);
  const present = voting.filter((s) => isPresent(attendance.get(s.membershipId)) && !(s.userId && opts.excludeUserIds?.has(s.userId)));
  const independentPresent = present.filter((s) => s.isIndependent).length;
  const reasons: string[] = [];
  if (present.length < required) reasons.push(`حضر ${present.length} من الأعضاء المصوّتين والمطلوب ${required} على الأقل.`);
  if (opts.requireIndependent && independentPresent < 1) reasons.push("تشترط سياسة الوقف حضور عضو مستقل واحد على الأقل.");
  return { required, presentVoting: present.length, votingMembers: voting.length, independentPresent, needsIndependent: opts.requireIndependent, met: reasons.length === 0, reasons };
}

export type Tally = { for: number; against: number; abstain: number; recused: number };

export function tally(values: VoteValue[]): Tally {
  const t: Tally = { for: 0, against: 0, abstain: 0, recused: 0 };
  for (const v of values) t[v] += 1;
  return t;
}

export type Decision = { outcome: "approved" | "rejected"; casting: boolean; note: string };

/**
 * Decides a resolution.
 *  - simple:     for > against among votes cast (abstentions do not count either way)
 *  - absolute:   for > half of the eligible (present, non-conflicted) voters
 *  - two_thirds: for ≥ two-thirds of the eligible voters
 * A tie under the simple rule is settled by the chair's vote when the casting vote is enabled.
 */
export function decide(t: Tally, eligible: number, rule: MajorityRule, casting: { enabled: boolean; chairVote: VoteValue | null }): Decision {
  if (rule === "absolute") {
    const ok = t.for > eligible / 2;
    return { outcome: ok ? "approved" : "rejected", casting: false, note: `أغلبية مطلقة: ${t.for} من ${eligible}` };
  }
  if (rule === "two_thirds") {
    const ok = eligible > 0 && t.for * 3 >= eligible * 2;
    return { outcome: ok ? "approved" : "rejected", casting: false, note: `أغلبية الثلثين: ${t.for} من ${eligible}` };
  }
  if (t.for > t.against) return { outcome: "approved", casting: false, note: "أغلبية بسيطة" };
  if (t.for < t.against) return { outcome: "rejected", casting: false, note: "أغلبية بسيطة" };
  if (t.for === 0) return { outcome: "rejected", casting: false, note: "لم يصوّت أحد بالموافقة" };
  if (casting.enabled && (casting.chairVote === "for" || casting.chairVote === "against")) {
    return { outcome: casting.chairVote === "for" ? "approved" : "rejected", casting: true, note: "تعادلت الأصوات فرجح صوت الرئيس" };
  }
  return { outcome: "rejected", casting: false, note: "تعادلت الأصوات ولا صوت مرجّح، فلا يصدر القرار" };
}

// ───────────── Labels ─────────────

export const MEETING_KIND_AR: Record<string, string> = { regular: "عادي", extraordinary: "استثنائي", circulation: "بالتمرير" };
export const MEETING_STATUS_AR: Record<string, string> = { scheduled: "مجدول", held: "منعقد", cancelled: "ملغى" };
export const AGENDA_KIND_AR: Record<string, string> = { info: "للعلم", discussion: "للنقاش", decision: "للقرار" };
export const ATTENDANCE_AR: Record<string, string> = { invited: "مدعو", present: "حاضر", apologized: "اعتذر", absent: "غائب", proxy: "بالإنابة" };
export const ROLE_AR: Record<string, string> = { chair: "الرئيس", vice_chair: "نائب الرئيس", member: "عضو", secretary: "أمين السر", observer: "مراقب" };
export const VOTE_AR: Record<VoteValue, string> = { for: "موافق", against: "معارض", abstain: "ممتنع", recused: "مستبعد لتعارض المصالح" };
export const RESOLUTION_STATUS_AR: Record<string, string> = {
  draft: "قيد التصويت", approved: "معتمد", rejected: "مرفوض", deferred: "مؤجل", executed: "منفّذ", reviewed: "روجع أثره",
};
export const MINUTES_STATUS_AR: Record<string, string> = { draft: "مسودة", circulated: "قيد التوقيع", approved: "معتمد", locked: "مقفل" };
export const COI_KIND_AR: Record<string, string> = { none: "لا تعارض", actual: "تعارض فعلي", potential: "تعارض محتمل" };
export const RESOLUTION_CATEGORIES = ["investment", "distribution", "appointment", "policy", "asset_disposal", "budget", "other"] as const;
export const RESOLUTION_CATEGORY_AR: Record<string, string> = {
  investment: "استثمار", distribution: "صرف وتوزيع", appointment: "تعيين", policy: "سياسات ولوائح", asset_disposal: "تصرف في أصل", budget: "موازنة", other: "أخرى",
};

/**
 * The twelve supporting organizational requirements a nazir should adopt (الدليل المختصر لمهمات ومسؤوليات ناظر الوقف، ص19).
 * Stored in policies.policy_type.
 */
export const POLICY_TYPES = [
  ["governance_bylaw", "لائحة حوكمة داخلية للوقف"],
  ["authority_matrix", "مصفوفة صلاحيات"],
  ["conflict_of_interest", "سياسة تعارض مصالح"],
  ["distribution", "سياسة صرف"],
  ["investment", "سياسة استثمار"],
  ["financial_bylaw", "لائحة مالية"],
  ["complaints", "آلية تواصل وشكاوى"],
  ["beneficiary_register", "سجل للمستفيدين"],
  ["risk_register", "سجل للمخاطر"],
  ["maintenance_plan", "خطة صيانة دورية"],
  ["records_archiving", "خطة لحفظ الوثائق والأرشفة"],
  ["decisions_register", "سجل للقرارات والعقود والدعاوى"],
] as const;
export const POLICY_TYPE_AR: Record<string, string> = Object.fromEntries(POLICY_TYPES);
export const POLICY_STATUS_AR: Record<string, string> = { draft: "مسودة", approved: "معتمدة", superseded: "مستبدلة" };

// ───────────── Meeting number (stored as the title prefix until meetings gets a number column) ─────────────

const SEP = " · ";
export const composeMeetingTitle = (number: string, title: string) => `${number}${SEP}${title}`;
export function splitMeetingTitle(stored: string): { number: string | null; title: string } {
  const m = /^(MTG-\d+) · ([\s\S]*)$/.exec(stored);
  return m ? { number: m[1], title: m[2] } : { number: null, title: stored };
}

// ───────────── Minutes ─────────────

export type MinutesInput = {
  waqfName: string;
  meetingNumber: string | null;
  meetingTitle: string;
  kind: string;
  when: string; // formatted
  place: string;
  attendees: { name: string; role: string; status: string; independent: boolean }[];
  quorum: { required: number; present: number; met: boolean } | null;
  items: {
    position: number;
    title: string;
    kind: string;
    conflicts: string[]; // names of recused members
    resolution: { number: string; text: string; status: string; tally: Tally; note?: string | null } | null;
  }[];
};

/** Draft minutes (lightweight markdown) with decisions listed automatically from recorded votes. */
export function minutesTemplate(m: MinutesInput): string {
  const present = m.attendees.filter((a) => isPresent(a.status));
  const absent = m.attendees.filter((a) => !isPresent(a.status));
  const lines: string[] = [];
  lines.push(`# محضر اجتماع ${m.meetingTitle}`);
  lines.push("");
  lines.push(`**الوقف:** ${m.waqfName}  `);
  if (m.meetingNumber) lines.push(`**رقم الاجتماع:** ${m.meetingNumber}  `);
  lines.push(`**نوع الاجتماع:** ${MEETING_KIND_AR[m.kind] ?? m.kind}  `);
  lines.push(`**الموعد:** ${m.when}  `);
  lines.push(`**المكان:** ${m.place}`);
  lines.push("");
  lines.push("## الحضور");
  for (const a of present) lines.push(`- ${a.name} — ${ROLE_AR[a.role] ?? a.role}${a.independent ? " (مستقل)" : ""}${a.status === "proxy" ? " — بالإنابة" : ""}`);
  if (absent.length) {
    lines.push("");
    lines.push("**المعتذرون والغائبون:**");
    for (const a of absent) lines.push(`- ${a.name} — ${ATTENDANCE_AR[a.status] ?? a.status}`);
  }
  lines.push("");
  if (m.quorum) lines.push(m.quorum.met ? `اكتمل النصاب بحضور ${m.quorum.present} من الأعضاء المصوّتين (المطلوب ${m.quorum.required}).` : `لم يكتمل النصاب (${m.quorum.present} من ${m.quorum.required}).`);
  lines.push("");
  lines.push("## جدول الأعمال والمداولات");
  for (const it of m.items) {
    lines.push(`### ${it.position}. ${it.title}`);
    lines.push(`نوع البند: ${AGENDA_KIND_AR[it.kind] ?? it.kind}.`);
    if (it.conflicts.length) lines.push(`أفصح ${it.conflicts.join("، ")} عن تعارض مصالح في هذا البند، فاستُبعد من المداولة والتصويت ولم يُحسب في النصاب.`);
    lines.push("");
    lines.push("ملخص المداولة: ");
    lines.push("");
  }
  const decided = m.items.filter((i) => i.resolution);
  lines.push("## القرارات");
  if (!decided.length) lines.push("لم تصدر قرارات في هذا الاجتماع.");
  for (const it of decided) {
    const r = it.resolution!;
    lines.push(`- **${r.number}** (${RESOLUTION_STATUS_AR[r.status] ?? r.status}): ${r.text} — موافق ${r.tally.for}، معارض ${r.tally.against}، ممتنع ${r.tally.abstain}، مستبعد ${r.tally.recused}${r.note ? ` — ${r.note}` : ""}.`);
  }
  lines.push("");
  lines.push("وقّع الحاضرون على هذا المحضر إلكترونيًا بالموافقة الموثقة برمز التحقق، وحُفظت بصمة نصه.");
  return lines.join("\n");
}

// ───────────── Safe lightweight markdown (headings, bold, lists, paragraphs) ─────────────

export type MdBlock =
  | { t: "h"; level: 1 | 2 | 3; text: string }
  | { t: "p"; text: string }
  | { t: "ul"; items: string[] };

export function parseMd(src: string): MdBlock[] {
  const out: MdBlock[] = [];
  let para: string[] = [];
  let list: string[] | null = null;
  const flushPara = () => {
    if (para.length) out.push({ t: "p", text: para.join("\n") });
    para = [];
  };
  const flushList = () => {
    if (list) out.push({ t: "ul", items: list });
    list = null;
  };
  for (const raw of src.replace(/\r\n/g, "\n").split("\n")) {
    const line = raw.replace(/\s+$/, "");
    const h = /^(#{1,3})\s+(.*)$/.exec(line);
    const li = /^\s*[-*]\s+(.*)$/.exec(line);
    if (h) {
      flushPara();
      flushList();
      out.push({ t: "h", level: h[1].length as 1 | 2 | 3, text: h[2] });
    } else if (li) {
      flushPara();
      (list ??= []).push(li[1]);
    } else if (!line.trim()) {
      flushPara();
      flushList();
    } else {
      flushList();
      para.push(line);
    }
  }
  flushPara();
  flushList();
  return out;
}

/** Splits text into plain/bold runs for `**bold**`. */
export function inlineRuns(text: string): { bold: boolean; text: string }[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g).filter(Boolean);
  return parts.map((p) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? { bold: true, text: p.slice(2, -2) } : { bold: false, text: p }));
}

// ───────────── Board composition ─────────────

export function independenceSummary(seats: BoardSeat[], target: number | null) {
  const voting = seats.filter((s) => s.hasVote);
  const independent = voting.filter((s) => s.isIndependent).length;
  const ratio = voting.length ? independent / voting.length : 0;
  const t = target ?? 1 / 3;
  return { voting: voting.length, independent, ratio, target: t, meetsTarget: voting.length > 0 && ratio + 1e-9 >= t };
}
