"use client";

import { useOptimistic, useState, useTransition } from "react";
import { Check, Lock, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import { setRolePermission } from "@/server/modules/admin/roles/actions";

export type MatrixRole = { key: string; nameAr: string; holders: number };
export type MatrixPerm = { key: string; nameAr: string; domain: string };

const DOMAIN_LABEL: Record<string, string> = {
  waqf: "ملف الوقف", deed: "الوثيقة والشروط", assets: "الأصول", finance: "المالية", beneficiaries: "المستفيدون", governance: "الحوكمة",
  documents: "الوثائق", assessment: "التقييم", requests: "الطلبات والعقود", complaints: "الشكاوى", compliance: "الامتثال", ai: "المساعد الذكي",
  audit: "السجل", reports: "التقارير", admin: "لوحة الإدارة", staff: "أعمال الفريق",
};

type Props = {
  roles: MatrixRole[];
  perms: MatrixPerm[];
  granted: string[];
  locked: Record<string, string>;
  readOnly: Record<string, string>; // roleKey -> reason the viewer cannot edit it
};

export function RoleMatrix({ roles, perms, granted, locked, readOnly }: Props) {
  const [set, apply] = useOptimistic(new Set(granted), (s: Set<string>, op: { cell: string; on: boolean }) => {
    const n = new Set(s);
    if (op.on) n.add(op.cell);
    else n.delete(op.cell);
    return n;
  });
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [focusRole, setFocusRole] = useState(roles[0]?.key ?? "");
  const domains = [...new Set(perms.map((p) => p.domain))];

  const toggle = (roleKey: string, permKey: string) => {
    const cell = `${roleKey}|${permKey}`;
    const on = !set.has(cell);
    start(async () => {
      apply({ cell, on });
      const r = await setRolePermission(roleKey, permKey, on);
      setMsg(r.error ? { ok: false, text: r.error } : { ok: true, text: r.message ?? "تم." });
    });
  };

  const cellState = (roleKey: string, permKey: string) => {
    const cell = `${roleKey}|${permKey}`;
    return { cell, on: set.has(cell), lock: locked[cell] ?? readOnly[roleKey] ?? null };
  };

  const toggleEl = (role: MatrixRole, perm: MatrixPerm, wide?: boolean) => {
    const { on, lock } = cellState(role.key, perm.key);
    const label = `${perm.nameAr} — ${role.nameAr}`;
    return (
      <button
        key={`${role.key}|${perm.key}`}
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={label}
        title={lock ?? label}
        disabled={!!lock}
        onClick={() => toggle(role.key, perm.key)}
        className={cn(
          "inline-flex items-center justify-center rounded-md border transition-colors disabled:cursor-not-allowed",
          wide ? "h-9 w-12" : "size-8",
          on ? "border-ink bg-ink text-white dark:text-[#0f141c]" : "border-line-strong bg-surface text-muted hover:border-ink/60",
          lock && "opacity-60",
        )}
      >
        {lock ? <Lock aria-hidden className="size-3.5" /> : on ? <Check aria-hidden className="size-4" /> : <Minus aria-hidden className="size-3.5" />}
      </button>
    );
  };

  return (
    <div>
      <p aria-live="polite" className={cn("mb-3 min-h-6 text-[15px]", msg?.ok === false ? "text-critical" : "text-ok")}>
        {pending ? <span className="text-muted">جارٍ الحفظ…</span> : msg?.text}
      </p>

      {/* Phones: one role at a time */}
      <div className="md:hidden">
        <label htmlFor="focus-role" className="mb-1 block text-[15px] font-medium">الدور</label>
        <select id="focus-role" value={focusRole} onChange={(e) => setFocusRole(e.target.value)} className="mb-4 h-11 w-full rounded-md border border-line-strong bg-surface px-3">
          {roles.map((r) => <option key={r.key} value={r.key}>{r.nameAr} ({r.holders})</option>)}
        </select>
        {roles.filter((r) => r.key === focusRole).map((role) => (
          <div key={role.key} className="space-y-5">
            {readOnly[role.key] ? <p className="text-[13px] text-muted">{readOnly[role.key]}</p> : null}
            {domains.map((dm) => (
              <section key={dm}>
                <h3 className="mb-1 text-[13px] font-semibold text-muted">{DOMAIN_LABEL[dm] ?? dm}</h3>
                <ul className="divide-y divide-line rounded-lg border border-line bg-surface">
                  {perms.filter((p) => p.domain === dm).map((p) => (
                    <li key={p.key} className="flex items-center justify-between gap-3 px-3 py-2">
                      <span className="min-w-0">
                        <span className="block text-[15px]">{p.nameAr}</span>
                        <span dir="ltr" className="block text-end text-[12px] text-muted">{p.key}</span>
                      </span>
                      {toggleEl(role, p, true)}
                    </li>
                  ))}
                </ul>
              </section>
            ))}
          </div>
        ))}
      </div>

      {/* Desktop: full matrix */}
      <div className="hidden max-h-[75dvh] overflow-auto rounded-lg border border-line bg-surface md:block">
        <table className="border-collapse text-[14px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr>
              <th scope="col" className="sticky start-0 z-20 min-w-64 border-b border-e border-line bg-surface px-3 py-2 text-start font-medium text-muted">الصلاحية</th>
              {roles.map((r) => (
                <th key={r.key} scope="col" className="h-36 border-b border-line px-1 align-bottom font-medium">
                  <span className="mx-auto block w-8 whitespace-nowrap text-start [writing-mode:vertical-rl]" title={`${r.nameAr} — ${r.holders} حامل`}>
                    {r.nameAr}
                    {r.holders ? <span className="text-muted"> ({r.holders})</span> : null}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          {domains.map((dm) => (
            <tbody key={dm}>
              <tr>
                <th colSpan={roles.length + 1} scope="colgroup" className="sticky start-0 bg-surface-2 px-3 py-1.5 text-start text-[13px] font-semibold text-ink">
                  {DOMAIN_LABEL[dm] ?? dm}
                </th>
              </tr>
              {perms.filter((p) => p.domain === dm).map((p) => (
                <tr key={p.key} className="hover:bg-surface-2/60">
                  <th scope="row" className="sticky start-0 border-e border-line bg-surface px-3 py-1 text-start font-normal">
                    <span className="block">{p.nameAr}</span>
                    <span dir="ltr" className="block text-end text-[12px] text-muted">{p.key}</span>
                  </th>
                  {roles.map((r) => (
                    <td key={r.key} className="px-1 py-1 text-center">
                      {toggleEl(r, p)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          ))}
        </table>
      </div>
    </div>
  );
}
