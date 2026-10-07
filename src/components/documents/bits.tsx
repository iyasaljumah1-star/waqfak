import { Lock } from "lucide-react";
import { Badge } from "@/components/ui";
import { daysUntil, fmtBoth, relDays } from "@/lib/utils";
import { APPROVAL_LABEL, APPROVAL_TONE, CONF_LABEL, CONF_TONE, EXPIRING_SOON_DAYS, expiryTone, type Confidentiality } from "@/server/modules/documents/labels";

export function ConfBadge({ c }: { c: Confidentiality }) {
  return (
    <Badge tone={CONF_TONE[c]} icon={false} className="whitespace-nowrap">
      {c !== "internal" ? <Lock aria-hidden className="size-3" /> : null}
      {CONF_LABEL[c]}
    </Badge>
  );
}

export function ApprovalBadge({ s }: { s: string }) {
  return <Badge tone={APPROVAL_TONE[s] ?? "neutral"} icon={s === "approved"} className="whitespace-nowrap">{APPROVAL_LABEL[s] ?? s}</Badge>;
}

/** Expiry in both calendars with a relative badge: warn within 60 days, critical once expired. */
export function Expiry({ on }: { on: string | null }) {
  if (!on) return <span className="whitespace-nowrap text-muted">لا تنتهي</span>;
  const d = daysUntil(on);
  const tone = expiryTone(d);
  return (
    <span className="flex flex-col items-start gap-1">
      <span className="text-[14px]">{fmtBoth(on)}</span>
      {d !== null && d <= EXPIRING_SOON_DAYS && tone ? <Badge tone={tone} className="whitespace-nowrap">{d < 0 ? "منتهية" : relDays(on)}</Badge> : null}
    </span>
  );
}

export function Issued({ on, hijri }: { on: string | null; hijri: string | null }) {
  if (!on && !hijri) return <span className="text-muted">—</span>;
  return (
    <span className="text-[14px]">
      {on ? fmtBoth(on) : null}
      {hijri ? <span className="block text-[13px] text-muted">هجري: <bdi dir="ltr">{hijri}</bdi> هـ</span> : null}
    </span>
  );
}

/**
 * Workaround: globals.css sets `a { color: inherit }` outside a cascade layer, which beats Tailwind's
 * `text-white` on <a> styled as a primary button. Append to buttonClass("primary") on anchors until fixed upstream.
 */
export const ANCHOR_PRIMARY_FIX = "text-white! dark:text-[#0f141c]!";
