import Link from "next/link";
import { CheckCircle2, CircleAlert, CircleDashed, Clock, Upload } from "lucide-react";
import { getAuth, loadWaqfAccess } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { requiredDocumentsChecklist } from "@/server/modules/documents/queries";
import { CHECKLIST_LABEL, CHECKLIST_TONE, type ChecklistState } from "@/server/modules/documents/labels";
import { Badge, Panel } from "@/components/ui";
import { cn } from "@/lib/utils";

const ICON: Record<ChecklistState, typeof CheckCircle2> = {
  ok: CheckCircle2, pending: Clock, expiring: Clock, expired: CircleAlert, partial: CircleDashed, outdated: CircleAlert, due: Clock, missing: CircleAlert,
};
const ICON_CLASS: Record<ChecklistState, string> = {
  ok: "text-ok", pending: "text-warn", expiring: "text-warn", expired: "text-critical", partial: "text-warn", outdated: "text-fine", due: "text-info", missing: "text-critical",
};

/**
 * Required-document checklist for a waqf (deed, registration certificate, nazara deed, ownership deeds,
 * latest financial statements, BO register). Renders nothing without documents.view on the waqf.
 * `uploadHref(type)` builds the upload link; defaults to the documents page with the type preselected.
 */
export async function RequiredDocuments({ waqfId, uploadHref, className }: { waqfId: string; uploadHref?: (docType: string) => string; className?: string }) {
  const auth = await getAuth();
  if (!auth) return null;
  const res = await read(auth, async (tx) => {
    const access = await loadWaqfAccess(tx, auth, waqfId);
    if (!access || !access.perms.has("documents.view")) return null;
    const items = await requiredDocumentsChecklist(tx, waqfId, { userId: auth.user.id, perms: access.perms });
    return { items, canUpload: access.perms.has("documents.upload") };
  });
  if (!res) return null;
  const { items, canUpload } = res;
  const done = items.filter((i) => i.state === "ok").length;
  const base = `/app/w/${waqfId}/documents`;
  const href = uploadHref ?? ((t: string) => `${base}?upload=${t}#upload`);

  return (
    <Panel
      title="الوثائق الأساسية"
      description={done === items.length ? "اكتملت الوثائق الأساسية للوقف." : `${done} من ${items.length} مكتملة. أكمل الناقص ليبقى ملف الوقف جاهزًا للمراجعة.`}
      tight
      className={className}
    >
      <ul className="divide-y divide-line" data-testid="required-docs">
        {items.map((i) => {
          const Icon = ICON[i.state];
          return (
            <li key={i.key} data-state={i.state} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start md:px-5">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <Icon aria-hidden className={cn("mt-0.5 size-5 shrink-0", ICON_CLASS[i.state])} />
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-medium">
                    {i.label}
                    <Badge tone={CHECKLIST_TONE[i.state]} icon={false} className="whitespace-nowrap">{CHECKLIST_LABEL[i.state]}</Badge>
                  </p>
                  <p className="mt-0.5 text-[14px] leading-6 text-muted">{i.detail}</p>
                  {i.state === "missing" ? <p className="text-[13px] leading-6 text-muted">{i.why}</p> : null}
                </div>
              </div>
              <div className="flex shrink-0 flex-wrap items-center gap-3 ps-8 text-[14px] sm:ps-0">
                {i.doc?.visible ? (
                  <Link href={`${base}/${i.doc.id}`} className="text-ink hover:underline">اعرض الوثيقة</Link>
                ) : i.doc ? (
                  <span className="text-muted">مرفوعة بدرجة سرية أعلى من صلاحيتك</span>
                ) : null}
                {canUpload && i.state !== "ok" && i.state !== "pending" ? (
                  <Link href={href(i.key)} className="inline-flex items-center gap-1 font-medium text-ink hover:underline">
                    <Upload aria-hidden className="size-4" /> ارفع
                  </Link>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}
