import type { Metadata } from "next";
import { PageHeader } from "@/components/ui";
import { requireAuth } from "@/server/authz/context";
import { RegisterWaqfForm } from "./form";

export const metadata: Metadata = { title: "تسجيل وقف قائم" };

export default async function NewWaqfPage() {
  await requireAuth({ next: "/app/waqfs/new" });
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh" }).format(new Date());
  return (
    <div className="max-w-3xl">
      <PageHeader
        title="تسجيل وقف قائم"
        description="لوقف موثّق تديره أو ترتبط به. نفتح له ملفًا، ونحسب فئته والتزاماته النظامية ومواعيدها. لتأسيس وقف لم يوثّق بعد استخدم معالج التأسيس."
        crumbs={[{ href: "/app/waqfs", label: "أوقافي" }, { label: "تسجيل وقف قائم" }]}
      />
      <RegisterWaqfForm today={today} />
    </div>
  );
}
