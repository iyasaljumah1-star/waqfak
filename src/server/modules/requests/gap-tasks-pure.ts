import { ctxField, type ContextBlock } from "./context/types";

/** Which waqf-file records the service reads are missing or out of date, and the task each needs (PURE). */
export function gapTasksFor(blocks: Pick<ContextBlock, "key" | "title" | "status" | "gaps">[]) {
  return blocks
    .filter((b) => b.status === "missing" || b.status === "stale")
    .map((b) => ({
      fieldKey: ctxField(b.key),
      title: b.status === "missing" ? `استكمال «${b.title}» في ملف الوقف` : `تحديث «${b.title}» في ملف الوقف`,
      description: b.gaps.length ? b.gaps.join("\n") : b.status === "missing" ? "لا سجل في ملف الوقف تعتمد عليه الخدمة." : "السجل أقدم من الفترة التي تغطيها الخدمة.",
    }));
}
