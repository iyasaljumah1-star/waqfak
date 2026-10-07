import { Logo, Seal } from "@/components/brand";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-dvh lg:grid-cols-[1fr_minmax(420px,520px)]">
      <aside className="relative hidden overflow-hidden bg-ink text-white lg:flex lg:flex-col lg:justify-between lg:p-12 dark:bg-[#0f1520]">
        <Logo className="text-white [&_span]:text-white" />
        <div className="max-w-md">
          <p className="font-naskh text-[2rem] font-bold leading-[1.6]">
            وقفٌ يُحفظ شرطه، ويُعرف ما عليه، ويبقى بعد صاحبه.
          </p>
          <p className="mt-4 text-white/75">
            حسابك في وقفك يفتح لك ملفًا حيًا لكل وقف ترتبط به: وثيقته وشروطه وأصوله ومستفيدوه والتزاماته النظامية بمواعيدها.
          </p>
        </div>
        <Seal className="absolute -bottom-24 -start-24 size-[420px] text-white/[0.06]" />
        <p className="text-sm text-white/60">بياناتك مشفّرة ومحفوظة داخل المملكة.</p>
      </aside>
      <main id="main" className="flex flex-col px-5 py-8 sm:px-10">
        <div className="lg:hidden">
          <Logo />
        </div>
        <div className="mx-auto flex w-full max-w-md flex-1 flex-col justify-center py-10">{children}</div>
      </main>
    </div>
  );
}
