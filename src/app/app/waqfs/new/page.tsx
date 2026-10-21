import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/server/authz/context";
import { RegisterWaqfForm } from "./form";
import { read } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { waqfModeOf } from "@/server/modules/requests/waqf-mode";

export const metadata: Metadata = { title: "تسجيل وقف قائم" };

const TYPE_FROM: Record<string, string> = { general: "public", ahli: "private", mixed: "joint" };
const NAZIR_FROM: Record<string, string> = { waqif: "founder", individual: "individual", board: "board", entity: "legal_entity", none: "vacant" };
const ROLE_FROM: Record<string, string> = { waqif: "founder", nazir: "nazir", board_member: "board_chair" };

export default async function NewWaqfPage({ searchParams }: { searchParams: Promise<{ fromRequest?: string }> }) {
  const sp = await searchParams;
  const auth = await requireAuth({ next: "/app/waqfs/new" });
  // registering a waqf the user described in a request (unregistered waqf): prefill from what they gave there
  let defaults: Record<string, string> | undefined;
  let fromRequest: { id: string; number: string } | undefined;
  if (sp.fromRequest && /^[0-9a-f-]{36}$/i.test(sp.fromRequest)) {
    const rq = await read(auth, async (tx) => {
      try { return await loadRequestCtx(tx, auth, sp.fromRequest!, "client"); } catch { return null; }
    });
    if (rq && rq.isRequester && waqfModeOf(rq.req) === "unregistered") {
      const a = ((rq.req.intake ?? {}) as { answers?: Record<string, unknown> }).answers ?? {};
      const str = (k: string) => (typeof a[k] === "string" ? (a[k] as string) : "");
      defaults = Object.fromEntries(Object.entries({
        name: str("uwName"), deedNo: str("uwDeedNo") || str("deedNo"), nationalUnifiedNumber: /^7\d{9}$/.test(str("uwGaaNumber")) ? str("uwGaaNumber") : "",
        legalType: TYPE_FROM[str("uwType")] ?? "", nazirMode: NAZIR_FROM[str("uwNazirType")] ?? "", myRole: ROLE_FROM[str("capacity")] ?? "",
        fiscalYearEnd: /^\d{2}-\d{2}$/.test(str("uwFiscalYearEnd")) ? str("uwFiscalYearEnd") : "",
      }).filter(([, v]) => v));
      fromRequest = { id: rq.req.id, number: rq.req.number };
    }
  }
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="تسجيل وقف قائم"
        description="لوقف موثّق تديره أو ترتبط به. نفتح له ملفًا، ونحسب فئته والتزاماته النظامية ومواعيدها. لتأسيس وقف لم يوثّق بعد استخدم معالج التأسيس."
        crumbs={[{ href: "/app/waqfs", label: "أوقافي" }, { label: "تسجيل وقف قائم" }]}
      />
      <RegisterWaqfForm today={today} defaults={defaults} fromRequest={fromRequest} />
    </div>
  );
}
