import Link from "next/link";
import { Download, Eye, FileText, Lock } from "lucide-react";
import { getAuth, loadWaqfAccess } from "@/server/authz/context";
import { read } from "@/server/modules/_shared";
import { listDocumentsFor } from "@/server/modules/documents/queries";
import { canSeeDocumentSync, isRequestParty, type DocAccess } from "@/server/modules/documents/service";
import { CONF_LABEL, CONF_TONE, STATUS_LABEL, docTypeLabel } from "@/server/modules/documents/labels";
import { Badge } from "@/components/ui";
import { fmtDate } from "@/lib/utils";
import { DocumentUploader } from "./uploader";

export type DocumentListProps = {
  waqfId?: string | null;
  requestId?: string | null;
  link?: { entityType: string; entityId: string };
  emptyText?: string;
  allowUpload?: boolean;
};

/** Documents visible to the current user for a waqf, request or linked entity, with view/download links. */
export async function DocumentList({ waqfId, requestId, link, emptyText, allowUpload }: DocumentListProps) {
  const auth = await getAuth();
  if (!auth) return null;
  const { docs, canUpload, detailBase } = await read(auth, async (tx) => {
    const rows = await listDocumentsFor(tx, { waqfId, requestId, link });
    const waqfAccess = new Map<string, Set<string>>();
    const ensure = async (id: string) => {
      if (!waqfAccess.has(id)) waqfAccess.set(id, (await loadWaqfAccess(tx, auth, id))?.perms ?? new Set());
      return waqfAccess.get(id)!;
    };
    const party = requestId ? (await isRequestParty(tx, auth, requestId)).party : false;
    const visible = [];
    for (const d of rows) {
      const access: DocAccess = {
        userId: auth.user.id,
        perms: d.waqfId ? await ensure(d.waqfId) : auth.perms,
        requestParty: d.requestId ? (d.requestId === requestId ? party : (await isRequestParty(tx, auth, d.requestId)).party) : false,
        staff: auth.isStaff,
      };
      if (canSeeDocumentSync(access, d)) visible.push({ ...d, canOpenDetail: !!d.waqfId && access.perms.has("documents.view") });
    }
    let canUpload = false;
    if (allowUpload) {
      if (waqfId) canUpload = (await ensure(waqfId)).has("documents.upload") || party;
      else if (requestId) canUpload = party;
      else canUpload = true; // personal document
    }
    return { docs: visible, canUpload, detailBase: waqfId ? `/app/w/${waqfId}/documents` : null };
  });

  return (
    <div className="space-y-4">
      {docs.length ? (
        <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
          {docs.map((d) => {
            const servable = d.status === "active" || d.status === "archived";
            const href = d.canOpenDetail ? `${detailBase ?? `/app/w/${d.waqfId}/documents`}/${d.id}` : null;
            return (
              <li key={d.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-start gap-3">
                  <FileText aria-hidden className="mt-1 size-5 shrink-0 text-muted" />
                  <div className="min-w-0">
                    {href ? (
                      <Link href={href} className="font-medium text-ink hover:underline">{d.title}</Link>
                    ) : (
                      <p className="font-medium">{d.title}</p>
                    )}
                    <p className="text-[13px] text-muted">
                      {docTypeLabel(d.docType)} · {fmtDate(d.createdAt)} · النسخة {d.currentVersion}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-2 sm:justify-end">
                  {d.confidentiality !== "internal" ? (
                    <Badge tone={CONF_TONE[d.confidentiality]} icon={false}>
                      <Lock aria-hidden className="size-3" />
                      {CONF_LABEL[d.confidentiality]}
                    </Badge>
                  ) : null}
                  {servable ? (
                    <>
                      <a href={`/api/files/${d.id}?disposition=inline`} target="_blank" rel="noopener" className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-ink-soft">
                        <Eye aria-hidden className="size-4" /> عرض
                      </a>
                      <a href={`/api/files/${d.id}?disposition=attachment`} className="inline-flex h-8 items-center gap-1 rounded-md px-2 text-sm text-ink hover:bg-ink-soft">
                        <Download aria-hidden className="size-4" /> تنزيل
                      </a>
                    </>
                  ) : (
                    <Badge tone={d.status === "rejected" ? "critical" : "warn"}>{STATUS_LABEL[d.status]}</Badge>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      ) : (
        <p className="rounded-lg border border-dashed border-line-strong px-4 py-6 text-center text-sm text-muted">{emptyText ?? "لا توجد وثائق بعد."}</p>
      )}
      {canUpload ? <DocumentUploader waqfId={waqfId} requestId={requestId} link={link} compact /> : null}
    </div>
  );
}
