import type { Metadata } from "next";
import { SiteFooter, SiteHeader } from "@/components/site/chrome";
import "@/components/site/site.css";

export const metadata: Metadata = {
  openGraph: { locale: "ar_SA", type: "website", siteName: "وقفك" },
  twitter: { card: "summary" },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <SiteHeader />
      <main id="main" data-site="" tabIndex={-1} className="flex-1 focus:outline-none">
        {children}
      </main>
      <SiteFooter />
    </>
  );
}
