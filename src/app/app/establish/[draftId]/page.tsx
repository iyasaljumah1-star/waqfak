import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Check } from "lucide-react";
import { Alert, Badge, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { ActionLink } from "@/components/portal/action-link";
import { ActionButton } from "@/components/waqf/action-form";
import { DeedPaper, DeedText, Muted } from "@/components/waqf/bits";
import { AllocationStep, AssetsStep, BoardMembersEditor, ClassificationFields, WizardStepForm } from "@/components/waqf/establish-steps";
import { EstablishRows } from "@/components/waqf/establish-rows";
import { cn, fmtNumber, NAZIR_MODE_LABEL, TYPE_LABEL } from "@/lib/utils";
import { loadWaqfAccess, requireAuth } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { discardEstablishDraft, finishEstablish, saveEstablishStep } from "@/server/modules/establish/actions";
import { BOARD_ROLES, buildDeedDraft, classify, ESTABLISH_STEPS, missingItems } from "@/server/modules/establish/pure";
import { draftState } from "@/server/modules/establish/queries";
import { isFlagOn } from "@/server/modules/requests/catalog";
import { todayIso } from "@/server/modules/waqf-file/form";
import { isUuid } from "@/server/modules/waqf-file/guard";
import { ASSET_CATEGORY_LABEL, CONDITION_CATEGORY_LABEL, FOUNDER_POWERS, options } from "@/server/modules/waqf-file/labels";

export const metadata: Metadata = { title: "معالج تأسيس الوقف" };

const DRAFT_LABEL = "مسودة أولية للمراجعة الشرعية والقانونية قبل التوثيق";
const input = "block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px]";

function L({ label, children, hint, className }: { label: string; children: React.ReactNode; hint?: string; className?: string }) {
  return (
    <label className={cn("block space-y-1.5 text-[15px]", className)}>
      <span className="block font-medium">{label}</span>
      {children}
      {hint ? <span className="block text-[13px] text-muted">{hint}</span> : null}
    </label>
  );
}

export default async function EstablishDraftPage({ params, searchParams }: { params: Promise<{ draftId: string }>; searchParams: Promise<{ step?: string; done?: string }> }) {
  const { draftId } = await params;
  const sp = await searchParams;
  if (!isUuid(draftId)) redirect("/app/establish");
  const auth = await requireAuth({ next: `/app/establish/${draftId}` });
  const data = await read(auth, async (tx) => {
    const access = await loadWaqfAccess(tx, auth, draftId);
    if (!access || !access.roles.includes("founder") || access.waqf.createdBy !== auth.user.id) return null;
    const d = await draftState(tx, draftId);
    if (!d) return null;
    return { waqf: access.waqf, ...d, temporaryAllowed: await isFlagOn(tx, "waqf.temporary_waqf") };
  });
  if (!data) redirect("/app/establish");
  const st = data.state;
  const n = ESTABLISH_STEPS.length;
  const finished = !!st.finishedAt;
  const step = finished ? n : Math.min(n, Math.max(1, Number(sp.step) || st.step || 1));
  const today = todayIso();
  const t = classify(st.classification);
  const missing = missingItems(st);
  const deedText = finished ? (data.body ?? st.deedText ?? "") : buildDeedDraft(st, today);
  const reachable = (i: number) => finished || i <= Math.max(st.step, ...st.completed, 1) + 1;

  return (
    <div className="space-y-6">
      <PageHeader
        title={st.waqfName || "وقف جديد"}
        description={`الخطوة ${fmtNumber(step)} من ${fmtNumber(n)}: ${ESTABLISH_STEPS[step - 1].label}`}
        crumbs={[{ href: "/app/establish", label: "تأسيس وقف جديد" }, { label: data.waqf.internalNumber }]}
      />

      <nav aria-label="خطوات المعالج" className="-mx-4 overflow-x-auto px-4 md:mx-0 md:px-0">
        <ol className="flex min-w-max gap-1.5 md:min-w-0 md:flex-wrap">
          {ESTABLISH_STEPS.map((s, i) => {
            const idx = i + 1;
            const done = st.completed.includes(idx);
            const cur = idx === step;
            const cls = cn("flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px]", cur ? "border-ink bg-ink text-white dark:text-[#0f141c]" : done ? "border-ok/40 bg-ok-soft text-ok" : "border-line text-muted");
            const body = (
              <>
                {done && !cur ? <Check aria-hidden className="size-3.5" /> : <span className="tabular">{idx}</span>}
                {s.label}
              </>
            );
            return (
              <li key={s.key}>
                {reachable(idx) && !cur && !finished ? <Link href={`/app/establish/${draftId}?step=${idx}`} className={cn(cls, "hover:border-ink")}>{body}</Link> : <span aria-current={cur ? "step" : undefined} className={cls}>{body}</span>}
              </li>
            );
          })}
        </ol>
      </nav>

      {finished ? (
        <Alert tone="ok" title={sp.done ? "اعتُمدت المسودة ونُقلت بياناتها إلى ملف الوقف" : "المسودة معتمدة"}>
          أنشأنا ملف الوقف بحالة «مسودة» ببياناته وأصوله ومصارفه وشروطه. الخطوة التالية: مراجعة الوثيقة قانونيًا وشرعيًا ثم توثيقها لدى الجهة المختصة.
        </Alert>
      ) : null}

      {!finished && step === 1 ? (
        <Panel title="نوع الوقف" description="نبدأ بالمصرف لأنه يحدد نوع الوقف ونظامه: العام والخاص والمشترك (نظام الهيئة العامة للأوقاف، المادة الأولى).">
          <WizardStepForm action={saveEstablishStep} draftId={draftId} step={1} isFirst>
            <ClassificationFields initial={st.classification} temporaryAllowed={data.temporaryAllowed} />
          </WizardStepForm>
        </Panel>
      ) : null}

      {!finished && step === 2 ? (
        <Panel title="الواقف" description="من يقف المال، وما يحتفظ به لنفسه من صلاحيات أو منافع.">
          <WizardStepForm action={saveEstablishStep} draftId={draftId} step={2} isFirst={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <L label="اسم الواقف كاملًا"><input name="name" defaultValue={st.founder.name} maxLength={200} className={input} required /></L>
              <L label="الجنسية"><input name="nationality" defaultValue={st.founder.nationality} maxLength={60} className={input} /></L>
            </div>
            <label className="flex items-start gap-3 text-[15px]"><input type="checkbox" name="isSelf" defaultChecked={st.founder.isSelf === "on"} className="mt-1.5 size-4 accent-[var(--ink)]" /> أنا الواقف (وليس شخصًا أنوب عنه)</label>
            <fieldset className="space-y-2">
              <legend className="mb-1 text-[15px] font-semibold">صلاحيات يحتفظ بها الواقف حال حياته (اختياري)</legend>
              <div className="grid gap-2 sm:grid-cols-2">
                {FOUNDER_POWERS.map((p) => (
                  <label key={p.key} className="flex items-center gap-2 rounded-md border border-line px-3 py-2 text-[15px]"><input type="checkbox" name="powers" value={p.label} defaultChecked={st.founder.powers.includes(p.label)} className="size-4 accent-[var(--ink)]" /> {p.label}</label>
                ))}
              </div>
            </fieldset>
            <div className="grid gap-4 sm:grid-cols-2">
              <L label="هل تستثني لنفسك شيئًا من الوقف؟" hint="يصح أن يشترط الواقف الانتفاع بوقفه مدة حياته، مع بيان آلية الانتفاع ومقداره.">
                <select name="selfBenefit" defaultValue={st.founder.selfBenefit} className={input}>
                  <option value="none">لا</option>
                  <option value="usufruct">الانتفاع بالأصل مدة حياتي</option>
                  <option value="yield">الغلة أو جزء منها مدة حياتي</option>
                </select>
              </L>
              <L label="تفصيل الاستثناء"><input name="selfBenefitNote" defaultValue={st.founder.selfBenefitNote} maxLength={300} className={input} placeholder="مثال: نصف الغلة" /></L>
            </div>
          </WizardStepForm>
        </Panel>
      ) : null}

      {!finished && step === 3 ? (
        <Panel title="الأصول الموقوفة" description="اختر نوع كل أصل فتظهر الحقول التي تناسبه: العقار بصكه وموقعه ومساحته، والمنقول بكميته ومكانه، والأصل المالي بجهته وعدد وحداته. الحقول المعلّمة بنجمة لازمة لاكتمال الأصل.">
          <WizardStepForm action={saveEstablishStep} draftId={draftId} step={3} isFirst={false}>
            <AssetsStep initial={st.assets.map((a) => ({ category: a.category, title: a.title, value: a.value, ownershipDocNo: a.ownershipDocNo, sharePct: a.sharePct, held: a.inFounderName, details: a.details ?? {} }))} />
            <Muted>اختيار الأصل: راعِ استدامته وقابليته للنمو وسهولة إدارته (الدليل الإرشادي لاختيار الأصول الوقفية). إن كنت مترددًا اطلب خدمة «اختيار الأصل الموقوف».</Muted>
          </WizardStepForm>
        </Panel>
      ) : null}

      {!finished && step === 4 ? (
        <Panel id="conditions" title="المصارف والشروط" description="رتّب المستحقين في طبقات. «ثم» تعني أن الطبقة لا تستحق حتى تنقرض التي قبلها، و«و» تعني الاشتراك.">
          <WizardStepForm action={saveEstablishStep} draftId={draftId} step={4} isFirst={false}>
            <EstablishRows
              classes={st.classes as unknown as Record<string, string>[]}
              conditions={st.conditions as unknown as Record<string, string>[]}
              defaultKind={st.classification.beneficiaryKind === "public" ? "public" : "private"}
              conditionOptions={options(CONDITION_CATEGORY_LABEL)}
            />
            <L label="المآل إذا انقطع المستحقون" hint={st.classification.beneficiaryKind === "public" ? "اختياري في الوقف العام." : "مطلوب: جهة بر دائمة لا تنقطع."}>
              <input name="finalDestination" defaultValue={st.finalDestination} maxLength={300} className={input} placeholder="مثال: الفقراء والمساكين في مدينة الرياض" />
            </L>
          </WizardStepForm>
        </Panel>
      ) : null}

      {!finished && step === 5 ? (
        <Panel id="nazara" title="النظارة" description="من يدير الوقف ويحفظه ويصرف غلته، ومن يخلفه.">
          <WizardStepForm action={saveEstablishStep} draftId={draftId} step={5} isFirst={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <L label="صيغة النظارة">
                <select name="mode" defaultValue={st.nazara.mode} className={input}>
                  <option value="">اختر</option>
                  {(["founder", "individual", "board", "legal_entity"] as const).map((m) => <option key={m} value={m}>{NAZIR_MODE_LABEL[m]}</option>)}
                </select>
              </L>
              <L label="اسم الناظر أو الجهة الناظرة" hint="اتركه فارغًا إن كان الواقف هو الناظر. لمجلس النظارة أضف أعضاءه أدناه."><input name="nazirName" defaultValue={st.nazara.mode === "board" ? "" : st.nazara.nazirName} maxLength={500} className={input} /></L>
              <L label="خلافة النظارة" hint="مثال: ثم للأرشد من أولادي"><input name="successionRule" defaultValue={st.nazara.successionRule} maxLength={500} className={input} /></L>
              <L label="أجرة الناظر — نسبة من الغلة (%)"><input name="feePct" inputMode="decimal" dir="ltr" defaultValue={st.nazara.feePct} className={input} /></L>
              <L label="أو أجرة ثابتة سنوية (ريال)"><input name="feeFixed" inputMode="decimal" dir="ltr" defaultValue={st.nazara.feeFixed} className={input} /></L>
              <L label="واجبات أو صلاحيات إضافية للناظر" className="sm:col-span-2"><textarea name="duties" defaultValue={st.nazara.duties} maxLength={1500} className="block min-h-20 w-full rounded-md border border-line-strong bg-surface px-3 py-2" /></L>
            </div>
            <fieldset id="board" className="scroll-mt-24 space-y-2 rounded-md border border-line p-3">
              <legend className="px-1 text-[15px] font-semibold">أعضاء مجلس النظارة (عند اختيار «مجلس نظارة»)</legend>
              <p className="text-[13px] text-muted">ثلاثة أعضاء فأكثر، منهم رئيس واحد. يُنشأ بهم المجلس في ملف الوقف عند اعتماد المسودة، ويُدعون إلى الاجتماعات. بيانات التواصل لا تظهر إلا لمن يدير الحوكمة.</p>
              <BoardMembersEditor initial={st.nazara.members as unknown as Record<string, string>[]} roleOptions={BOARD_ROLES.map(([value, label]) => ({ value, label }))} />
            </fieldset>
            <Muted>يلزم الناظرَ الاعتباري ترخيصٌ من الهيئة، ويُستحسن أن تُدار الأوقاف الكبيرة بمجلس نظارة يضم أعضاء مستقلين.</Muted>
          </WizardStepForm>
        </Panel>
      ) : null}

      {!finished && step === 6 ? (
        <Panel title="توزيع الغلة" description="ما يُقتطع من صافي الغلة قبل الصرف على المستحقين. اتركها فارغة إن أردت أن يقدّر الناظر حاجة العمارة كل سنة.">
          <WizardStepForm action={saveEstablishStep} draftId={draftId} step={6} isFirst={false}>
            <AllocationStep initial={st.allocation as unknown as Record<string, string>} />
          </WizardStepForm>
        </Panel>
      ) : null}

      {step === 7 ? (
        <>
          <Panel title="ملخص الوقف">
            <DefinitionList
              cols={3}
              items={[
                { label: "النوع", value: t.type ? TYPE_LABEL[t.type] : "—" },
                { label: "الواقف", value: st.founder.name || "—" },
                { label: "الأصول", value: `${fmtNumber(st.assets.length)} أصل — ${fmtNumber(st.assets.reduce((s, a) => s + (Number(a.value) || 0), 0))} ريال` },
                { label: "المصارف", value: st.classes.map((c) => c.name).join(" ثم ") || "—" },
                { label: "النظارة", value: st.nazara.mode ? `${NAZIR_MODE_LABEL[st.nazara.mode]}${st.nazara.nazirName ? ` — ${st.nazara.nazirName}` : ""}` : "—" },
                { label: "الشروط", value: `${fmtNumber(st.conditions.length)} شرط` },
              ]}
            />
            {st.assets.length ? <Muted>{st.assets.map((a) => `${ASSET_CATEGORY_LABEL[a.category] ?? ""}: ${a.title}`).join(" · ")}</Muted> : null}
          </Panel>

          {!finished ? (
            <Panel title="اسم الوقف">
              <WizardStepForm action={saveEstablishStep} draftId={draftId} step={7} isFirst={false} nextLabel="احفظ الاسم">
                <L label="اسم الوقف كما تريده في الوثيقة" hint="مثال: وقف آل فلان الخيري"><input name="waqfName" defaultValue={st.waqfName} maxLength={200} className={input} /></L>
              </WizardStepForm>
            </Panel>
          ) : null}

          <DeedPaper title={`وثيقة ${st.waqfName || "الوقف"}`} label={DRAFT_LABEL} testId="deed-draft">
            <DeedText text={deedText} />
          </DeedPaper>

          <Panel id="approve" title={finished ? "الخطوة التالية" : "اعتماد المسودة"}>
            {!finished ? (
              <div className="space-y-3">
                {missing.length ? (
                  <Alert tone="warn" title="بقيت أمور قبل الاعتماد">
                    <ul className="space-y-0.5">{missing.map((m, i) => <li key={i}><Link className="underline" href={`/app/establish/${draftId}?step=${m.step}`}>الخطوة {m.step}</Link>: {m.text}</li>)}</ul>
                  </Alert>
                ) : (
                  <p className="text-[15px]">باعتماد المسودة يُنشأ ملف الوقف ببياناته في المنصة (بحالة «مسودة»)، ويُحفظ نص الوثيقة إصدارًا أول. ثم تطلب الصياغة النهائية والتوثيق.</p>
                )}
                <div className="flex flex-wrap gap-2">
                  <ActionButton action={finishEstablish} hidden={{ draftId }} label="اعتمد المسودة وأنشئ ملف الوقف" variant="primary" size="md" />
                  <ActionButton action={discardEstablishDraft} hidden={{ draftId }} label="ألغِ المسودة" variant="ghost" size="md" confirm="إلغاء هذه المسودة؟" />
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                <p className="text-[15px]">المسودة جاهزة للخطوة التالية: صياغتها النهائية بمراجعة شرعية وقانونية، ثم تجهيز متطلبات التوثيق والتسجيل، ونرافقك في إجراءاتهما لدى الجهات المختصة.</p>
                <div className="flex flex-wrap gap-2">
                  <ActionLink href={`/app/requests/new?service=T03&waqf=${draftId}`} variant="primary" data-testid="request-documentation">اطلب خدمة التوثيق — صياغة الوثيقة</ActionLink>
                  <ActionLink href={`/app/requests/new?service=T06&waqf=${draftId}`} variant="secondary">تجهيز ملف التوثيق والتسجيل</ActionLink>
                  <ActionLink href={`/app/w/${draftId}`} variant="ghost">افتح ملف الوقف</ActionLink>
                </div>
                <p className="flex items-center gap-2 text-[13px] text-muted"><Badge tone="seal" icon={false}>للعلم</Badge> يُوثَّق الوقف لدى الجهة المختصة عبر بوابة ناجز، ثم يُسجَّل لدى الهيئة خلال 30 يوم عمل من توثيقه.</p>
              </div>
            )}
          </Panel>
        </>
      ) : null}
    </div>
  );
}
