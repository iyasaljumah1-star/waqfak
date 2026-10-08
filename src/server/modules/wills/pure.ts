/**
 * Waqf bequest (وصية بالوقف) planner — pure math and the indicative will text.
 * Rule: a bequest (including a waqf suspended on death) binds only within one third of the estate after debts;
 * any excess, and any bequest to an heir, depends on the heirs' consent after death
 * (100 سؤال وجواب إرشادي في الأوقاف س16 وس77؛ نظام المعاملات المدنية م646–647: التصرف في مرض الموت يأخذ حكم الوصية).
 */

export type EstateItem = { kind: string; description: string; value: string };
export type WillPlan = {
  v: 1;
  kind: "will";
  testatorName: string;
  estate: EstateItem[];
  debts: string;
  bequestMode: "pct" | "amount";
  bequestPct: string;
  bequestAmount: string;
  bequestToHeir: string; // "on" when part of the bequest goes to an heir
  heirsCount: string;
  heirsConsentNote: string;
  masraf: string;
  nazirName: string;
  executorName: string;
  conditions: string;
  draftText?: string | null;
};

export const ESTATE_KIND_LABEL: Record<string, string> = { real_estate: "عقار", cash: "نقد وودائع", shares: "أسهم وصناديق", business: "حصص في شركات", movable: "منقولات", other: "أخرى" };

export function emptyPlan(name = ""): WillPlan {
  return { v: 1, kind: "will", testatorName: name, estate: [], debts: "", bequestMode: "pct", bequestPct: "", bequestAmount: "", bequestToHeir: "off", heirsCount: "", heirsConsentNote: "", masraf: "", nazirName: "", executorName: "", conditions: "" };
}

export function normalizePlan(raw: unknown, name = ""): WillPlan {
  const e = emptyPlan(name);
  if (!raw || typeof raw !== "object") return e;
  const r = raw as Partial<WillPlan>;
  return { ...e, ...r, v: 1, kind: "will", estate: Array.isArray(r.estate) ? r.estate : [] };
}

const num = (v: string | number | null | undefined) => Number(String(v ?? "").replace(/,/g, "")) || 0;
const round2 = (x: number) => Math.round(x * 100) / 100;

export type BequestCheck = {
  gross: number;
  debts: number;
  net: number;
  third: number;
  bequest: number;
  bequestPctOfNet: number;
  exceedsThird: boolean;
  excess: number;
  needsHeirConsent: boolean;
  notes: string[];
};

export function bequestCheck(p: Pick<WillPlan, "estate" | "debts" | "bequestMode" | "bequestPct" | "bequestAmount" | "bequestToHeir">): BequestCheck {
  const gross = round2(p.estate.reduce((s, i) => s + num(i.value), 0));
  const debts = round2(num(p.debts));
  const net = round2(Math.max(0, gross - debts));
  const third = round2(net / 3);
  const bequest = round2(p.bequestMode === "pct" ? (net * Math.min(100, num(p.bequestPct))) / 100 : num(p.bequestAmount));
  const bequestPctOfNet = net > 0 ? round2((bequest / net) * 100) : 0;
  const exceedsThird = bequest - third > 0.005;
  const excess = exceedsThird ? round2(bequest - third) : 0;
  const toHeir = p.bequestToHeir === "on";
  const notes: string[] = [];
  if (debts > gross) notes.push("الديون تستغرق التركة: تُقضى الديون أولًا ولا تنفذ الوصية إلا فيما يبقى بعدها.");
  if (exceedsThird) notes.push(`الوصية تزيد على ثلث صافي التركة بمقدار ${excess.toLocaleString("en-US")} ريال؛ لا تنفذ الزيادة إلا بإجازة الورثة البالغين الراشدين بعد الوفاة.`);
  if (toHeir) notes.push("الوصية لوارث لا تنفذ إلا بإجازة بقية الورثة بعد الوفاة، ولو كانت دون الثلث.");
  if (!exceedsThird && !toHeir && net > 0 && bequest > 0) notes.push("الوصية في حدود الثلث، فتنفذ دون حاجة إلى إجازة الورثة.");
  notes.push("قيم التركة تقديرية اليوم؛ العبرة بقيمتها وقت الوفاة، فراجع الخطة كلما تغيرت أصولك.");
  return { gross, debts, net, third, bequest, bequestPctOfNet, exceedsThird, excess, needsHeirConsent: exceedsThird || toHeir, notes };
}

const sar = (v: number) => `${new Intl.NumberFormat("ar-SA-u-nu-latn").format(v)} ريال`;

/** Indicative will text. Always shown with a label that it needs Sharia and legal review before notarization. */
export function buildWillDraft(p: WillPlan, today: string): string {
  const c = bequestCheck(p);
  const name = p.testatorName.trim() || "(اسم الموصي)";
  const share = p.bequestMode === "pct" ? `${num(p.bequestPct)}% من صافي تركتي` : `مبلغ ${sar(num(p.bequestAmount))} من تركتي`;
  const lines: string[] = [];
  lines.push("## المقدمة");
  lines.push(`الحمد لله وحده. أنا ${name}، وأنا بكامل أهليتي المعتبرة شرعًا ونظامًا، أوصي بما يأتي، وهذه الوصية تلغي كل وصية سابقة لها.`);
  lines.push("## الوصية بالوقف");
  lines.push(`أوصي بأن يُوقف بعد وفاتي ${share}${c.exceedsThird ? "، فإن زاد ذلك على ثلث التركة فلا ينفذ الزائد إلا بإجازة الورثة" : ""}، وقفًا مؤبدًا تُصرف غلته على ${p.masraf.trim() || "(المصرف الذي يحدده الموصي)"}.`);
  if (p.conditions.trim()) lines.push(`ويشترط الموصي في هذا الوقف: ${p.conditions.trim()}`);
  lines.push("## النظارة والتنفيذ");
  lines.push(`يتولى النظارة على الوقف ${p.nazirName.trim() || "(اسم الناظر)"}، ويتولى تنفيذ هذه الوصية ${p.executorName.trim() || "(اسم الوصي المنفذ)"}، وعليه إثبات الوقف وتوثيقه وتسجيله لدى الجهات المختصة بعد الوفاة.`);
  lines.push("## الخاتمة");
  lines.push(`تُقضى ديوني أولًا من تركتي، ثم تُنفذ هذه الوصية في حدود الثلث، وما زاد يتوقف على إجازة الورثة. ولي الرجوع عن هذه الوصية أو تعديلها ما دمت حيًا.\nحُررت هذه المسودة في ${today}.`);
  return lines.join("\n\n");
}
