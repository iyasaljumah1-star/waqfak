import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import "./globals.css";

// Brand type system — Thmanyah family (original, unmodified files), bundled by next/font as hashed self-hosted assets:
//   Sans          → interface: navigation, forms, buttons, tables, body copy
//   Serif Display → headlines: page titles, hero, section heads, the wordmark
//   Serif Text    → long reading: library articles, deed drafts, minutes, contracts, quotes
const thmanyah = localFont({
  src: [
    { path: "./fonts/thmanyahsans-Light.otf", weight: "300", style: "normal" },
    { path: "./fonts/thmanyahsans-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/thmanyahsans-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/thmanyahsans-Bold.otf", weight: "700", style: "normal" },
    { path: "./fonts/thmanyahsans-Black.otf", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah",
  display: "swap",
  fallback: ["Tahoma", "Segoe UI", "system-ui", "sans-serif"],
});

// Serif faces load on demand (no preload): only pages that use them download them.
const thmanyahDisplay = localFont({
  src: [
    { path: "./fonts/thmanyahserifdisplay-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/thmanyahserifdisplay-Bold.otf", weight: "700", style: "normal" },
    { path: "./fonts/thmanyahserifdisplay-Black.otf", weight: "900", style: "normal" },
  ],
  variable: "--font-thmanyah-display",
  display: "swap",
  preload: false,
  fallback: ["Tahoma", "serif"],
});

const thmanyahText = localFont({
  src: [
    { path: "./fonts/thmanyahseriftext-Regular.otf", weight: "400", style: "normal" },
    { path: "./fonts/thmanyahseriftext-Medium.otf", weight: "500", style: "normal" },
    { path: "./fonts/thmanyahseriftext-Bold.otf", weight: "700", style: "normal" },
  ],
  variable: "--font-thmanyah-text",
  display: "swap",
  preload: false,
  fallback: ["Tahoma", "serif"],
});

// Every page reads the session or the database at request time; nothing is prerendered at build (no DB during image builds).
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  metadataBase: new URL(process.env.APP_URL ?? "http://localhost:3000"),
  title: { default: "وقفك — منصة امتثال ونظارة وتمكين مؤسسي للأوقاف", template: "%s | وقفك" },
  description: "قيّم وقفك، واعرف التزاماته النظامية ومواعيدها، وابنِ له ملفًا حيًا يحفظ شرط واقفه. منصة سعودية متخصصة في الأوقاف.",
  applicationName: "وقفك",
  manifest: "/manifest.webmanifest",
  openGraph: { locale: "ar_SA", type: "website", siteName: "وقفك" },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#0e4d3c" },
    { media: "(prefers-color-scheme: dark)", color: "#111c18" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className={`h-full ${thmanyah.variable} ${thmanyahDisplay.variable} ${thmanyahText.variable}`}>
      <body className="min-h-full flex flex-col antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:bg-surface focus:px-4 focus:py-2 focus:rounded-md focus:shadow-card">
          تخطَّ إلى المحتوى
        </a>
        {children}
      </body>
    </html>
  );
}
