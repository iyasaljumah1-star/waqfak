import { Alert, Badge } from "@/components/ui";
import type { OutputBlock, OutputSection } from "@/server/db/schema/operations";
import { PROV_LABEL } from "@/server/modules/outputs/pure";

/** Read-only rendering of an output's sections (the saved draft, an earlier version, or a live preview). */
const PROV_TONE: Record<string, "neutral" | "info" | "seal" | "fine" | "ok"> = { document: "ok", client: "info", system: "neutral", computed: "neutral", assumption: "fine", unverified: "fine", specialist: "seal" };
const Prov = ({ p }: { p?: string }) => (p ? <Badge tone={PROV_TONE[p] ?? "neutral"} icon={false} className="ms-1 align-middle text-[11px]">{PROV_LABEL[p as keyof typeof PROV_LABEL] ?? p}</Badge> : null);

export function Block({ b }: { b: OutputBlock }) {
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

export function SectionView({ s }: { s: OutputSection }) {
  return (
    <section className="space-y-3" data-testid={`section-${s.key}`}>
      <h2 className="text-[17px] font-semibold">{s.title}{s.manual ? <Badge tone="seal" icon={false} className="ms-2">قسم أضافه إنسان</Badge> : null}</h2>
      {s.blocks.map((b, i) => <Block key={i} b={b} />)}
    </section>
  );
}

