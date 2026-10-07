import { requireAuth } from "@/server/authz/context";
import { logout } from "@/server/modules/auth.actions";
export default async function AppHome() {
  const auth = await requireAuth({ next: "/app" });
  return <main id="main" className="p-10"><p>مرحبًا {auth.user.fullName}</p><form action={logout}><button>خروج</button></form></main>;
}
