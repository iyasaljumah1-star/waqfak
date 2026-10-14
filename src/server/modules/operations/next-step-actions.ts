"use server";

import { z } from "zod";
import { ForbiddenError } from "@/server/authz/context";
import { audit } from "@/server/lib/audit";
import { parseForm, userAction, UserError } from "@/server/modules/_shared";
import { loadRequestCtx } from "@/server/modules/requests/access";
import { advanceStageAction, staffTransition } from "@/server/modules/requests/actions";
import { acceptRequest, verifyIntake } from "@/server/modules/requests/items-actions";
import { approveQuote, sendQuote } from "@/server/modules/commerce/quote-actions";
import { approveContract, sendContract } from "@/server/modules/contracts/actions";
import { approveInvoice, issueInvoice, sendInvoice } from "@/server/modules/billing/actions";
import { approveOutput, generateOutput, submitOutput } from "@/server/modules/outputs/actions";
import type { ActionState } from "@/lib/utils";
import { requestPlan } from "./next-step-server";
import type { RunKey } from "./next-step";

/**
 * «نفّذ الخطوة التالية»: recomputes the request's plan for the caller, checks that the clicked action is still the
 * current one (state fingerprint), then runs the existing action behind it. Nothing is bypassed: the target action
 * re-checks permissions, separation of duties and workflow guards inside its own transaction, and writes its own audit.
 */
const schema = z.object({ id: z.string().uuid(), key: z.string().min(2).max(40), token: z.string().min(3).max(4000) });

type Act = (s: ActionState, fd: FormData) => Promise<ActionState>;

function form(fields: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

export async function runNextStep(_: ActionState, fd: FormData): Promise<ActionState> {
  const r = parseForm(schema, fd);
  if ("state" in r) return r.state;
  const d = r.data;
  let target: { key: RunKey; args: Record<string, string>; resumeTo: string | null; label: string } | null = null;
  const pre = await userAction(async (c) => {
    if (!c.auth.isStaff) throw new ForbiddenError();
    const rc = await loadRequestCtx(c.tx, c.auth, d.id, "staff");
    if (!rc.isAssignee && !rc.isOps && !c.auth.perms.has("staff.quality_review")) throw new ForbiddenError();
    const plan = await requestPlan(c.tx, c.auth, rc);
    const a = plan.primary;
    if (!a || a.kind !== "run" || a.key !== d.key || plan.token !== d.token)
      throw new UserError("تغيّرت حالة الطلب منذ عرض الصفحة، فلم يُنفّذ شيء. حدّث الصفحة لترى الخطوة التالية الحالية.");
    target = { key: a.key, args: a.args ?? {}, resumeTo: plan.snap.resumeTo, label: a.label };
    return { ok: true };
  });
  if (!pre.ok || !target) return pre;
  const t = target as { key: RunKey; args: Record<string, string>; resumeTo: string | null; label: string };
  const id = d.id;
  const run: Record<RunKey, () => [Act, FormData]> = {
    start_triage: () => [staffTransition, form({ id, to: "triage" })],
    verify_intake: () => [verifyIntake, form({ id })],
    accept: () => [acceptRequest, form({ id })],
    approve_quote: () => [approveQuote, form({ quoteId: t.args.quoteId })],
    send_quote: () => [sendQuote, form({ quoteId: t.args.quoteId })],
    approve_contract: () => [approveContract, form({ contractId: t.args.contractId })],
    send_contract: () => [sendContract, form({ contractId: t.args.contractId })],
    issue_invoice: () => [issueInvoice, form({ id, quoteId: t.args.quoteId, termKey: t.args.termKey })],
    approve_invoice: () => [approveInvoice, form({ invoiceId: t.args.invoiceId })],
    send_invoice: () => [sendInvoice, form({ invoiceId: t.args.invoiceId })],
    start_work: () => [staffTransition, form({ id, to: "in_progress" })],
    generate_output: () => [generateOutput, form({ id, outputKey: t.args.outputKey })],
    submit_output: () => [submitOutput, form({ outputId: t.args.outputId, requestId: id })],
    approve_output: () => [approveOutput, form({ outputId: t.args.outputId, requestId: id })],
    complete_stage: () => [advanceStageAction, form({ id })],
    to_quality: () => [staffTransition, form({ id, to: "quality_review" })],
    pass_quality: () => [staffTransition, form({ id, to: "awaiting_client_approval" })],
    close: () => [staffTransition, form({ id, to: "closed" })],
    resume: () => [staffTransition, form({ id, to: t.resumeTo ?? "" })],
  };
  const [fn, body] = run[t.key]();
  const res = await fn({}, body);
  if (res.ok) {
    await userAction(async (c) => {
      await audit(c.tx, { actorUserId: c.auth.user.id, action: "requests.next_step", entityType: "service_request", entityId: id, ip: c.ip, userAgent: c.userAgent, after: { step: t.key, label: t.label } });
    });
    const outputId = (res.data as { outputId?: string } | undefined)?.outputId;
    return { ...res, data: { ...(res.data ?? {}), ...(outputId ? { href: `/admin/requests/${id}/outputs/${outputId}` } : {}) } };
  }
  return res;
}
