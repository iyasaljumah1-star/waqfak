import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { eq } from "drizzle-orm";
import { fiqhDossiers, users } from "@/server/db/schema";
import { read } from "@/server/modules/_shared";
import { requireAdmin } from "@/server/modules/admin/guard";
import { authorisedFiqhReviews, FIQH_DECISION_AR, passageStanding, REVIEW_ROLE_AR, type FiqhDecision } from "@/server/knowledge/review";
import { EXCEPTION_AR, KIND_AR, POLARITY_AR, RANK_AR, REG_STANDING_AR, STAGE_AR, type FiqhDossier, type Statement } from "@/server/knowledge/fiqh/types";
import type { ReviewRole } from "@/server/knowledge/policy";
import { recordFiqhDecision } from "@/server/modules/admin/knowledge/actions";
import { Badge, PageHeader, Panel } from "@/components/ui";
import { Select, Textarea } from "@/components/ui/form";
import { EditorForm, EField } from "@/components/admin-editors/editor-form";
import { EditorPage } from "@/components/admin-editors/shell";

export const metadata: Metadata = { title: "ملف بحثي فقهي" };

const DECISIONS = (["approved", "modified", "rejected", "more_research"] as FiqhDecision[]).map((d) => ({ value: d, label: FIQH_DECISION_AR[d] }));
const STANDING_AR = { unreviewed: "غير مراجع", under_review: "قيد المراجعة", approved: "مراجع ومعتمد", rejected: "مرفوض" } as const;
const CONF_AR = { high: "مرتفعة", medium: "متوسطة", low: "منخفضة" } as const;
const COND_AR = { met: "متحقق بالوقائع", unmet: "غير متحقق بالوقائع", unknown: "لم يتبين من الوقائع" } as const;
const APPLIES_AR = { applies: "ينطبق على الواقعة", does_not_apply: "لا ينطبق على الواقعة", unknown: "انطباقه غير متبين" } as const;

/** One element of the dossier, labelled with what it is (owner's order 2026-11-07, §8): quote, author, or engine. */
function Element({ kind, children }: { kind: "quote" | "author" | "engine"; children: React.ReactNode }) {
  const label = kind === "quote" ? "نص منقول" : kind === "author" ? "كلام المؤلف المعاصر (شرح أو تلخيص أو اختيار)" : "تحليل المحرك (ليس مصدرًا)";
  return (
    <div className={kind === "engine" ? "rounded-md border border-dashed border-line px-3 py-2" : "rounded-md border border-line bg-surface-2 px-3 py-2"}>
      <p className="text-[12px] font-medium text-muted">{label}</p>
      <div className="mt-1 text-[14.5px] leading-7">{children}</div>
    </div>
  );
}

function StatementView({ s, standing }: { s: Statement; standing: string }) {
  return (
    <li className="space-y-2 px-4 py-3 md:px-5">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <span className="tabular text-[13px] text-muted">{s.id}</span>
        <Badge tone="info">{KIND_AR[s.kind]}</Badge>
        <Badge tone={s.rank === "mutamad" ? "ok" : s.rank === "other" ? "warn" : "neutral"}>{RANK_AR[s.rank]}</Badge>
        {s.attributedTo ? <span className="text-[13px]">النسبة: {s.attributedTo}</span> : null}
        <span className="text-[13px] text-muted">{s.source.title}{s.source.author ? ` — ${s.source.author}` : ""} — {s.source.locator}</span>
        <Badge tone={standing === "approved" ? "ok" : "warn"}>{STANDING_AR[standing as keyof typeof STANDING_AR] ?? standing}</Badge>
      </div>
      {s.source.flags.length ? <p className="text-[12.5px] text-warn">{s.source.flags.join("؛ ")}</p> : null}
      <Element kind={s.element}><p className="whitespace-pre-wrap">{s.text}</p></Element>
      <Element kind="engine">
        <p>الحكم في النص: {POLARITY_AR[s.polarity]}{s.effective !== s.polarity ? ` — وعلى هذه الوقائع: ${POLARITY_AR[s.effective]} (بالاستثناء)` : ""}. {APPLIES_AR[s.applies]}.</p>
        {s.conditions.length ? <ul className="list-disc ps-5">{s.conditions.map((c, i) => <li key={i}>{c.kind === "exception" ? "استثناء" : "قيد"}: «{c.text}» — {COND_AR[c.status]}{c.byFact ? ` («${c.byFact}»)` : ""}{c.parts?.length ? ` — أجزاؤه (${c.join === "and" ? "لا بد منها كلها" : "يكفي أحدها"}): ${c.parts.map((x) => `«${x.text}» ${COND_AR[x.status]}`).join("، ")}` : ""}</li>)}</ul> : null}
        {s.exceptionStructure && s.exceptionStructure !== "none" ? <p className="text-[13px]">بنية الاستثناء: {EXCEPTION_AR[s.exceptionStructure]}</p> : null}
        {s.unclear ? <p className="text-[13px] text-warn">لم يُستخرج حكم: {s.unclear}</p> : null}
        {s.schoolHoldsContrary ? <p className="text-[13px] text-warn">نص الكتاب أن المذهب خلاف هذا القول، ولم يرد لفظ قول المذهب في المقطع.</p> : null}
        {s.markers.length ? <p className="text-[12.5px] text-muted">الألفاظ التي بُني عليها التصنيف: {s.markers.map((m) => `«${m}»`).join("، ")}</p> : null}
      </Element>
    </li>
  );
}

export default async function FiqhDossierPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin("knowledge.review.sharia", "knowledge.review.legal", "knowledge.review.accounting", "knowledge.review.data", "knowledge.review.investment", "admin.roles");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const row = await read(auth, async (tx) => (await tx.select().from(fiqhDossiers).where(eq(fiqhDossiers.id, id)).limit(1))[0]);
  if (!row) notFound();
  const d = row.dossier as unknown as FiqhDossier;
  const [reviews, standing] = await Promise.all([
    read(auth, (tx) => authorisedFiqhReviews(tx, [id])),
    read(auth, (tx) => passageStanding(tx, d.sources.map((s) => s.chunkId))),
  ]);
  const reviewers = reviews.length ? await read(auth, (tx) => tx.select({ id: users.id, name: users.fullName }).from(users)) : [];
  const nameOf = (u: string) => reviewers.find((r) => r.id === u)?.name ?? u;
  const role = row.reviewRole as ReviewRole;
  const mayDecide = auth.perms.has(`knowledge.review.${role}`) && row.createdBy !== auth.user.id;
  const w = d.weighing;
  const latest = reviews[0];
  return (
    <EditorPage>
      <PageHeader
        title="ملف بحثي فقهي"
        description={d.standing}
        crumbs={[{ href: "/admin", label: "الإدارة" }, { href: "/admin/knowledge/fiqh", label: "البحث الفقهي" }, { label: id.slice(0, 8) }]}
      />
      <Panel title="الحالة">
        <p>المرحلة: {STAGE_AR[d.stage]} · يقرره: {REVIEW_ROLE_AR[role]} · {latest ? `آخر قرار: «${FIQH_DECISION_AR[latest.decision as FiqhDecision]}» من ${nameOf(latest.reviewerUserId)} في ${latest.at.toISOString().slice(0, 16).replace("T", " ")}` : "لم يراجعه مراجع بعد"}</p>
        {latest && (latest.decision === "approved" || latest.decision === "modified") ? <Badge tone="ok">{STAGE_AR.final}</Badge> : <Badge tone="warn">توصية بحثية غير معتمدة</Badge>}
      </Panel>

      <Panel title="المسألة ووقائعها">
        <Element kind="engine">
          <p className="font-medium">{d.issue.question}</p>
          {d.issue.topic ? <p>الباب: {d.issue.topic}{d.issue.head ? ` — المسؤول عنه: «${d.issue.head}»` : ""}</p> : <p>لم يتبين الباب من ألفاظ المسألة.</p>}
          {d.issue.subIssues.length ? <p>المسائل الفرعية: {d.issue.subIssues.join("؛ ")}</p> : null}
          <ul className="mt-1 list-disc ps-5">
            {d.issue.factors.map((f) => <li key={f.key}>{f.question} — {f.status === "given" ? `ثابت: «${f.by}»` : f.status === "assumed" ? `مفترض: «${f.by}»` : f.essential ? "ناقص (مؤثر في الحكم)" : "غير مقدم"}</li>)}
          </ul>
          {d.issue.missing.length ? <p className="mt-1 text-warn">يُطلب استكمال: {d.issue.missing.join("؛ ")}</p> : null}
        </Element>
      </Panel>

      <Panel title={`النصوص المسترجعة (${d.sources.length})`} tight>
        <ul className="divide-y divide-line">
          {d.sources.map((s) => (
            <li key={s.chunkId} className="px-4 py-2 text-[14px] md:px-5">
              <span className="font-medium">{s.title}</span>{s.author ? ` — ${s.author}` : ""} — {s.locator}{s.topic ? ` [${s.topic}]` : ""}
              {s.edition ? <span className="block text-[12.5px] text-muted">{s.edition}</span> : null}
              <span className="block text-[12.5px]">{STANDING_AR[standing.get(s.chunkId) ?? "unreviewed"]}{s.flags.length ? ` · ${s.flags.join("؛ ")}` : ""}</span>
            </li>
          ))}
          {!d.sources.length ? <li className="px-4 py-3 text-muted">لم يُعثر على نص في قاعدة المعرفة.</li> : null}
        </ul>
      </Panel>

      {d.statements.length ? (
        <Panel title={`الأقوال المستخرجة (${d.statements.length})`} tight>
          <ul className="divide-y divide-line">{d.statements.map((s) => <StatementView key={s.id} s={s} standing={standing.get(s.source.chunkId) ?? "unreviewed"} />)}</ul>
        </Panel>
      ) : null}

      {d.comparison ? (
        <Panel title="المقارنة">
          <Element kind="engine">
            {d.comparison.positions.map((p) => <p key={p.polarity}>{POLARITY_AR[p.polarity]}: {p.statementIds.join("، ")} ({p.refCodes.join("، ")})</p>)}
            {d.comparison.divergences.length ? <ul className="mt-1 list-disc ps-5">{d.comparison.divergences.map((x, i) => <li key={i}>{x.a} ↔ {x.b}: {x.note}</li>)}</ul> : <p>لا خلاف بين الأقوال المستخرجة.</p>}
            {d.comparison.contemporaryChecks.length ? <ul className="mt-1 list-disc ps-5">{d.comparison.contemporaryChecks.map((c) => <li key={c.statementId}>«الميسّر» {c.statementId}: {c.note}</li>)}</ul> : null}
            <p className="mt-1">{d.comparison.waqifCondition}</p>
          </Element>
        </Panel>
      ) : null}

      {w ? (
        <Panel title="الترجيح المبدئي">
          <Element kind="engine">
            {w.status === "weighed" ? (
              <>
                <p className="font-medium">يميل التحليل إلى: {POLARITY_AR[w.leaning]} ({w.statementIds.join("، ")}) — درجة الثقة: {CONF_AR[w.confidence]}</p>
                {w.differsFromMutamad ? <p className="text-warn">هذا الميل يخالف القول المعتمد في المذهب ({w.mutamad.join("، ")}) لعدم انطباق قيده على الواقعة.</p> : w.mutamad.length ? <p>القول المعتمد بنص الكتاب: {w.mutamad.join("، ")}</p> : <p>لم يتبين القول المعتمد من النصوص المتاحة.</p>}
                <p>الأسباب: {w.reasons.join(" ")}</p>
                <p>المصادر المؤيدة: {w.supporting.join("؛ ")}</p>
                {w.others.length ? <ul className="list-disc ps-5">{w.others.map((o) => <li key={o.statementId}>{o.statementId}: {o.why}</li>)}</ul> : null}
                {w.uncertainty.length ? <p>مواطن عدم اليقين: {w.uncertainty.join("؛ ")}</p> : null}
                {w.unresolved.length ? <p>لم تحسمه المصادر أو الوقائع: {w.unresolved.join("؛ ")}</p> : null}
              </>
            ) : (
              <>
                <p className="font-medium">{w.status === "needs_facts" ? "لا ترجيح قبل استكمال الوقائع" : w.status === "insufficient" ? "المصادر غير كافية لتكوين نتيجة" : "لم يتحقق ترجيح"}</p>
                <p>{w.reasons.join(" ")}</p>
                {w.unresolved.length ? <p>المطلوب أو غير المحسوم: {w.unresolved.join("؛ ")}</p> : null}
              </>
            )}
            <p className="mt-1">يحتاج إلى مراجعة بشرية: {w.humanReview.join("؛ ")}</p>
          </Element>
        </Panel>
      ) : null}

      {d.regulatory ? (
        <Panel title="المسار النظامي والإرشادي (منفصل عن الترجيح الفقهي)">
          <Element kind="engine">
            {d.regulatory.items.length ? (
              <ul className="list-disc ps-5">
                {d.regulatory.items.map((i) => {
                  const rel = d.regulatory!.relation.find((r) => r.statementId === i.statementId);
                  return <li key={i.statementId}>{i.statementId} — {REG_STANDING_AR[i.standing]}: {i.title} — {i.locator} — {POLARITY_AR[i.polarity]}{rel ? ` — ${rel.note}` : ""}</li>;
                })}
              </ul>
            ) : null}
            <p className="mt-1 font-medium">الأثر المجتمع:</p>
            <ul className="list-disc ps-5">{d.regulatory.combined.map((c, k) => <li key={k}>{c}</li>)}</ul>
            {d.regulatory.legalReview ? <p className="mt-1 text-warn">يحتاج إلى مراجعة نظامية.</p> : null}
          </Element>
        </Panel>
      ) : null}

      <Panel title="حدود هذا الملف"><ul className="list-disc ps-5 text-[14px]">{d.limits.map((l) => <li key={l}>{l}</li>)}</ul></Panel>

      {reviews.length ? (
        <Panel title="سجل المراجعات" tight>
          <ul className="divide-y divide-line">
            {reviews.map((r) => (
              <li key={r.id} className="px-4 py-3 md:px-5">
                <p>«{FIQH_DECISION_AR[r.decision as FiqhDecision]}» — {nameOf(r.reviewerUserId)} ({REVIEW_ROLE_AR[r.reviewerRole as ReviewRole]}) — {r.at.toISOString().slice(0, 16).replace("T", " ")}</p>
                <p className="text-[14px] text-muted">{r.note}</p>
                {r.replacement ? <p className="text-[14px]">الترجيح المعتمد من المراجع: {(r.replacement as { position: string; reasons: string }).position} — {(r.replacement as { position: string; reasons: string }).reasons}</p> : null}
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      {mayDecide ? (
        <Panel title="قرار المراجع">
          <EditorForm action={recordFiqhDecision} submitLabel="سجّل القرار" confirmText="يُسجل القرار باسمك وفي جلستك، ولا يُعدّل بعد ذلك. متابعة؟">
            <input type="hidden" name="dossierId" value={id} />
            <EField label="القرار" name="decision" required><Select name="decision" options={DECISIONS} /></EField>
            <EField label="الأسباب: ما راجعته وما بنيت عليه قرارك" name="note" required><Textarea name="note" /></EField>
            <EField label="عند التعديل: القول الذي تعتمده" name="position"><Textarea name="position" /></EField>
            <EField label="عند التعديل: أسباب ترجيحك" name="reasons"><Textarea name="reasons" /></EField>
            <EField label="عند التعديل: أرقام الأقوال التي تستند إليها (مثل ق1.1، ق2.3)" name="statementIds"><input name="statementIds" className="h-11 w-full rounded border px-3" /></EField>
            <fieldset className="space-y-1">
              <legend className="text-[14px] font-medium">النصوص التي قابلتها بمصادرها وتعتمدها (كل نص على حدة؛ لا يعتمد ذلك بقية المصدر)</legend>
              {d.sources.map((s) => (
                <label key={s.chunkId} className="flex items-start gap-2 text-[14px]">
                  <input type="checkbox" name="passages" value={s.chunkId} className="mt-1 size-4" />
                  <span>{s.title} — {s.locator} ({STANDING_AR[standing.get(s.chunkId) ?? "unreviewed"]})</span>
                </label>
              ))}
            </fieldset>
          </EditorForm>
        </Panel>
      ) : (
        <Panel title="قرار المراجع"><p className="text-muted">{row.createdBy === auth.user.id ? "أعددت هذا الملف؛ لا يراجعه معدّه." : `القرار لحامل صلاحية «${REVIEW_ROLE_AR[role]}». تُمنح من صفحة المستخدمين بدور مراجع.`}</p></Panel>
      )}
    </EditorPage>
  );
}
