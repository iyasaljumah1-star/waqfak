/**
 * Demo data for the waqf file (fictional, marked "(تجريبي)"): deed & conditions, parties, beneficiary classes,
 * beneficial owners (encrypted), assets with leases/valuations, bank accounts, budget, journal and statements.
 * Run by seed-demo after the core data, or directly:
 *   npx tsx --conditions=react-server scripts/demo/30-waqf-file.ts
 * Idempotent: skips a waqf whose deed record already exists.
 */
import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { withSystem, type Tx } from "../../src/server/db";
import * as s from "../../src/server/db/schema";
import { encryptString, lookupHash } from "../../src/server/lib/crypto";

type Ctx = { users: Record<string, string>; waqfs: { A: string; B: string; C: string } };

const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date()).slice(0, 4));
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (n: number) => iso(new Date(Date.now() + n * 86_400_000));

async function hasDeed(tx: Tx, waqfId: string) {
  const [d] = await tx.select({ id: s.waqfDeeds.id }).from(s.waqfDeeds).where(eq(s.waqfDeeds.waqfId, waqfId)).limit(1);
  return !!d;
}

async function waqfA(tx: Tx, w: string, by: string) {
  const [deed] = await tx.insert(s.waqfDeeds).values({ waqfId: w, deedNo: "DEMO-4410-001", issuer: "محكمة تجريبية", issuedOn: "2023-03-14", issuedOnHijri: "1444/08/22", status: "documented", currentVersion: 1, createdBy: by }).returning({ id: s.waqfDeeds.id });
  await tx.insert(s.deedVersions).values({
    deedId: deed.id, waqfId: w, version: 1, createdBy: by, changeNote: "نص الصك كما ورد (تجريبي)",
    body: "## البند الأول: المقدمة\n\nأوقف الواقف (تجريبي) العمارة التعليمية المبينة أدناه وقفًا مؤبدًا على تعليم أبناء المسلمين.\n\n## البند الرابع: المصارف\n\nتُصرف الغلة على حلقات تحفيظ القرآن الكريم ثم على طلاب العلم المحتاجين، فإن تعذر فعلى الفقراء والمساكين.\n\n## البند السادس: النظارة\n\nالنظارة لناظر فرد تعيّنه الجهة المختصة، وله أجرة 5% من الغلة.",
  });
  const conds = await tx.insert(s.conditions).values([
    { waqfId: w, category: "masraf", clauseRef: "4", literalText: "تُصرف الغلة على حلقات تحفيظ القرآن الكريم ثم على طلاب العلم المحتاجين.", shariaReview: "approved", position: 1, createdBy: by },
    { waqfId: w, category: "revenue", clauseRef: "5", literalText: "يُقدَّم من الغلة ما تحتاجه العمارة من صيانة قبل الصرف على المستحقين.", shariaReview: "not_reviewed", position: 2, createdBy: by },
    { waqfId: w, category: "nazara", clauseRef: "6", literalText: "للناظر أجرة قدرها خمسة في المئة من صافي الغلة.", shariaReview: "not_reviewed", position: 3, createdBy: by },
  ]).returning({ id: s.conditions.id });
  await tx.insert(s.conditionInterpretations).values({ conditionId: conds[1].id, waqfId: w, text: "المقصود بالصيانة الصيانة الدورية والطارئة دون التطوير (تفسير تجريبي).", source: "advisor", signedBy: "مستشار تجريبي", decidedOn: "2025-02-10", createdBy: by });
  await tx.insert(s.revenueAllocations).values({ waqfId: w, maintenancePct: "10.00", reservePct: "5.00", nazirFeePct: "5.00", notes: "وفق البند الخامس من الصك (تجريبي).", createdBy: by }).onConflictDoNothing();
  await tx.insert(s.founders).values({ waqfId: w, displayName: "واقف متوفى (تجريبي)", isAlive: false, nationality: "سعودي", powers: {}, createdBy: by });
  const [t] = await tx.insert(s.trustees).values({ waqfId: w, kind: "individual", displayName: "ناظر تجريبي — عبدالله", userId: by, residesInKsa: true, nationality: "سعودي", startsOn: "2023-03-14", status: "active", createdBy: by }).returning({ id: s.trustees.id });
  await tx.insert(s.trusteeAppointments).values({ trusteeId: t.id, waqfId: w, decisionNo: "DEMO-N-77", decisionDate: "2023-03-14", authority: "competent_authority", powers: "إدارة الوقف وتحصيل غلته وصرفها", fees: "5% من صافي الغلة", createdBy: by });
  await tx.insert(s.successions).values({ waqfId: w, ruleText: "ثم من تعيّنه الجهة المختصة من أهل الصلاح والخبرة (تجريبي).", position: 1, createdBy: by });
  await tx.insert(s.beneficiaryClasses).values([
    { waqfId: w, name: "حلقات تحفيظ القرآن الكريم (تجريبي)", kind: "public", tier: 1, position: 0, relation: "then", createdBy: by },
    { waqfId: w, name: "طلاب العلم المحتاجون (تجريبي)", kind: "public", tier: 2, position: 1, relation: "then", criteria: { need: true, student: true }, createdBy: by },
    { waqfId: w, name: "الفقراء والمساكين (تجريبي)", kind: "public", tier: 3, position: 2, relation: "then", isFinalDestination: true, createdBy: by },
  ]);
  await tx.insert(s.beneficialOwners).values([
    { waqfId: w, role: "nazir", fullName: "ناظر تجريبي — عبدالله", nationality: "سعودي", birthDate: "1980-05-01", birthPlace: "الرياض", idType: "national_id", idNumberEnc: encryptString("1012345678"), idNumberHash: lookupHash("1012345678"), addressEnc: encryptString("الرياض، حي تجريبي، شارع 1"), contact: "nazir@demo.waqfak.test", acquiredOn: "2023-03-14", relationToWaqf: "ناظر فرد", verifiedOn: "2026-01-10", verificationSource: "deed", nextVerificationDue: "2027-01-10", createdBy: by },
  ]);
  const [a1] = await tx.insert(s.assets).values({ waqfId: w, category: "real_estate", title: "عمارة تعليمية — حي تجريبي، الرياض (تجريبي)", ownershipDocNo: "DEMO-OWN-1", inWaqfName: true, marketValue: "15000000.00", bookValue: "12000000.00", annualIncome: "900000.00", status: "income", lastValuationOn: "2025-11-01", valuer: "مقيّم تجريبي", acquiredOn: "2023-03-14", createdBy: by }).returning({ id: s.assets.id });
  await tx.insert(s.assets).values({ waqfId: w, category: "fund_units", title: "وحدات صندوق مرابحة (تجريبي)", inWaqfName: true, marketValue: "3500000.00", annualIncome: "160000.00", status: "income", createdBy: by });
  await tx.insert(s.properties).values({ assetId: a1.id, waqfId: w, city: "الرياض", district: "حي تجريبي", usage: "commercial", areaSqm: "1800", unitsCount: 12, occupiedUnits: 10, technicalCondition: "good", createdBy: by });
  await tx.insert(s.leases).values([
    { assetId: a1.id, waqfId: w, tenantName: "مدرسة أهلية (تجريبي)", ejarContractNo: "DEMO-EJ-1", startsOn: `${year - 2}-01-01`, endsOn: addDays(45), annualRent: "600000.00", collectedToDate: "450000.00", arrears: "0", createdBy: by },
    { assetId: a1.id, waqfId: w, tenantName: "مكتبة (تجريبي)", startsOn: `${year - 1}-06-01`, endsOn: `${year + 1}-05-31`, annualRent: "300000.00", collectedToDate: "150000.00", arrears: "25000.00", createdBy: by },
  ]);
  await tx.insert(s.valuations).values({ assetId: a1.id, waqfId: w, valuer: "مقيّم تجريبي", valuerLicense: "DEMO-TQ-9", method: "الدخل", value: "15000000.00", valuedOn: "2025-11-01", createdBy: by });
  await tx.insert(s.maintenancePlans).values({ assetId: a1.id, waqfId: w, item: "صيانة التكييف المركزي", frequency: "quarterly", nextDueOn: addDays(20), estimatedCost: "18000.00", createdBy: by });
  await tx.insert(s.bankAccounts).values([
    { waqfId: w, bankName: "بنك تجريبي", ibanEnc: encryptString("SA0380000000608010167519"), ibanLast4: "7519", inWaqfName: true, purpose: "general", openedOn: "2023-04-01", createdBy: by },
  ]);
  await tx.insert(s.budgets).values({ waqfId: w, fiscalYear: year, status: "approved", approvedOn: `${year - 1}-12-20`, totalRevenue: "1060000.00", totalExpense: "260000.00", lines: [{ code: "R01", label: "إيرادات الإيجار", amount: 900000, kind: "revenue" }, { code: "R02", label: "عوائد الصندوق", amount: 160000, kind: "revenue" }, { code: "E01", label: "الصيانة", amount: 110000, kind: "expense" }, { code: "E02", label: "أجرة الناظر", amount: 50000, kind: "expense" }, { code: "E03", label: "مصاريف إدارية", amount: 100000, kind: "expense" }], createdBy: by });
  const je = (ref: string, date: string, desc: string, lines: [string, number, number][]) =>
    tx.insert(s.ledgerEntries).values(lines.map(([accountCode, debit, credit]) => ({ waqfId: w, entryDate: date, accountCode, description: desc, debit: debit.toFixed(2), credit: credit.toFixed(2), referenceNo: ref, createdBy: by })));
  await je(`JV-${year}-0001`, `${year}-01-15`, "تحصيل إيجار الربع الأول (تجريبي)", [["1100", 225000, 0], ["4100", 0, 225000]]);
  await je(`JV-${year}-0002`, `${year}-03-10`, "صيانة دورية (تجريبي)", [["5100", 18000, 0], ["1100", 0, 18000]]);
  await je(`JV-${year}-0003`, `${year}-04-01`, "عوائد الصندوق (تجريبي)", [["1100", 40000, 0], ["4200", 0, 40000]]);
  await tx.insert(s.financialStatements).values({ waqfId: w, fiscalYear: year - 1, kind: "audited", status: "draft", auditorName: "مكتب مراجعة تجريبي", auditorLicense: "DEMO-SOCPA-1", auditorIndependent: true, totalRevenue: "1010000.00", totalExpense: "240000.00", createdBy: by });
}

async function waqfB(tx: Tx, w: string, by: string, beneficiaryUser: string) {
  const [deed] = await tx.insert(s.waqfDeeds).values({ waqfId: w, deedNo: "DEMO-4445-014", status: "documented", issuedOn: "2024-09-02", currentVersion: 0, createdBy: by }).returning({ id: s.waqfDeeds.id });
  void deed;
  await tx.insert(s.conditions).values([
    { waqfId: w, category: "masraf", clauseRef: "3", literalText: "على أولادي ذكورًا وإناثًا بالسوية، ثم على أولادهم، ثم على الفقراء من ذريتي.", position: 1, createdBy: by },
    { waqfId: w, category: "founder_self", clauseRef: "5", literalText: "أستثني لنفسي نصف الغلة مدة حياتي.", position: 2, createdBy: by },
  ]);
  await tx.insert(s.waqfExceptions).values({ waqfId: w, beneficiaryName: "واقف تجريبي — سالم", kind: "yield", duration: "life", quantity: "نصف الغلة", afterwards: "يعود إلى المستحقين", createdBy: by });
  await tx.insert(s.founders).values({ waqfId: w, displayName: "واقف تجريبي — سالم", isAlive: true, userId: by, powers: { canInterpret: true, canAddAssets: true }, createdBy: by });
  await tx.insert(s.trustees).values({ waqfId: w, kind: "founder", displayName: "واقف تجريبي — سالم", userId: by, startsOn: "2024-09-02", status: "active", createdBy: by });
  await tx.insert(s.beneficialOwners).values([
    { waqfId: w, role: "controlling_founder", fullName: "واقف تجريبي — سالم", nationality: "سعودي", idType: "national_id", idNumberEnc: encryptString("1098765432"), idNumberHash: lookupHash("1098765432"), acquiredOn: "2024-09-02", relationToWaqf: "واقف وناظر", createdBy: by },
    { waqfId: w, role: "beneficiary", fullName: "مستفيد تجريبي — ريم", nationality: "سعودية", acquiredOn: "2024-09-02", relationToWaqf: "من أولاد الواقف", entitlementDesc: "ربع صافي الغلة", bankDetailsEnc: encryptString("SA0380000000608010167519"), createdBy: by },
  ]);
  await tx.insert(s.assets).values({ waqfId: w, category: "real_estate", title: "شقق سكنية — جدة (تجريبي)", inWaqfName: true, marketValue: "3200000.00", annualIncome: "180000.00", status: "income", createdBy: by });
  await tx.insert(s.bankAccounts).values({ waqfId: w, bankName: "بنك تجريبي", ibanEnc: encryptString("SA0380000000608010167519"), ibanLast4: "7519", inWaqfName: false, purpose: "general", createdBy: by });
  void beneficiaryUser;
}

async function waqfC(tx: Tx, w: string, ctx: Ctx) {
  const by = ctx.users.chair;
  await tx.insert(s.waqfDeeds).values({ waqfId: w, deedNo: "DEMO-4438-207", status: "documented", issuedOn: "2017-01-10", currentVersion: 0, createdBy: by });
  const [existing] = await tx.select({ id: s.bodies.id }).from(s.bodies).where(and(eq(s.bodies.waqfId, w), eq(s.bodies.kind, "board"))).limit(1);
  if (!existing) {
    const [b] = await tx.insert(s.bodies).values({ waqfId: w, kind: "board", name: "مجلس النظارة (تجريبي)", createdBy: by }).returning({ id: s.bodies.id });
    await tx.insert(s.bodyMemberships).values([
      { bodyId: b.id, waqfId: w, userId: ctx.users.chair, personName: "رئيس مجلس تجريبي — فهد", role: "chair", startsOn: "2024-01-01", createdBy: by },
      { bodyId: b.id, waqfId: w, userId: ctx.users.member1, personName: "عضو مجلس تجريبي — نورة", role: "member", startsOn: "2024-01-01", createdBy: by },
      { bodyId: b.id, waqfId: w, userId: ctx.users.member2, personName: "عضو مستقل تجريبي — خالد", role: "member", isIndependent: true, startsOn: "2024-01-01", createdBy: by },
      { bodyId: b.id, waqfId: w, userId: ctx.users.secretary, personName: "أمين سر تجريبي — هند", role: "secretary", hasVote: false, startsOn: "2024-01-01", createdBy: by },
    ]);
  }
}

export default async function seedWaqfFile(tx: Tx, ctx: Ctx) {
  if (!(await hasDeed(tx, ctx.waqfs.A))) await waqfA(tx, ctx.waqfs.A, ctx.users.nazir);
  if (!(await hasDeed(tx, ctx.waqfs.B))) await waqfB(tx, ctx.waqfs.B, ctx.users.waqif, ctx.users.beneficiary);
  if (!(await hasDeed(tx, ctx.waqfs.C))) await waqfC(tx, ctx.waqfs.C, ctx);
}

// Direct run: read ids from the credentials file written by seed-demo.
if (process.argv[1]?.endsWith("30-waqf-file.ts")) {
  (async () => {
    const { readFileSync } = await import("node:fs");
    const creds = JSON.parse(readFileSync("storage/demo-credentials.json", "utf8"));
    const users = Object.fromEntries(Object.entries(creds.users as Record<string, { id: string }>).map(([k, v]) => [k, v.id]));
    await withSystem((tx) => seedWaqfFile(tx, { users, waqfs: creds.waqfs }));
    console.log("waqf-file demo data ready");
    process.exit(0);
  })().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}
