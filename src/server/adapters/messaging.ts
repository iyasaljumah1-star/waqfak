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

// ── SMS providers (Saudi-licensed aggregators). Endpoints follow each provider's public REST API;
//    verify sender-name registration with CITC/CST before go-live. Numbers are E.164 (+9665…).
const digits = (to: string) => to.replace(/[^0-9]/g, "");
async function postJson(url: string, body: unknown, headers: Record<string, string>) {
  const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
  const text = await res.text();
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
  return text;
}
const need = (v: string | undefined, name: string) => {
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const taqnyat: SmsProvider = {
  name: "taqnyat",
  async send(to, body) {
    const r = await postJson("https://api.taqnyat.sa/v1/messages", { recipients: [digits(to)], body, sender: need(env.SMS_SENDER, "SMS_SENDER") }, { authorization: `Bearer ${need(env.SMS_API_KEY, "SMS_API_KEY")}` });
    return { ref: JSON.parse(r)?.messageId?.toString() };
  },
};
const unifonic: SmsProvider = {
  name: "unifonic",
  async send(to, body) {
    const params = new URLSearchParams({ AppSid: need(env.SMS_API_KEY, "SMS_API_KEY"), SenderID: need(env.SMS_SENDER, "SMS_SENDER"), Recipient: digits(to), Body: body });
    const res = await fetch("https://el.cloud.unifonic.com/rest/SMS/messages", { method: "POST", body: params, signal: AbortSignal.timeout(15_000) });
    const text = await res.text();
    if (!res.ok || /"success"\s*:\s*"?false/.test(text)) throw new Error(`unifonic: ${text.slice(0, 300)}`);
    return { ref: JSON.parse(text)?.data?.MessageID?.toString() };
  },
};
const msegat: SmsProvider = {
  name: "msegat",
  async send(to, body) {
    const r = await postJson("https://www.msegat.com/gw/sendsms.php", { userName: need(env.SMS_USERNAME, "SMS_USERNAME"), apiKey: need(env.SMS_API_KEY, "SMS_API_KEY"), numbers: digits(to), userSender: need(env.SMS_SENDER, "SMS_SENDER"), msg: body, msgEncoding: "UTF8" }, {});
    if (!/"code"\s*:\s*"?(1|M0000)"?/.test(r)) throw new Error(`msegat: ${r.slice(0, 300)}`);
    return {};
  },
};

function smsProvider(): SmsProvider {
  switch (env.SMS_PROVIDER) {
    case "taqnyat": return taqnyat;
    case "unifonic": return unifonic;
    case "msegat": return msegat;
    default: return outboxSms;
  }
}

let smtp: EmailProvider | null = null;
function emailProvider(): EmailProvider {
  if (env.EMAIL_PROVIDER !== "smtp") return outboxEmail;
  if (smtp) return smtp;
  const url = need(env.SMTP_URL, "SMTP_URL");
  const from = need(env.EMAIL_FROM, "EMAIL_FROM");
  smtp = {
    name: "smtp",
    async send(to, subject, body) {
      const nodemailer = await import("nodemailer");
      const t = nodemailer.createTransport(url);
      const info = await t.sendMail({ from, to, subject, text: body, html: `<div dir="rtl" style="font-family:Tahoma,Arial,sans-serif;font-size:15px;line-height:1.8;white-space:pre-line">${body.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]!)}</div>` });
      return { ref: info.messageId };
    },
  };
  return smtp;
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
