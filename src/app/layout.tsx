import type { Metadata, Viewport } from "next";
import "@fontsource/ibm-plex-sans-arabic/400.css";
import "@fontsource/ibm-plex-sans-arabic/500.css";
import "@fontsource/ibm-plex-sans-arabic/600.css";
import "@fontsource/ibm-plex-sans-arabic/700.css";
import "@fontsource/noto-naskh-arabic/arabic-500.css";
import "@fontsource/noto-naskh-arabic/arabic-700.css";
import "./globals.css";

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
    { media: "(prefers-color-scheme: light)", color: "#1f2e4d" },
    { media: "(prefers-color-scheme: dark)", color: "#171a1f" },
  ],
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ar" dir="rtl" className="h-full">
      <body className="min-h-full flex flex-col antialiased">
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:start-2 focus:z-50 focus:bg-surface focus:px-4 focus:py-2 focus:rounded-md focus:shadow-card">
          تخطَّ إلى المحتوى
        </a>
        {children}
      </body>
    </html>
  );
}
