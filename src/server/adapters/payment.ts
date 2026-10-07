import "server-only";
import { randomUUID } from "node:crypto";
import { env } from "../env";

/**
 * Payment gateway adapter. PAYMENT_PROVIDER=sandbox (default) simulates a gateway: the checkout page is
 * inside the platform and clearly labeled as a test environment; no money moves.
 * A live provider (Moyasar, HyperPay, …) plugs in here once a licensed account exists AND the
 * `payments.live` feature flag is on. Until then the live provider refuses to run.
 */
export type Checkout = { provider: string; providerRef: string; url: string };
export type Verification = { status: "paid" | "failed" | "pending"; providerRef: string; method?: string; raw?: Record<string, unknown> };

export interface PaymentProvider {
  name: string;
  createCheckout(p: { invoiceId: string; paymentId: string; amount: string; currency: string; description: string }): Promise<Checkout>;
  verify(p: { providerRef: string; amount: string; testCard?: { number: string; expiry: string; cvc: string } }): Promise<Verification>;
}

/** Card numbers accepted by the sandbox (anything else fails), mirroring common gateway test cards. */
export const SANDBOX_CARDS = { success: "4111111111111111", mada: "4464040000000007", declined: "4000000000000002" };

const sandbox: PaymentProvider = {
  name: "sandbox",
  async createCheckout({ invoiceId, paymentId }) {
    const providerRef = `sbx_${randomUUID().replace(/-/g, "").slice(0, 20)}`;
    return { provider: "sandbox", providerRef, url: `/app/billing/${invoiceId}/pay?payment=${paymentId}` };
  },
  async verify({ providerRef, amount, testCard }) {
    const num = (testCard?.number ?? "").replace(/\D/g, "");
    const okExpiry = /^(0[1-9]|1[0-2])\/\d{2}$/.test(testCard?.expiry ?? "");
    const okCvc = /^\d{3}$/.test(testCard?.cvc ?? "");
    const paid = okExpiry && okCvc && (num === SANDBOX_CARDS.success || num === SANDBOX_CARDS.mada);
    return {
      status: paid ? "paid" : "failed",
      providerRef,
      method: num === SANDBOX_CARDS.mada ? "mada" : "card",
      raw: { sandbox: true, amount, last4: num.slice(-4), at: new Date().toISOString(), reason: paid ? undefined : "declined_test_card" },
    };
  },
};

const live: PaymentProvider = {
  name: "live",
  async createCheckout() {
    throw new Error("Live payment provider not configured");
  },
  async verify() {
    throw new Error("Live payment provider not configured");
  },
};

/** Returns the configured provider. `liveFlagOn` must come from the `payments.live` feature flag. */
export function paymentProvider(liveFlagOn: boolean): PaymentProvider {
  if (env.PAYMENT_PROVIDER === "sandbox" || !env.PAYMENT_PROVIDER) return sandbox;
  if (!liveFlagOn) throw new Error("Payment provider not configured: payments.live is off");
  return live;
}
