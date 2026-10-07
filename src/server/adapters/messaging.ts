import "server-only";
import { withSystem } from "../db";
import { outboxMessages } from "../db/schema";
import { env } from "../env";

/**
 * Messaging adapters. Every message is first written to the outbox (audit + retry).
 * Providers are plugged in by setting SMS_PROVIDER / EMAIL_PROVIDER and their credentials.
 * Until a provider is connected, "outbox" mode keeps messages visible in Admin → الرسائل الصادرة.
 */
export interface SmsProvider { name: string; send(to: string, body: string): Promise<{ ref?: string }> }
export interface EmailProvider { name: string; send(to: string, subject: string, body: string): Promise<{ ref?: string }> }

const outboxSms: SmsProvider = { name: "outbox", send: async () => ({}) };
const outboxEmail: EmailProvider = { name: "outbox", send: async () => ({}) };

function smsProvider(): SmsProvider {
  switch (env.SMS_PROVIDER) {
    // case "unifonic": return unifonicProvider(...)   ← connect when credentials are provided
    default:
      return outboxSms;
  }
}
function emailProvider(): EmailProvider {
  switch (env.EMAIL_PROVIDER) {
    default:
      return outboxEmail;
  }
}

export async function sendSms(to: string, body: string) {
  const provider = smsProvider();
  let status: "sent" | "queued" | "failed" = provider.name === "outbox" ? "queued" : "sent";
  let ref: string | undefined;
  let error: string | undefined;
  try {
    ref = (await provider.send(to, body)).ref;
  } catch (e) {
    status = "failed";
    error = String(e);
  }
  await withSystem((tx) =>
    tx.insert(outboxMessages).values({ channel: "sms", toAddress: to, body, status, provider: provider.name, providerRef: ref, error, sentAt: status === "sent" ? new Date() : null }),
  );
}

export async function sendEmail(to: string, subject: string, body: string) {
  const provider = emailProvider();
  let status: "sent" | "queued" | "failed" = provider.name === "outbox" ? "queued" : "sent";
  let ref: string | undefined;
  let error: string | undefined;
  try {
    ref = (await provider.send(to, subject, body)).ref;
  } catch (e) {
    status = "failed";
    error = String(e);
  }
  await withSystem((tx) =>
    tx.insert(outboxMessages).values({ channel: "email", toAddress: to, subject, body, status, provider: provider.name, providerRef: ref, error, sentAt: status === "sent" ? new Date() : null }),
  );
}
