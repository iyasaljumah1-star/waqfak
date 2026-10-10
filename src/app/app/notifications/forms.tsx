"use client";

import { useActionState } from "react";
import { Lock } from "lucide-react";
import { FormMessage, SubmitButton } from "@/components/ui/form";
import { initialState } from "@/lib/utils";
import { markAllNotificationsRead, markNotificationRead, saveNotificationPreferences } from "@/server/modules/account/actions";

export function MarkReadButton({ id }: { id: string }) {
  const [, a] = useActionState(markNotificationRead, initialState);
  return (
    <form action={a}>
      <input type="hidden" name="id" value={id} />
      <SubmitButton size="sm" variant="ghost" pendingText="…">علّمه مقروءًا</SubmitButton>
    </form>
  );
}

export function MarkAllReadButton() {
  const [s, a] = useActionState(async () => markAllNotificationsRead(), initialState);
  return (
    <form action={a} className="flex items-center gap-2">
      <SubmitButton size="sm" variant="secondary" pendingText="…">علّم الكل مقروءًا</SubmitButton>
      {s.error ? <span className="text-sm text-critical">{s.error}</span> : null}
    </form>
  );
}

export type PrefRow = { key: string; title: string; locked: boolean; channels: string[]; email: boolean; sms: boolean };

export function PreferencesForm({ rows }: { rows: PrefRow[] }) {
  const [s, a] = useActionState(saveNotificationPreferences, initialState);
  return (
    <form action={a} className="space-y-4">
      <div className="overflow-x-auto">
        <table className="w-full text-[15px]">
          <thead>
            <tr className="border-b border-line text-[13px] text-muted">
              <th scope="col" className="py-2 text-start font-medium">الإشعار</th>
              <th scope="col" className="w-20 py-2 text-center font-medium">البريد</th>
              <th scope="col" className="w-20 py-2 text-center font-medium">رسالة نصية</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-b border-line">
                <th scope="row" className="py-2.5 pe-2 text-start font-normal">
                  {r.title}
                  {r.locked ? (
                    <span className="mt-0.5 flex items-center gap-1 text-[12px] text-muted">
                      <Lock aria-hidden className="size-3" /> إشعار أمني أو نظامي يصلك دائمًا
                    </span>
                  ) : null}
                </th>
                {(["email", "sms"] as const).map((ch) => (
                  <td key={ch} className="py-2.5 text-center">
                    {r.channels.includes(ch) ? (
                      <input
                        type="checkbox"
                        name={`${r.key}:${ch}`}
                        aria-label={`${r.title} — ${ch === "email" ? "البريد" : "رسالة نصية"}`}
                        defaultChecked={r[ch]}
                        disabled={r.locked}
                        className="size-4 accent-[var(--ink)]"
                      />
                    ) : (
                      <span className="text-muted" aria-label="غير متاح">—</span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-muted">كل الإشعارات تبقى محفوظة هنا داخل المنصة. الرسائل خارجها لا تحمل بيانات حساسة، فقط العنوان ورابط الدخول.</p>
      <FormMessage state={s} />
      <SubmitButton>احفظ التفضيلات</SubmitButton>
    </form>
  );
}
