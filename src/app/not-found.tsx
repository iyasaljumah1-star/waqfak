import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import { NotFoundBody } from "@/components/site/not-found-body";
import "@/components/site/site.css";

export const metadata: Metadata = { title: "الصفحة غير موجودة", robots: { index: false } };

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <main id="main" data-site="" tabIndex={-1} className="flex-1 focus:outline-none">
        <NotFoundBody />
      </main>
      <SiteFooter />
    </>
  );
}
