import type { Metadata } from "next";
import { Suspense } from "react";
import { Logo } from "@/components/brand";
import { AccessNotice, BellLink, MobileAccountFooter, MobileTabs, SideNav, SignedOutGate, UserMenu, WaqfSwitcher, type ShellNavItem } from "@/components/portal/shell";
import { ACCOUNT_NAV, PORTAL_NAV } from "@/config/nav";
import { maskPhone } from "@/server/auth/otp";
import { getAuth, requireAuth } from "@/server/authz/context";
import { roleName } from "@/server/authz/catalog";
import { myWaqfs, unreadCount } from "@/server/modules/portal/queries";

export const metadata: Metadata = { title: { default: "بوابتي", template: "%s | وقفك" } };

const strip = (n: { href: string; label: string; icon: string; mobile?: boolean }): ShellNavItem => ({ href: n.href, label: n.label, icon: n.icon, mobile: n.mobile });

export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  const session = await getAuth();
  // Signed-out visitors: invitation links render on their own (they explain how to sign in); everything else goes to
  // /login?next=<this page>. Layouts cannot read the pathname on the server, so the gate reads it on the client.
  if (!session || (session.user.mfaEnabled && !session.session.mfaVerified)) {
    return (
      <div className="min-h-dvh bg-stone">
        <header className="border-b border-line bg-surface px-4 py-3 md:px-8">
          <Logo href="/" className="[&_svg]:size-8 [&_span]:text-[22px]" />
        </header>
        <main id="main" className="mx-auto w-full max-w-2xl px-4 py-8 md:py-12">
          <SignedOutGate mfaPending={!!session}>{children}</SignedOutGate>
        </main>
      </div>
    );
  }
  const auth = await requireAuth();
  const [waqfs, unread] = await Promise.all([myWaqfs(auth), unreadCount(auth)]);
  const portal = PORTAL_NAV.map(strip);
  const account = ACCOUNT_NAV.map(strip);
  const tabs = portal.filter((n) => n.mobile);
  const rest = portal.filter((n) => !n.mobile);
  const name = auth.user.fullName || "مستخدم وقفك";
  const switcher = waqfs.map((w) => ({
    id: w.id,
    name: w.name,
    number: w.internalNumber,
    href: w.beneficiaryOnly ? `/app/b/${w.id}` : `/app/w/${w.id}`,
    roles: w.roles.map(roleName).join("، "),
  }));

  return (
    <div className="min-h-dvh bg-stone">
      <header className="no-print sticky top-0 z-30 border-b border-line bg-surface">
        <div className="mx-auto flex h-14 max-w-[1440px] items-center gap-2 px-4 md:gap-4 md:px-6">
          <Logo href="/app" className="shrink-0 [&_span]:hidden [&_svg]:size-8 sm:[&_span]:inline sm:[&_span]:text-[22px]" />
          <span aria-hidden className="hidden h-6 w-px bg-line sm:block" />
          <WaqfSwitcher waqfs={switcher} />
          <div className="ms-auto flex items-center gap-1 md:gap-2">
            <BellLink unread={unread} />
            <UserMenu name={name} phone={maskPhone(auth.user.phone)} />
          </div>
        </div>
      </header>
      <div className="mx-auto flex max-w-[1440px]">
        <aside className="no-print sticky top-14 hidden h-[calc(100dvh-3.5rem)] w-64 shrink-0 overflow-y-auto border-e border-line lg:block">
          <SideNav portal={portal} account={account} isStaff={auth.isStaff} userName={name} />
        </aside>
        <main id="main" className="min-w-0 flex-1 px-4 pb-28 pt-6 md:px-8 lg:pb-12 lg:pt-8">
          <Suspense fallback={null}>
            <AccessNotice />
          </Suspense>
          {children}
          <MobileAccountFooter name={name} />
        </main>
      </div>
      <MobileTabs tabs={tabs} rest={rest} account={account} isStaff={auth.isStaff} />
    </div>
  );
}
