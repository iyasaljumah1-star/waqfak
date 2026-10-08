import type { Metadata } from "next";
import Link from "next/link";
import { Container, PageIntro } from "@/components/site/bits";
import { AUDIENCE_LINKS } from "@/components/site/labels";

export const metadata: Metadata = { title: "لمن نخدم", description: "وقفك تخدم الواقف والناظر ومجلس النظارة والمستفيد والجهات الوقفية.", alternates: { canonical: "/for" } };

export default function ForIndex() {
  return (
    <>
      <PageIntro crumbs={[{ label: "لمن نخدم" }]} title="لمن نخدم" lede="لكل طرف في الوقف أسئلته والتزاماته. اختر موقعك لترى ما يخصك من خدمات وأسئلة وقراءات." />
      <Container className="py-10">
        <ul className="divide-y divide-line border-y border-line">
          {AUDIENCE_LINKS.map((a) => (
            <li key={a.href}>
              <Link href={a.href} className="group block py-5">
                <span className="font-naskh text-[1.4rem] font-bold text-ink group-hover:underline group-hover:underline-offset-8">{a.label}</span>
                <span className="mt-1 block text-muted">{a.hint}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Container>
    </>
  );
}
