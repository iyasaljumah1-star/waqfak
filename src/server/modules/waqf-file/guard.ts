import "server-only";
import type { ZodType } from "zod";
import type { Tx } from "../../db";
import { waqfs, waqfTimelineEvents } from "../../db/schema";
import type { Permission } from "../../authz/catalog";
import { emitWaqfEvent } from "../compliance/events";
import { parseForm, UserError, waqfAction, type WaqfCtx } from "../_shared";
import type { ActionState } from "@/lib/utils";
import { todayIso } from "./form";

export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/**
 * Standard waqf-file mutation: reads `waqfId` from the form, validates the rest with `schema`,
 * then runs `fn` inside waqfAction (auth + RLS transaction + permission check). Revalidates the section path.
 */
export async function fileAction<T>(
  fd: FormData,
  schema: ZodType<T>,
  perm: Permission,
  fn: (c: WaqfCtx, d: T) => Promise<ActionState | void>,
  section: string | ((waqfId: string) => string[]),
): Promise<ActionState> {
  const waqfId = fd.get("waqfId");
  if (!isUuid(waqfId)) return { error: "الوقف غير محدد. حدّث الصفحة وأعد المحاولة." };
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  const paths = typeof section === "function" ? section(waqfId) : [`/app/w/${waqfId}/${section}`, `/app/w/${waqfId}`];
  return waqfAction(waqfId, perm, (c) => fn(c, r.data), paths);
}

type Waqf = typeof waqfs.$inferSelect;

/** OB-REG-02: a material change (assets, nazara, beneficiaries) on a registered waqf must be reported to GAA. */
export async function materialChange(tx: Tx, w: Waqf, kind: "assets" | "nazara" | "beneficiaries" | "classification", actorUserId: string, meta: Record<string, unknown> = {}) {
  if (!w.registeredOn) return;
  await emitWaqfEvent(tx, { waqfId: w.id, event: "material_change", date: todayIso(), meta: { kind, ...meta }, actorUserId });
}

export async function addTimeline(tx: Tx, w: Pick<Waqf, "id" | "stage">, userId: string, type: string, title: string, details?: string | null, occurredOn?: string) {
  await tx.insert(waqfTimelineEvents).values({ waqfId: w.id, type, title, details: details ?? null, occurredOn: occurredOn ?? todayIso(), stage: w.stage, createdBy: userId });
}

export function assertFound<T>(row: T | undefined | null, msg = "لم نجد السجل المطلوب في هذا الوقف."): T {
  if (!row) throw new UserError(msg);
  return row;
}
