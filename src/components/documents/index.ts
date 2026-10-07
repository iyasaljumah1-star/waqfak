/**
 * Reusable document components.
 *
 *   <DocumentUploader waqfId={id|null} link={{ entityType, entityId }} docType="lease" confidentiality="confidential" />
 *     client component; POSTs to /api/files (scan + encryption + link). Also: requestId, defaultDocType,
 *     defaultTitle, compact, documentId (new version), onUploaded.
 *   <DocumentList waqfId={id} link={{ entityType, entityId }} allowUpload />   (async server component)
 *     documents of a waqf / request / linked entity that the viewer may see, with view & download links.
 *   <RequiredDocuments waqfId={id} />   (async server component) required-document checklist.
 *
 * Server components may import from "@/components/documents".
 * Client components ("use client") must import from "@/components/documents/uploader": this barrel also
 * re-exports server-only components that cannot be bundled for the browser.
 */
export { DocumentUploader, type DocumentUploaderProps } from "./uploader";
export { DocumentList, type DocumentListProps } from "./list";
export { RequiredDocuments } from "./checklist";
export { ANCHOR_PRIMARY_FIX, ApprovalBadge, ConfBadge, Expiry, Issued } from "./bits";
