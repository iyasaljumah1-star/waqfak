import { NextResponse, type NextRequest } from "next/server";

/**
 * Optimistic edge check: requests to the portal or admin without any session cookie get a real HTTP 307 to /login
 * (instead of a streamed client-side redirect). The authoritative check stays in requireAuth()/requireStaff()
 * and in PostgreSQL RLS — a forged or expired cookie passes here and is rejected there.
 */
export default function proxy(req: NextRequest) {
  const has = req.cookies.has("__Host-wqf") || req.cookies.has("wqf_s");
  if (!has) {
    // Absolute URL from the configured public origin (APP_URL), never from the server's bind address.
    const url = new URL("/login", process.env.APP_URL || req.nextUrl.origin);
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/app/:path*", "/admin/:path*"],
};
