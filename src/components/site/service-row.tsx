import Link from "next/link";
import { Badge } from "@/components/ui";
import type { PublicService } from "@/server/modules/public/queries";
import { priceText, SERVICE_AUDIENCE_LABEL } from "./labels";

/** One service as an index row: code, name, summary, price, availability. */
export function ServiceRow({ s }: { s: PublicService }) {
  return (
    <li className="group relative grid gap-x-6 gap-y-1 border-b border-line py-4 sm:grid-cols-[minmax(0,1fr)_200px]">
      <div className="min-w-0">
        <h3 className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[17px] font-semibold leading-7">
          <span className="tabular text-[13px] font-medium text-muted" dir="ltr">{s.code}</span>
          <Link href={`/services/${s.code}`} className="text-text after:absolute after:inset-0 group-hover:text-ink group-hover:underline group-hover:underline-offset-4">
            {s.nameAr}
          </Link>
          {!s.availability.available ? <Badge tone="warn" className="relative">{s.availability.label}</Badge> : null}
        </h3>
        <p className="mt-0.5 text-[15px] leading-7 text-muted">{s.summary}</p>
        {s.audiences.length ? (
          <p className="mt-1 text-[13px] text-muted">
            <span className="sr-only">تناسب: </span>
            {s.audiences.map((a) => SERVICE_AUDIENCE_LABEL[a] ?? a).join("، ")}
          </p>
        ) : null}
      </div>
      <p className={s.basePrice || s.pricingModel === "free" ? "text-[14.5px] font-medium text-text sm:text-end" : "text-[13.5px] text-muted sm:text-end"}>
        <span className="sr-only">السعر: </span>
        {priceText(s.pricingModel, s.basePrice)}
      </p>
    </li>
  );
}
