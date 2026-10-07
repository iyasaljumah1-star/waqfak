import "server-only";
import { createHmac } from "node:crypto";
import { cookies } from "next/headers";
import { cookieSecure, env } from "../env";
import { safeEqual } from "../lib/crypto";

/** Short-lived, signed, httpOnly cookie that carries an in-progress OTP flow between pages. */
const NAME = "wqf_flow";
export type Flow = { challengeId: string; target: string; purpose: "signup" | "login" | "recover" | "step_up"; next?: string; userId?: string; demoCode?: string; exp: number };

const sign = (payload: string) => createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");

export async function setFlow(f: Omit<Flow, "exp">) {
  const payload = Buffer.from(JSON.stringify({ ...f, exp: Date.now() + 10 * 60_000 })).toString("base64url");
  (await cookies()).set(NAME, `${payload}.${sign(payload)}`, { httpOnly: true, secure: cookieSecure, sameSite: "lax", path: "/", maxAge: 600 });
}

export async function getFlow(): Promise<Flow | null> {
  const raw = (await cookies()).get(NAME)?.value;
  if (!raw) return null;
  const [payload, sig] = raw.split(".");
  if (!payload || !sig || !safeEqual(sign(payload), sig)) return null;
  const f = JSON.parse(Buffer.from(payload, "base64url").toString()) as Flow;
  return f.exp > Date.now() ? f : null;
}

export async function clearFlow() {
  (await cookies()).delete(NAME);
}
