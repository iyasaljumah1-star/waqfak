"use client";

import { useId, useRef, useState, type DragEvent, type KeyboardEvent } from "react";
import { useRouter } from "next/navigation";
import { CheckCircle2, FileUp, Loader2, X } from "lucide-react";
import { Button, ProgressBar } from "@/components/ui";
import { cn } from "@/lib/utils";
import { CONF_OPTIONS, DOC_TYPE_OPTIONS, type Confidentiality } from "@/server/modules/documents/labels";

const MAX_BYTES = 15 * 1024 * 1024;
// Mirrors UPLOAD_KINDS in server/adapters/scan.ts (the server re-checks the real type from the bytes).
const EXTS = ["pdf", "png", "jpg", "jpeg", "webp", "docx", "xlsx"];
const ACCEPT = EXTS.map((e) => `.${e}`).join(",");
const TYPES_TEXT = "PDF، صور PNG وJPEG وWebP، Word (docx)، Excel (xlsx)";

export type DocumentUploaderProps = {
  waqfId?: string | null;
  requestId?: string | null;
  link?: { entityType: string; entityId: string };
  /** Fixed document type (hides the type field). */
  docType?: string;
  /** Preselected document type (the field stays editable). */
  defaultDocType?: string;
  defaultTitle?: string;
  confidentiality?: Confidentiality;
  compact?: boolean;
  onUploaded?: (doc: { id: string; title: string }) => void;
  /** Upload a new version of an existing document instead of a new document. */
  documentId?: string;
};

type Phase = { k: "idle" } | { k: "uploading"; pct: number } | { k: "done"; title: string } | { k: "error"; msg: string };

function validate(f: File): string | null {
  const ext = /\.([A-Za-z0-9]+)$/.exec(f.name)?.[1]?.toLowerCase() ?? "";
  if (!EXTS.includes(ext)) return `نوع الملف «${f.name}» غير مقبول. الأنواع المقبولة: ${TYPES_TEXT}.`;
  if (f.size === 0) return "الملف فارغ. اختر ملفًا يحتوي على بيانات.";
  if (f.size > MAX_BYTES) return "حجم الملف أكبر من 15 ميغابايت. اضغط الملف أو قسّمه ثم أعد الرفع.";
  return null;
}

const sizeText = (n: number) => (n < 1024 * 1024 ? `${Math.max(1, Math.round(n / 1024))} ك.ب` : `${(n / 1024 / 1024).toFixed(1)} م.ب`);

export function DocumentUploader(props: DocumentUploaderProps) {
  const { waqfId, requestId, link, docType, defaultDocType, defaultTitle, confidentiality, compact, onUploaded, documentId } = props;
  const router = useRouter();
  const uid = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [phase, setPhase] = useState<Phase>({ k: "idle" });
  const isVersion = !!documentId;
  const showFields = !compact && !isVersion;
  const busy = phase.k === "uploading";

  function pick(f: File | undefined | null) {
    if (!f) return;
    const err = validate(f);
    if (err) {
      setFile(null);
      setPhase({ k: "error", msg: err });
      return;
    }
    setFile(f);
    setPhase({ k: "idle" });
    if (compact) upload(f);
  }

  function upload(f: File | null = file) {
    if (!f || busy) return;
    const fd = new FormData();
    fd.append("file", f, f.name);
    if (waqfId) fd.append("waqfId", waqfId);
    if (requestId) fd.append("requestId", requestId);
    if (documentId) fd.append("documentId", documentId);
    if (link) {
      fd.append("linkEntityType", link.entityType);
      fd.append("linkEntityId", link.entityId);
    }
    if (formRef.current) for (const [k, v] of new FormData(formRef.current).entries()) if (typeof v === "string" && v) fd.set(k, v);
    if (!fd.get("docType") && docType) fd.set("docType", docType);
    if (!fd.get("confidentiality") && confidentiality) fd.set("confidentiality", confidentiality);
    if (!fd.get("title") && defaultTitle) fd.set("title", defaultTitle);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/api/files");
    xhr.responseType = "json";
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) setPhase({ k: "uploading", pct: (e.loaded / e.total) * 100 });
    };
    xhr.onload = () => {
      const body = (xhr.response ?? {}) as { id?: string; title?: string; error?: string };
      if (xhr.status === 201 && body.id) {
        setPhase({ k: "done", title: body.title ?? f.name });
        setFile(null);
        formRef.current?.reset();
        if (inputRef.current) inputRef.current.value = "";
        onUploaded?.({ id: body.id, title: body.title ?? f.name });
        router.refresh();
      } else {
        const msg =
          body.error ??
          (xhr.status === 401 ? "انتهت جلستك. سجّل الدخول ثم أعد الرفع." : xhr.status === 413 ? "حجم الملف أكبر من المسموح (15 ميغابايت)." : "تعذر رفع الملف. أعد المحاولة.");
        setPhase({ k: "error", msg });
        if (xhr.status === 422) router.refresh();
      }
    };
    xhr.onerror = () => setPhase({ k: "error", msg: "انقطع الاتصال أثناء الرفع. تحقق من الشبكة ثم أعد المحاولة." });
    xhr.onabort = () => setPhase({ k: "idle" });
    setPhase({ k: "uploading", pct: 0 });
    xhr.send(fd);
  }

  const onDrop = (e: DragEvent) => {
    e.preventDefault();
    setDrag(false);
    if (busy) return;
    pick(e.dataTransfer.files?.[0]);
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      inputRef.current?.click();
    }
  };

  return (
    <div className="space-y-3">
      {showFields ? (
        <form ref={formRef} onSubmit={(e) => (e.preventDefault(), upload())} className="grid gap-3 sm:grid-cols-2">
          <label className="block space-y-1 sm:col-span-2">
            <span className="text-[14px] font-medium">عنوان الوثيقة</span>
            <input name="title" defaultValue={defaultTitle} maxLength={200} placeholder="يُؤخذ من اسم الملف إن تركته فارغًا" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20" />
          </label>
          {!docType ? (
            <label className="block space-y-1">
              <span className="text-[14px] font-medium">النوع</span>
              <select name="docType" defaultValue={defaultDocType ?? "other"} key={defaultDocType ?? "other"} className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20">
                {DOC_TYPE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
          {!confidentiality ? (
            <label className="block space-y-1">
              <span className="text-[14px] font-medium">درجة السرية</span>
              <select name="confidentiality" defaultValue="internal" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20">
                {CONF_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </label>
          ) : null}
          <label className="block space-y-1">
            <span className="text-[14px] font-medium">رقم الوثيقة <span className="font-normal text-muted">(اختياري)</span></span>
            <input name="number" maxLength={100} dir="auto" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20" />
          </label>
          <label className="block space-y-1">
            <span className="text-[14px] font-medium">تاريخ الانتهاء <span className="font-normal text-muted">(اختياري)</span></span>
            <input name="expiresOn" type="date" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20" />
          </label>
        </form>
      ) : isVersion ? (
        <form ref={formRef} onSubmit={(e) => (e.preventDefault(), upload())}>
          <label className="block space-y-1">
            <span className="text-[14px] font-medium">ملاحظة التغيير <span className="font-normal text-muted">(اختياري)</span></span>
            <input name="changeNote" maxLength={500} placeholder="مثال: نسخة موقّعة" className="block h-11 w-full rounded-md border border-line-strong bg-surface px-3 text-[15px] focus:border-ink focus:outline-none focus:ring-2 focus:ring-ink/20" />
          </label>
        </form>
      ) : null}

      <div
        role="button"
        tabIndex={busy ? -1 : 0}
        aria-label={isVersion ? "اختر ملف النسخة الجديدة أو أفلته هنا" : "اختر ملفًا أو أفلته هنا"}
        aria-describedby={`${uid}-hint`}
        aria-disabled={busy}
        onClick={() => !busy && inputRef.current?.click()}
        onKeyDown={onKey}
        onDragOver={(e) => {
          e.preventDefault();
          if (!busy) setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={onDrop}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center gap-1.5 rounded-lg border-2 border-dashed px-4 text-center transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-ink/40",
          compact ? "py-4" : "py-7",
          drag ? "border-ink bg-ink-soft" : "border-line-strong bg-surface-2/50 hover:border-ink/60",
          busy && "cursor-wait opacity-80",
        )}
      >
        <FileUp aria-hidden className="size-6 text-ink" />
        <p className="text-[15px] font-medium">
          {file ? file.name : isVersion ? "اختر ملف النسخة الجديدة أو أفلته هنا" : "اختر ملفًا أو أفلته هنا"}
        </p>
        <p id={`${uid}-hint`} className="text-[13px] text-muted">
          {file ? sizeText(file.size) : `${TYPES_TEXT} — حتى 15 ميغابايت`}
        </p>
      </div>
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPT}
        className="sr-only"
        tabIndex={-1}
        aria-hidden
        data-testid="document-file-input"
        onChange={(e) => pick(e.target.files?.[0])}
      />

      {phase.k === "uploading" ? (
        <div className="space-y-1" aria-live="polite">
          <ProgressBar value={phase.pct} label="تقدّم الرفع" />
          <p className="flex items-center gap-2 text-[13px] text-muted">
            <Loader2 aria-hidden className="size-3.5 animate-spin" />
            {phase.pct >= 100 ? "اكتمل الإرسال، جارٍ الفحص والتشفير…" : `جارٍ الرفع ${Math.round(phase.pct)}٪`}
          </p>
        </div>
      ) : null}
      {phase.k === "error" ? (
        <p role="alert" className="flex items-start gap-2 rounded-md bg-critical-soft px-3 py-2 text-[14px] text-critical">
          <span className="flex-1">{phase.msg}</span>
          <button type="button" onClick={() => setPhase({ k: "idle" })} aria-label="إخفاء الرسالة" className="shrink-0 rounded p-0.5 hover:bg-critical/10">
            <X aria-hidden className="size-4" />
          </button>
        </p>
      ) : null}
      {phase.k === "done" ? (
        <p role="status" className="flex items-center gap-2 rounded-md bg-ok-soft px-3 py-2 text-[14px] text-ok">
          <CheckCircle2 aria-hidden className="size-4" />
          {isVersion ? "رُفعت النسخة الجديدة وفُحصت وحُفظت مشفّرة." : `رُفعت «${phase.title}» وفُحصت وحُفظت مشفّرة.`}
        </p>
      ) : null}

      {!compact && file && phase.k !== "uploading" ? (
        <div className="flex flex-wrap gap-2">
          <Button type="button" onClick={() => upload()}>{isVersion ? "ارفع النسخة" : "ارفع الوثيقة"}</Button>
          <Button type="button" variant="ghost" onClick={() => (setFile(null), inputRef.current && (inputRef.current.value = ""))}>إلغاء</Button>
        </div>
      ) : null}
    </div>
  );
}
