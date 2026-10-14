import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { FileDown } from "lucide-react";
import { Alert, Badge, PageHeader, Panel } from "@/components/ui";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { ActionForm } from "@/components/requests/forms";
import { fmtDateTime } from "@/lib/utils";
import { requireStaff } from "@/server/authz/context";
import type { OutputBlock, OutputSection } from "@/server/db/schema/operations";
import { approveOutput, generateOutput, returnOutput, saveOutputEdits, submitOutput } from "@/server/modules/outputs/actions";
import { ORIGIN_LABEL, OUTPUT_STATUS_LABEL, OUTPUT_STATUS_TONE, PROV_LABEL } from "@/server/modules/outputs/pure";
import { outputPageData } from "@/server/modules/outputs/queries";

export const metadata: Metadata = { title: "مسودة مخرج" };

const PROV_TONE: Record<string, "neutral" | "info" | "seal" | "fine" | "ok"> = { document: "ok", client: "info", system: "neutral", computed: "neutral", assumption: "fine", unverified: "fine", specialist: "seal" };
const Prov = ({ p }: { p?: string }) => (p ? <Badge tone={PROV_TONE[p] ?? "neutral"} icon={false} className="ms-1 align-middle text-[11px]">{PROV_LABEL[p as keyof typeof PROV_LABEL] ?? p}</Badge> : null);

function Block({ b }: { b: OutputBlock }) {
  switch (b.type) {
    case "para":
      return <p className="whitespace-pre-line text-[15px] leading-8">{b.text}<Prov p={b.prov} /></p>;
    case "facts":
      return (
        <dl className="grid grid-cols-1 gap-x-4 gap-y-1 text-[15px] sm:grid-cols-[minmax(0,14rem)_1fr]">
          {b.rows.map((r, i) => (
            <div key={i} className="contents">
              <dt className="text-muted">{r.label}</dt>
              <dd className="whitespace-pre-line">{r.value}<Prov p={r.prov} />{r.prov === "specialist" && r.ref ? <span className="ms-1 text-[12px] text-muted">(كانت: {r.ref})</span> : null}</dd>
            </div>
          ))}
        </dl>
      );
    case "table":
      return (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[32rem] text-[14px]">
            <thead><tr className="border-b border-line text-start text-muted">{b.head.map((h) => <th key={h} className="px-2 py-1 text-start font-medium">{h}</th>)}</tr></thead>
            <tbody>
              {b.rows.map((r, i) => <tr key={i} className="border-b border-line/60">{r.map((x, j) => <td key={j} className="px-2 py-1 align-top">{x}</td>)}</tr>)}
              {b.total ? <tr className="font-semibold">{b.total.map((x, j) => <td key={j} className="px-2 py-1">{x}</td>)}</tr> : null}
            </tbody>
          </table>
          <p className="mt-1 text-[12px] text-muted"><Prov p={b.prov} />{b.ref ? ` ${b.ref}` : ""}</p>
        </div>
      );
    case "list":
      return <ul className="list-disc space-y-1 ps-5 text-[15px]">{b.items.map((x, i) => <li key={i}>{x.text}<Prov p={x.prov} /></li>)}</ul>;
    case "specialist":
      return b.text.trim()
        ? <div className="rounded-md border-s-4 border-seal bg-seal-soft/30 p-3"><p className="whitespace-pre-line text-[15px] leading-8">{b.text}</p><Prov p="specialist" /></div>
        : <Alert tone="fine" title="يكتبه المختص">{b.prompt}</Alert>;
    case "clause":
      return (
        <div className="rounded-md border border-line p-3" data-testid={`clause-${b.key}`}>
          <p className="font-semibold">{b.n}. {b.title}</p>
          <p className="whitespace-pre-line text-[15px] leading-8">{b.text}</p>
          <p className="mt-1 text-[12px] text-muted"><Prov p={b.text === b.generated ? b.prov : "specialist"} />{b.refs?.length ? ` ${b.refs.join("؛ ")}` : ""}</p>
        </div>
      );
    case "signatures":
      return (
        <table className="w-full text-[14px]">
          <thead><tr className="border-b border-line text-muted"><th className="px-2 py-1 text-start font-medium">الصفة</th><th className="px-2 py-1 text-start font-medium">الاسم</th><th className="px-2 py-1 text-start font-medium">التوقيع</th></tr></thead>
          <tbody>{b.rows.map((r, i) => <tr key={i} className="border-b border-line/60"><td className="px-2 py-2">{r.role}</td><td className="px-2 py-2">{r.name || "—"}</td><td className="px-2 py-2 text-muted">يُوقَّع عند التوثيق</td></tr>)}</tbody>
        </table>
      );
  }
}

function SectionView({ s }: { s: OutputSection }) {
  return (
    <section className="space-y-3" data-testid={`section-${s.key}`}>
      <h2 className="text-[17px] font-semibold">{s.title}{s.manual ? <Badge tone="seal" icon={false} className="ms-2">قسم أضافه إنسان</Badge> : null}</h2>
      {s.blocks.map((b, i) => <Block key={i} b={b} />)}
    </section>
  );
}

const fid = (s: string) => s.replace(/[^a-zA-Z0-9_-]/g, "_");

export default async function OutputPage({ params, searchParams }: { params: Promise<{ id: string; outputId: string }>; searchParams: Promise<{ v?: string; a?: string; b?: string }> }) {
  const { id, outputId } = await params;
  const sp = await searchParams;
  const auth = await requireStaff("admin.access");
  const d = await outputPageData(auth, id, outputId, { v: Number(sp.v) || undefined, a: Number(sp.a) || undefined, b: Number(sp.b) || undefined });
  if (!d) notFound();
  const { rc, o, current, ready } = d;
  const canDeliver = auth.perms.has("staff.deliver") && (rc.isAssignee || rc.isOps);
  const canReview = auth.perms.has("staff.quality_review") || rc.isOps;
  const editable = canDeliver && d.isCurrent && (o.status === "draft" || o.status === "returned");
  const opinion = rc.workflowCode === "opinion" || o.specialty === "sharia";
  const iPrepared = d.preparers.includes(auth.user.id);
  const sections = (current?.sections ?? []).filter((s) => !s.removed);
  const name = (x: string | null | undefined) => (x ? d.names.get(x) ?? "—" : "—");

  return (
    <div className="space-y-6">
      <PageHeader
        crumbs={[{ href: "/admin/requests", label: "الطلبات" }, { href: `/admin/requests/${id}#outputs`, label: rc.req.number }, { label: o.number }]}
        title={o.title}
        description={<span className="flex flex-wrap items-center gap-2"><span dir="ltr" className="tabular">{o.number}</span><Badge tone={OUTPUT_STATUS_TONE[o.status]} icon={false}>{OUTPUT_STATUS_LABEL[o.status]}</Badge><span>{d.formatLabel}</span><span>· {d.specialtyLabel}</span><span className="text-muted">· {d.reviewLabel}</span>{d.delivered ? <Badge tone="ok" icon={false}>مُسلَّم للعميل</Badge> : null}</span>}
        actions={current ? <a href={`/admin/requests/${id}/outputs/${o.id}/pdf?v=${current.version}`} className="inline-flex h-9 items-center gap-1 rounded-md border border-line px-3 text-sm text-ink hover:bg-ink-soft"><FileDown aria-hidden className="size-4" />PDF للنسخة {current.version}</a> : null}
      />

      {o.status === "returned" && o.reviewNote ? <Alert tone="fine" title="أعاده المراجع للتعديل">{o.reviewNote}</Alert> : null}
      {o.status === "approved" ? <Alert tone="ok" title={`معتمد — النسخة ${o.approvedVersion}`}>اعتمده {name(o.approvedBy)} {o.approvedAt ? fmtDateTime(o.approvedAt) : ""}{o.selfApproved ? " (اعتماد ذاتي من مدير مخوّل وفق سياسة المخرج)" : ""}. يظهر للعميل بعد مراجعة الجودة وإرسال الطلب له.</Alert> : null}
      {!d.isCurrent ? <Alert tone="info" title={`تعرض النسخة ${current?.version} (ليست الحالية)`}><Link className="text-ink underline" href={`/admin/requests/${id}/outputs/${o.id}`}>اعرض النسخة الحالية</Link></Alert> : null}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div className="min-w-0 space-y-4">
          {ready && (ready.blocking.length || ready.unwritten.length || ready.warnings.length) ? (
            <Panel title="ما يلزم قبل الاعتماد" description="النواقص الجوهرية والأجزاء التي يكتبها المختص تمنع الإرسال للمراجعة والاعتماد.">
              <ul className="space-y-1 text-[15px]" data-testid="output-gaps">
                {ready.blocking.map((g) => <li key={g.key} className="text-critical">● {g.label}{g.hint ? <span className="text-muted"> — {g.hint}</span> : null}</li>)}
                {ready.unwritten.map((u, i) => <li key={i} className="text-critical">● لم يُكتب: {u.section}</li>)}
                {ready.warnings.map((g) => <li key={g.key} className="text-fine">● {g.label}{g.hint ? <span className="text-muted"> — {g.hint}</span> : null}</li>)}
              </ul>
            </Panel>
          ) : current ? <Alert tone="ok" title="لا نواقص في هذه النسخة" /> : null}

          {d.diff ? (
            <Panel title={`مقارنة النسخة ${d.diff.a} بالنسخة ${d.diff.b}`}>
              <ul className="space-y-3" data-testid="output-diff">
                {d.diff.rows.filter((r) => r.change !== "same").map((r) => (
                  <li key={r.key} className="rounded-md border border-line p-2">
                    <p className="font-medium">{r.title} <Badge tone={r.change === "added" ? "ok" : r.change === "removed" ? "critical" : "info"} icon={false}>{r.change === "added" ? "أضيف" : r.change === "removed" ? "حُذف" : "تغيّر"}</Badge></p>
                    <div className="mt-1 grid gap-2 text-[13px] sm:grid-cols-2">
                      <pre className="whitespace-pre-wrap rounded bg-surface-2 p-2 font-sans">{r.before ?? "—"}</pre>
                      <pre className="whitespace-pre-wrap rounded bg-ink-soft/40 p-2 font-sans">{r.after ?? "—"}</pre>
                    </div>
                  </li>
                ))}
                {!d.diff.rows.some((r) => r.change !== "same") ? <li className="text-muted">لا فروق في المحتوى.</li> : null}
              </ul>
            </Panel>
          ) : null}

          <Panel title={current ? `المسودة — النسخة ${current.version} (${ORIGIN_LABEL[current.origin]})` : "لا مسودة"}>
            {current ? <div className="space-y-6">{sections.map((s) => <SectionView key={s.key} s={s} />)}</div> : <p className="text-muted">لم تُعدّ مسودة بعد.</p>}
          </Panel>

          {editable && current ? (
            <Panel id="edit" title="عدّل المسودة" description="كل حفظ ينشئ نسخة جديدة، وتبقى السابقة في السجل. البيانات المعدّلة تُوسم «كتبه المختص» مع قيمتها الأصلية.">
              <ActionForm key={current.version} action={saveOutputEdits} hidden={{ outputId: o.id, requestId: id, baseVersion: String(current.version) }} submit="احفظ نسخة جديدة">
                {sections.map((s) => {
                  let si = 0;
                  return (
                    <fieldset key={s.key} className="space-y-3 rounded-lg border border-line p-3">
                      <legend className="px-1 font-medium">{s.title}</legend>
                      {s.blocks.map((b, bi) => {
                        if (b.type === "clause") {
                          const k = `clause:${s.key}:${b.key}`;
                          return <Field key={k} label={`${b.n}. ${b.title}`} name={fid(k)} hint={b.text !== b.generated ? "معدّل يدويًا: يبقى نصك عند إعادة التوليد." : undefined}><Textarea id={fid(k)} name={k} defaultValue={b.text} className="min-h-20" /></Field>;
                        }
                        if (b.type === "specialist") {
                          const k = `spec:${s.key}:${si++}`;
                          return <Field key={k} label={b.prompt} name={fid(k)}><Textarea id={fid(k)} name={k} defaultValue={b.text} className="min-h-32" /></Field>;
                        }
                        if (b.type === "facts") {
                          return (
                            <details key={bi}>
                              <summary className="cursor-pointer text-[14px] text-ink">صحّح البيانات ({b.rows.length})</summary>
                              <div className="mt-2 grid gap-2 sm:grid-cols-2">
                                {b.rows.map((r, ri) => {
                                  const k = `fact:${s.key}:${bi}:${ri}`;
                                  return <Field key={k} label={r.label} name={fid(k)}><Input id={fid(k)} name={k} defaultValue={r.value} /></Field>;
                                })}
                              </div>
                            </details>
                          );
                        }
                        return null;
                      })}
                      <Field label="أضف فقرة لهذا القسم (اختياري)" name={fid(`note:${s.key}`)}><Textarea id={fid(`note:${s.key}`)} name={`note:${s.key}`} className="min-h-16" /></Field>
                      {!s.required ? <Checkbox name={`drop:${s.key}`} label="احذف هذا القسم (لا ينطبق)" /> : null}
                    </fieldset>
                  );
                })}
                <fieldset className="space-y-3 rounded-lg border border-dashed border-line p-3">
                  <legend className="px-1 font-medium">قسم جديد (اختياري)</legend>
                  <Field label="عنوان القسم" name="new_title"><Input name="new_title" /></Field>
                  <Field label="نص القسم" name="new_body"><Textarea name="new_body" className="min-h-24" /></Field>
                </fieldset>
                <Field label="وصف التعديل (يظهر في سجل النسخ)" name="note"><Input name="note" /></Field>
              </ActionForm>
            </Panel>
          ) : null}
        </div>

        <aside className="min-w-0 space-y-4">
          <Panel title="الإجراءات">
            <div className="space-y-3">
              {canDeliver && d.isCurrent && (o.status === "draft" || o.status === "returned") ? (
                <>
                  <ActionForm action={submitOutput} hidden={{ outputId: o.id, requestId: id }} submit="أرسلها للمراجعة والاعتماد" size="sm" />
                  <ActionForm action={generateOutput} hidden={{ id, outputKey: o.outputKey }} submit="أعد التوليد من البيانات الحالية" size="sm" variant="secondary">
                    {current?.origin === "edited" ? <Checkbox name="confirm" label="أؤكد إعادة التوليد: تبقى النسخة الحالية في السجل، وتُنقل النصوص المكتوبة والبيانات المصححة إلى النسخة الجديدة." /> : null}
                  </ActionForm>
                </>
              ) : null}
              {o.status === "in_review" && canReview ? (
                <>
                  {iPrepared ? <p className="text-[13px] text-muted">{o.reviewPolicy === "independent" ? "أنت ممن أعدّوا هذا المخرج، ويتطلب اعتمادًا مستقلًا من زميل." : rc.isOps ? "أنت ممن أعدّوا هذا المخرج؛ اعتمادك يُسجَّل اعتمادًا ذاتيًا وفق سياسته." : "اعتماد المعدّ لمخرجه للمدير المخوّل فقط."}</p> : null}
                  <ActionForm action={approveOutput} hidden={{ outputId: o.id, requestId: id }} submit="اعتمد المخرج" size="sm" variant="seal">
                    {opinion ? <Field label="التوقيع: اسم المستشار وصفته" name="signedBy" required><Input name="signedBy" required minLength={5} /></Field> : null}
                  </ActionForm>
                  <ActionForm action={returnOutput} hidden={{ outputId: o.id, requestId: id }} submit="أعده للتعديل" size="sm" variant="secondary">
                    <Field label="ما يلزم تعديله" name="retnote" required><Textarea id="retnote" name="note" required minLength={5} className="min-h-16" /></Field>
                  </ActionForm>
                </>
              ) : null}
              <Link href={`/admin/requests/${id}#outputs`} className="block text-[14px] text-ink hover:underline">العودة إلى الطلب</Link>
            </div>
          </Panel>
          <Panel title="النسخ" description="لا تُمحى نسخة. قارن أي نسختين.">
            <ol className="space-y-2 text-[14px]" data-testid="output-versions">
              {d.versions.map((v) => (
                <li key={v.version} className="rounded-md border border-line p-2">
                  <p className="flex flex-wrap items-center gap-1">
                    <Link className="font-medium text-ink hover:underline" href={`/admin/requests/${id}/outputs/${o.id}?v=${v.version}`}>النسخة {v.version}</Link>
                    <Badge tone={v.origin === "edited" ? "seal" : "neutral"} icon={false}>{ORIGIN_LABEL[v.origin]}</Badge>
                    {o.approvedVersion === v.version ? <Badge tone="ok" icon={false}>المعتمدة</Badge> : null}
                  </p>
                  <p className="text-[12px] text-muted">{name(v.createdBy)} · {fmtDateTime(v.createdAt)}{v.note ? ` — ${v.note}` : ""}</p>
                  {v.basedOn ? <Link className="text-[12px] text-ink hover:underline" href={`/admin/requests/${id}/outputs/${o.id}?a=${v.basedOn}&b=${v.version}`}>قارنها بالنسخة {v.basedOn}</Link> : null}
                </li>
              ))}
            </ol>
          </Panel>
          {current?.sources.length ? (
            <Panel title="المراجع">
              <ul className="space-y-1 text-[13px]">{current.sources.map((x) => <li key={x.code}>{x.label} <span className="text-muted">({x.status === "verified" ? "من ملفات المشروع" : x.status === "pending_verification" ? "بانتظار التحقق" : "تعريف داخلي"})</span></li>)}</ul>
            </Panel>
          ) : null}
        </aside>
      </div>
    </div>
  );
}
