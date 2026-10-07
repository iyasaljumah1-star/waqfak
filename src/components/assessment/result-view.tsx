import Link from "next/link";
import type { ReactNode } from "react";
import { ArrowLeft, BadgeCheck, BookMarked, CircleSlash, FileDown, Info, Microscope, OctagonAlert, Package, ShieldAlert, ThumbsDown, ThumbsUp, Wrench } from "lucide-react";
import { Alert, Badge, ButtonLink, Panel, type Tone } from "@/components/ui";
import { cn, fmtBoth, fmtDate, SIZE_LABEL, TYPE_LABEL } from "@/lib/utils";
import { toISO } from "@/server/engines/dates";
import { DEFAULT_MATURITY_BANDS } from "@/server/engines/assessment";
import type { RecView, ResultBundle } from "@/server/modules/assessment/queries";
import { CONFIDENCE_LABEL, STATUS_VIEW, WAVE_HINT, WAVE_LABEL, waveDueDate } from "@/server/modules/assessment/facts";
import { AXIS_SHORT } from "./radar";
import { RadarFigure, ScoreBar } from "./radar-figure";
import { ActionPlanForm, ClaimForm, ShareControls } from "./result-actions";

export type ResultViewProps = {
  bundle: ResultBundle;
  mode: "full" | "share";
  signedIn: boolean;
  canShare?: boolean;
  canPlan?: boolean;
  canClaim?: boolean;
  claimWaqfs?: { id: string; name: string }[];
  shares?: { id: string; expiresAt: string; revokedAt: string | null; views: number; createdAt: string }[];
  crumbs?: ReactNode;
};

const SEVERITY: Record<string, { label: string; tone: Tone }> = {
  critical: { label: "حرجة", tone: "critical" },
  high: { label: "عالية", tone: "fine" },
  medium: { label: "متوسطة", tone: "warn" },
  low: { label: "منخفضة", tone: "neutral" },
};

const ringColor: Record<string, string> = { critical: "var(--critical)", fine: "var(--fine)", info: "var(--info)", ok: "var(--ok)" };

function ScoreRing({ score, tone }: { score: number; tone: string }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, score));
  return (
    <svg viewBox="0 0 128 128" className="size-36 shrink-0 md:size-40" role="img" aria-label={`الدرجة الكلية ${Math.round(score)} من 100`}>
      <circle cx="64" cy="64" r={r} fill="none" style={{ stroke: "var(--surface-2)" }} strokeWidth="11" />
      <circle cx="64" cy="64" r={r} fill="none" style={{ stroke: ringColor[tone] ?? "var(--ink)" }} strokeWidth="11" strokeLinecap="round"
        strokeDasharray={`${(c * v) / 100} ${c}`} transform="rotate(-90 64 64)" />
      <text x="64" y="62" textAnchor="middle" style={{ fill: "var(--text)", fontSize: 34, fontWeight: 700 }} className="tabular">{Math.round(score)}</text>
      <text x="64" y="84" textAnchor="middle" style={{ fill: "var(--muted)", fontSize: 12 }}>من 100</text>
    </svg>
  );
}

function MaturityScale({ score, level }: { score: number; level: string }) {
  const bands = [...DEFAULT_MATURITY_BANDS].sort((a, b) => a.min - b.min);
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
        <span className="text-muted">مؤشر النضج</span>
        <span className="tabular text-xl font-semibold text-text">{Math.round(score)}</span>
        <span className="font-semibold text-ink">— {level}</span>
      </p>
      <ol className="mt-2 grid grid-cols-5 gap-1" aria-label="مستويات النضج">
        {bands.map((b, i) => {
          const max = bands[i + 1]?.min ?? 101;
          const active = score >= b.min && score < max;
          return (
            <li key={b.level} className="min-w-0">
              <span aria-hidden className={cn("block h-2 rounded-full", active ? "bg-ink" : "bg-surface-2 ring-1 ring-line")} />
              <span className={cn("mt-1 block truncate text-center text-[11.5px]", active ? "font-semibold text-ink" : "text-muted")} aria-current={active ? "true" : undefined}>{b.level}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1 text-[12.5px] text-muted">مركّب من الحوكمة (30%) والنظارة والمالية (20% لكل منهما) والوثائق والتحول الرقمي (15% لكل منهما).</p>
    </div>
  );
}

function requestHref(code: string, rec: RecView, waqfId: string | null) {
  const q = new URLSearchParams({ service: code });
  if (waqfId) q.set("waqf", waqfId);
  q.set("rec", rec.id);
  return `/app/requests/new?${q.toString()}`;
}

function RecCard({ rec, waqfId, mode }: { rec: RecView; waqfId: string | null; mode: "full" | "share" }) {
  const sev = SEVERITY[rec.severity] ?? SEVERITY.low;
  const muted = rec.status === "suppressed" || rec.status === "dismissed";
  return (
    <li className={cn("rounded-lg border bg-surface p-4", rec.severity === "critical" && !muted ? "border-critical/40 border-s-4 border-s-critical" : "border-line", muted && "bg-surface-2")}>
      <div className="flex flex-wrap items-start gap-2">
        <h4 className="min-w-0 flex-1 text-[16.5px] font-semibold leading-7">{rec.needTitle}</h4>
        {rec.status === "converted" ? <Badge tone="ok">طُلبت الخدمة</Badge> : null}
        {rec.manual ? <Badge tone="seal" icon={false}>أضافها المراجع</Badge> : null}
        <Badge tone={sev.tone}>أولوية {sev.label}</Badge>
      </div>
      <p className="mt-2 text-[15px] leading-7"><span className="font-medium text-muted">لماذا: </span>{rec.reasonAr}</p>
      {rec.whyItMattersAr ? <p className="mt-1 text-[15px] leading-7 text-text/90">{rec.whyItMattersAr}</p> : null}
      {rec.reference ? (
        <p className="mt-2 flex items-start gap-1.5 text-[13px] text-muted">
          <BookMarked aria-hidden className="mt-0.5 size-3.5 shrink-0" />
          <span>المرجع: {rec.reference}</span>
        </p>
      ) : null}
      {rec.status === "suppressed" && rec.suppressedNote ? <p className="mt-2 text-[13.5px] text-muted"><CircleSlash aria-hidden className="me-1 inline size-3.5" />{rec.suppressedNote}</p> : null}
      {rec.status === "dismissed" ? <p className="mt-2 text-[13.5px] text-muted"><CircleSlash aria-hidden className="me-1 inline size-3.5" />استبعدها المراجع: {rec.dismissReason}</p> : null}

      {!muted && (rec.services.length || rec.selfServiceHintAr) ? (
        <div className="mt-3 space-y-2 border-t border-line pt-3">
          {rec.services.map((s) => (
            <div key={s.code} className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="min-w-0 flex-1 text-[15px]">
                <span className="text-muted">الخدمة المناسبة: </span>
                <span className="font-medium">{s.nameAr}</span>
                <span className="tabular ms-1 text-[12px] text-muted">({s.code})</span>
              </span>
              {mode === "full" && rec.status !== "converted" ? (
                <ButtonLink href={requestHref(s.code, rec, waqfId)} size="sm" variant="secondary" className="w-full sm:w-auto">
                  اطلب هذه الخدمة
                  <ArrowLeft aria-hidden className="size-3.5" />
                </ButtonLink>
              ) : null}
            </div>
          ))}
          {rec.selfServiceHintAr ? (
            <p className="flex items-start gap-1.5 text-[14px] text-olive">
              <Wrench aria-hidden className="mt-1 size-3.5 shrink-0" />
              <span>تستطيع بنفسك: {rec.selfServiceHintAr}</span>
            </p>
          ) : null}
        </div>
      ) : null}
      {rec.removed.length && !muted ? (
        <ul className="mt-2 space-y-1">
          {rec.removed.map((r) => (
            <li key={r.code} className="flex items-start gap-1.5 text-[12.5px] leading-6 text-muted">
              <Info aria-hidden className="mt-1 size-3 shrink-0" />
              <span>لم نقترح «{r.nameAr}»: {r.why}</span>
            </li>
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function ResultView(p: ResultViewProps) {
  const { bundle: b, mode } = p;
  const st = STATUS_VIEW[b.result.status] ?? STATUS_VIEW.stable;
  const computedISO = toISO(new Date(b.result.computedAt));
  const subject = mode === "share" ? `وقف ${b.result.sizeClass ? SIZE_LABEL[b.result.sizeClass] : ""}${b.result.computedType ? ` — ${TYPE_LABEL[b.result.computedType]}` : ""}` : b.waqf?.name ?? b.row.waqfLabel ?? "وقف غير مسجّل في المنصة";
  const criticalFlags = b.flags.filter((f) => f.severity === "critical");
  const otherFlags = b.flags.filter((f) => f.severity !== "critical");
  const active = b.recs.filter((r) => r.status !== "suppressed" && r.status !== "dismissed");
  const parked = b.recs.filter((r) => r.status === "suppressed" || r.status === "dismissed");
  const axisNotes = mode === "full" ? b.review?.axes ?? {} : {};
  const reviewed = !!b.row.reviewedAt;
  const scoredAxes = b.axes.filter((a) => a.score !== null);
  const totalW = scoredAxes.reduce((s, a) => s + (a.weight ?? 0), 0) || 1;

  return (
    <div className="space-y-6">
      {/* header */}
      <header className="space-y-2">
        {p.crumbs}
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="ink" icon={false}>{b.row.kind === "deep" ? "تقييم معمّق" : "تقييم سريع"}</Badge>
          {reviewed ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-seal-soft px-2.5 py-0.5 text-[13px] font-semibold leading-6 text-seal">
              <BadgeCheck aria-hidden className="size-4" />
              روجع من مختص
            </span>
          ) : null}
          <span className="tabular text-[13px] text-muted">{b.number}</span>
        </div>
        <h1 className="font-naskh text-[1.85rem] font-bold leading-snug text-ink md:text-[2.25rem]">نتيجة التقييم الوقفي</h1>
        <p className="text-[16px] text-muted">
          <span className="font-medium text-text">{subject}</span> · {fmtBoth(computedISO)}
        </p>
      </header>

      {p.canClaim ? (
        <Alert tone="info" title="هذا التقييم أجريته قبل تسجيل الدخول">
          <p className="mb-3">احفظه في حسابك ليبقى في سجلك، ويمكنك ربطه بأحد أوقافك.</p>
          <ClaimForm id={b.row.id} waqfs={p.claimWaqfs ?? []} />
        </Alert>
      ) : mode === "full" && !p.signedIn ? (
        <Alert tone="info" title="احفظ النتيجة قبل أن تغلق الصفحة" action={<ButtonLink href={`/signup?next=${encodeURIComponent(`/assessment/${b.row.id}/result`)}`} size="sm">أنشئ حسابًا</ButtonLink>}>
          النتيجة محفوظة في هذا المتصفح فقط. أنشئ حسابًا أو <Link className="underline underline-offset-4" href={`/login?next=${encodeURIComponent(`/assessment/${b.row.id}/result`)}`}>سجّل الدخول</Link> ثم اختر «احفظ النتيجة في حسابي».
        </Alert>
      ) : null}

      {/* summary */}
      <section aria-labelledby="sum-title" className="rounded-xl border border-line bg-surface p-5 shadow-card md:p-7">
        <h2 id="sum-title" className="sr-only">الملخص</h2>
        <div className="grid gap-6 md:grid-cols-[auto_1fr] md:items-center md:gap-8">
          <div className="flex items-center gap-5 md:flex-col md:gap-2">
            <ScoreRing score={b.result.overallScore} tone={st.tone} />
            <div className="md:text-center">
              <p className="text-[13px] text-muted">الدرجة الكلية</p>
              <Badge tone={st.tone} className="mt-1 text-[14px]">الحالة: {st.label}</Badge>
            </div>
          </div>
          <div className="space-y-5">
            <p className="text-[17px] leading-8">{st.summary}</p>
            <div className="grid gap-5 lg:grid-cols-2">
              <MaturityScale score={b.result.maturityScore} level={b.result.maturityLevel} />
              <div>
                <p className="flex flex-wrap items-baseline gap-x-2 text-[15px]">
                  <span className="text-muted">ثقة النتيجة</span>
                  <span className="font-semibold text-text">{CONFIDENCE_LABEL[b.result.confidence]}</span>
                  {b.completeness !== null ? <span className="tabular text-[13px] text-muted">(اكتمال الإجابات {Math.round(b.completeness * 100)}%)</span> : null}
                </p>
                {b.confidenceReasons.length ? (
                  <ul className="mt-1.5 list-disc space-y-1 ps-5 text-[13.5px] leading-6 text-muted">
                    {b.confidenceReasons.map((r) => <li key={r}>{r}</li>)}
                  </ul>
                ) : <p className="mt-1 text-[13.5px] text-muted">أجبت عن الأسئلة المنطبقة بإجابات محددة.</p>}
              </div>
            </div>
            <dl className="flex flex-wrap gap-x-8 gap-y-2 border-t border-line pt-4 text-[14.5px]">
              <div><dt className="inline text-muted">فئة الحجم: </dt><dd className="inline font-medium">{b.result.sizeClass ? SIZE_LABEL[b.result.sizeClass] : "غير محددة"}</dd></div>
              <div><dt className="inline text-muted">النوع المستنتج: </dt><dd className="inline font-medium">{b.result.computedType ? TYPE_LABEL[b.result.computedType] : "غير محدد"}</dd></div>
              <div><dt className="inline text-muted">علامات حرجة: </dt><dd className="tabular inline font-medium">{criticalFlags.length}</dd></div>
              <div><dt className="inline text-muted">توصيات: </dt><dd className="tabular inline font-medium">{active.length}</dd></div>
            </dl>
            {b.computedTypeReason ? <p className="text-[13px] leading-6 text-muted">{b.computedTypeReason}</p> : null}
          </div>
        </div>
      </section>

      {/* review state */}
      {reviewed && b.review?.summary && mode === "full" ? (
        <section aria-labelledby="rev-title" className="rounded-lg border border-seal/40 bg-seal-soft/60 p-4 md:p-5">
          <h2 id="rev-title" className="flex items-center gap-2 font-semibold text-seal"><BadgeCheck aria-hidden className="size-5" />ملاحظات المختص</h2>
          <p className="mt-2 whitespace-pre-line text-[15px] leading-7">{b.review.summary}</p>
          {mode === "full" && b.reviewerName ? <p className="mt-2 text-[13px] text-muted">راجعه: {b.reviewerName} — {fmtDate(b.row.reviewedAt)}</p> : null}
        </section>
      ) : b.row.kind === "deep" && !reviewed && mode === "full" ? (
        <Alert tone="info" title="بانتظار مراجعة مختص">النتيجة المعروضة محسوبة آليًا. سيراجعها مختص في وقفك ويضيف ملاحظاته على المحاور والتوصيات، ونُشعرك عند الانتهاء.</Alert>
      ) : null}

      {/* critical flags first */}
      {b.flags.length ? (
        <section aria-labelledby="flags-title" className="space-y-3">
          <div>
            <h2 id="flags-title" className="flex items-center gap-2 text-xl font-semibold text-critical">
              <ShieldAlert aria-hidden className="size-6" />
              علامات حرجة ({criticalFlags.length})
            </h2>
            <p className="mt-1 text-[14.5px] text-muted">مخالفات جوهرية تتقدم على الدرجة: حالة الوقف «حرج» ما بقيت، ودرجة محورها لا تتجاوز 39 مهما كانت بقية الإجابات.</p>
          </div>
          <ul className="space-y-3">
            {[...criticalFlags, ...otherFlags].map((f) => (
              <li key={f.code} role="group" aria-label={f.titleAr} className={cn("rounded-lg border-s-4 p-4", f.severity === "critical" ? "border-critical bg-critical-soft" : "border-fine bg-fine-soft")}>
                <p className={cn("flex items-start gap-2 text-[16.5px] font-semibold leading-7", f.severity === "critical" ? "text-critical" : "text-fine")}>
                  <OctagonAlert aria-hidden className="mt-1 size-5 shrink-0" />
                  <span>{f.titleAr}{f.severity !== "critical" ? <span className="ms-2 text-[13px] font-medium">(تنبيه)</span> : null}</span>
                </p>
                {f.actionAr ? <p className="mt-2 text-[15px] leading-7 text-text"><span className="font-medium">ما العمل: </span>{f.actionAr}</p> : null}
                <div className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-[13px] text-text/80">
                  {f.referenceText ? <span className="inline-flex items-start gap-1"><BookMarked aria-hidden className="mt-0.5 size-3.5 shrink-0" />المرجع: {f.referenceText}</span> : null}
                  {f.penaltyText ? <span>الجزاء المحتمل: {f.penaltyText}{f.penaltyCode ? ` (بند ${f.penaltyCode})` : ""}</span> : null}
                  {f.axisCode ? <span>المحور: {AXIS_SHORT[f.axisCode] ?? f.axisCode}</span> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ) : (
        <Alert tone="ok" title="لا علامات حرجة">لم تكشف إجاباتك عن مخالفة جوهرية من المخالفات الأربع عشرة التي نفحصها.</Alert>
      )}

      {/* axes */}
      <Panel title="المحاور الأحد عشر" description="درجة كل محور من 100، والوزن حسب فئة حجم الوقف.">
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)]">
          <RadarFigure axes={b.axes.map((a) => ({ code: a.code, name: a.nameAr, score: a.score, capped: a.capped }))} caption="النقطة الحمراء: محور سُقّف بسبب علامة حرجة. التفاصيل في الجدول." />
          <table className="w-full border-collapse text-[14.5px]">
            <caption className="sr-only">درجات المحاور</caption>
            <thead>
              <tr className="border-b border-line text-[13px] text-muted">
                <th scope="col" className="py-2 pe-2 text-start font-medium">المحور</th>
                <th scope="col" className="w-[42%] py-2 text-start font-medium">الدرجة</th>
                <th scope="col" className="hidden py-2 ps-2 text-end font-medium sm:table-cell">الوزن</th>
              </tr>
            </thead>
            <tbody>
              {b.axes.map((a) => (
                <tr key={a.code} className="border-b border-line align-top last:border-0">
                  <th scope="row" className="py-2.5 pe-2 text-start font-normal">
                    <span className="font-medium">{a.nameAr}</span>
                    {a.capped ? <span className="block text-[12px] text-critical">سُقّف عند 39 بسبب علامة حرجة</span> : null}
                    {a.score !== null && a.answeredCount < a.applicableCount ? <span className="block text-[12px] text-muted">أُجيب {a.answeredCount} من {a.applicableCount}</span> : null}
                    {axisNotes[a.code] ? <span className="mt-1 block rounded bg-seal-soft px-2 py-1 text-[12.5px] leading-6 text-text"><span className="font-semibold text-seal">ملاحظة المختص: </span>{axisNotes[a.code]}</span> : null}
                  </th>
                  <td className="py-2.5"><ScoreBar score={a.score} capped={a.capped} /></td>
                  <td className="tabular hidden py-2.5 ps-2 text-end text-muted sm:table-cell">{a.weight !== null && a.score !== null ? `${Math.round(((a.weight ?? 0) / totalW) * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Panel>

      {/* recommendations */}
      <section aria-labelledby="recs-title" className="space-y-4">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 id="recs-title" className="text-xl font-semibold text-ink">ما الذي تفعله الآن؟</h2>
            <p className="mt-1 text-[14.5px] text-muted">توصيات مرتبة في ثلاث موجات حسب الخطورة والموعد النظامي. لكل توصية سببها ومرجعها والخدمة المناسبة إن احتجت مساعدة.</p>
          </div>
        </div>
        {active.length === 0 ? (
          <Alert tone="ok" title="لا توصيات مفتوحة">لم تُطلق إجاباتك أي توصية. راجع التقييم بعد ستة أشهر أو عند أي تغيير جوهري.</Alert>
        ) : (
          [1, 2, 3].map((w) => {
            const items = active.filter((r) => r.wave === w);
            if (!items.length) return null;
            return (
              <section key={w} aria-labelledby={`wave-${w}`} className="rounded-xl border border-line bg-stone/60 p-3 md:p-4">
                <header className="mb-3 flex flex-wrap items-baseline gap-x-3 gap-y-1 px-1">
                  <h3 id={`wave-${w}`} className="text-[18px] font-semibold text-ink">{WAVE_LABEL[w]}</h3>
                  <span className="text-[13.5px] text-muted">{WAVE_HINT[w]} — حتى {fmtDate(waveDueDate(w, computedISO))}</span>
                  <span className="tabular ms-auto text-[13px] text-muted">{items.length} {items.length === 1 ? "توصية" : items.length <= 10 ? "توصيات" : "توصية"}</span>
                </header>
                <ul className="space-y-3">
                  {items.map((r) => <RecCard key={r.id} rec={r} waqfId={b.row.waqfId} mode={mode} />)}
                </ul>
              </section>
            );
          })
        )}
        {parked.length ? (
          <details className="rounded-lg border border-line bg-surface px-4 py-3">
            <summary className="cursor-pointer text-[15px] font-medium text-muted">توصيات معلّقة أو مستبعدة ({parked.length})</summary>
            <ul className="mt-3 space-y-3">{parked.map((r) => <RecCard key={r.id} rec={r} waqfId={b.row.waqfId} mode={mode} />)}</ul>
          </details>
        ) : null}
      </section>

      {/* package + plan */}
      {mode === "full" && (b.pkg || p.canPlan) ? (
        <div className="grid gap-4 lg:grid-cols-2">
          {b.pkg ? (
            <Panel title={<span className="flex items-center gap-2"><Package aria-hidden className="size-5 text-ink" />الباقة المقترحة: {b.pkg.nameAr}</span>}>
              <p className="text-[15px] leading-7">{b.pkg.description}</p>
              <p className="mt-2 text-[14px] text-muted">تغطي {b.pkg.covers} من الخدمات الموصى بها أعلاه، بتكلفة أقل من طلبها منفردة غالبًا.</p>
              <ButtonLink href={`/packages#${b.pkg.code}`} variant="secondary" size="sm" className="mt-3">قارن الباقات</ButtonLink>
            </Panel>
          ) : null}
          {p.canPlan ? (
            <Panel title={<span className="flex items-center gap-2"><Wrench aria-hidden className="size-5 text-ink" />خطة العمل</span>}>
              {b.actionPlan ? (
                <div className="space-y-3">
                  <p className="text-[15px]">أنشأت خطة عمل من هذا التقييم في {fmtDate(b.actionPlan.generatedAt)}. مهامها في سجل الوقف بمواعيد حسب الموجات.</p>
                  <ButtonLink href={b.row.waqfId ? `/app/w/${b.row.waqfId}/tasks` : "/app/tasks"} variant="secondary" size="sm">افتح المهام</ButtonLink>
                </div>
              ) : (
                <div className="space-y-3">
                  <p className="text-[15px] leading-7">حوّل التوصيات المفتوحة إلى مهام في ملف الوقف: موعد الموجة الأولى بعد 30 يومًا، والثانية بعد 90، والثالثة بعد سنة.</p>
                  <ActionPlanForm id={b.row.id} packageCode={b.pkg?.code ?? null} />
                </div>
              )}
            </Panel>
          ) : null}
        </div>
      ) : null}

      {/* strengths & weaknesses */}
      {b.result.strengths.length || b.result.weaknesses.length ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel title={<span className="flex items-center gap-2"><ThumbsUp aria-hidden className="size-5 text-ok" />نقاط القوة ({b.result.strengths.length})</span>}>
            <SWList items={b.result.strengths} empty="لا نقاط قوة واضحة بعد؛ ابدأ بالموجة الأولى." />
          </Panel>
          <Panel title={<span className="flex items-center gap-2"><ThumbsDown aria-hidden className="size-5 text-critical" />نقاط الضعف ({b.result.weaknesses.length})</span>}>
            <SWList items={b.result.weaknesses} empty="لا نقاط ضعف بارزة." />
          </Panel>
        </div>
      ) : null}

      {/* report & sharing */}
      {mode === "full" ? (
        <Panel title="التقرير والمشاركة">
          <div className="grid gap-6 lg:grid-cols-2">
            <div className="space-y-3">
              <p className="text-[15px] leading-7">تقرير PDF يضم الغلاف والملخص والمخطط وجدول المحاور والعلامات والتوصيات والمراجع.</p>
              <a href={`/api/reports/assessment/${b.row.id}`} className="inline-flex h-11 items-center gap-2 rounded-md bg-ink px-4 text-[15px] font-medium text-white hover:bg-ink-hover dark:text-[#0f141c]">
                <FileDown aria-hidden className="size-4" />
                نزّل التقرير PDF
              </a>
            </div>
            <div className="space-y-3">
              <p className="text-[15px] leading-7">رابط قراءة فقط يعرض النتيجة والتوصيات دون إجاباتك التفصيلية أو اسم الوقف.</p>
              {p.canShare ? <ShareControls id={b.row.id} shares={p.shares ?? []} /> : <p className="text-[14px] text-muted">{p.signedIn ? "المشاركة لمن أجرى التقييم أو يملك صلاحية إجرائه." : "سجّل الدخول لإنشاء رابط مشاركة."}</p>}
            </div>
          </div>
        </Panel>
      ) : null}

      {mode === "full" && b.row.kind !== "deep" ? (
        <div className="flex flex-col gap-3 rounded-lg border border-line bg-surface p-4 sm:flex-row sm:items-center">
          <Microscope aria-hidden className="size-6 shrink-0 text-ink" />
          <p className="flex-1 text-[15px] leading-7">تريد رأي مختص؟ التقييم المعمّق يضيف أسئلة أدق، ويراجعه مستشار في وقفك قبل اعتماد النتيجة.</p>
          <ButtonLink href={`/assessment?kind=deep${b.row.waqfId ? `&waqf=${b.row.waqfId}` : ""}`} variant="secondary">ابدأ تقييمًا معمّقًا</ButtonLink>
        </div>
      ) : null}

      <Disclaimer />
    </div>
  );
}

function SWList({ items, empty }: { items: { code: string; text: string; axis: string; reference?: string }[]; empty: string }) {
  if (!items.length) return <p className="text-[14.5px] text-muted">{empty}</p>;
  const shown = items.slice(0, 6);
  const rest = items.slice(6);
  const li = (i: (typeof items)[number]) => (
    <li key={i.code} className="flex gap-3 text-[14.5px] leading-7">
      <span className="mt-0.5 w-16 shrink-0 text-[12.5px] text-muted">{AXIS_SHORT[i.axis] ?? i.axis}</span>
      <span className="min-w-0">{i.text}{i.reference ? <span className="block text-[12.5px] text-muted">{i.reference}</span> : null}</span>
    </li>
  );
  return (
    <div>
      <ul className="space-y-2">{shown.map(li)}</ul>
      {rest.length ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[14px] text-ink">و{rest.length} أخرى</summary>
          <ul className="mt-2 space-y-2">{rest.map(li)}</ul>
        </details>
      ) : null}
    </div>
  );
}

export function Disclaimer() {
  return (
    <aside aria-labelledby="disc-title" className="rounded-lg border border-line bg-surface-2 p-4 text-[14px] leading-7 text-muted md:p-5">
      <h2 id="disc-title" className="mb-1 font-semibold text-text">حدود هذه النتيجة</h2>
      <ul className="list-disc space-y-1 ps-5">
        <li>هذا تشخيص استرشادي، وليس فتوى شرعية ولا رأيًا قانونيًا ملزمًا.</li>
        <li>بُنيت النتيجة على إجاباتك كما أدخلتها، ولم نتحقق منها بمستندات إلا في التقييم المعمّق.</li>
        <li>نذكر لكل ملاحظة مرجعها من الأنظمة واللوائح والأدلة الصادرة عن الهيئة العامة للأوقاف؛ ارجع إلى النص الرسمي عند التطبيق.</li>
        <li>للمراجعة البشرية اختر التقييم المعمّق، أو اطلب استشارة من مختص.</li>
      </ul>
    </aside>
  );
}
