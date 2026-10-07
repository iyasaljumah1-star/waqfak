import "server-only";
import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { env } from "../env";

const masterKey = Buffer.from(env.MASTER_KEY, "base64").subarray(0, 32);
const hashKey = Buffer.from(env.HASH_KEY, "base64");

if (masterKey.length !== 32) throw new Error("MASTER_KEY must decode to at least 32 bytes");

/** AES-256-GCM. Output: v1:<iv>:<tag>:<ciphertext> (base64url). */
export function encryptString(plain: string, key: Buffer = masterKey): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ct.toString("base64url")].join(":");
}

export function decryptString(payload: string, key: Buffer = masterKey): string {
  const [v, iv, tag, ct] = payload.split(":");
  if (v !== "v1" || !iv || !tag || !ct) throw new Error("bad ciphertext");
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(Buffer.from(ct, "base64url")), decipher.final()]).toString("utf8");
}

export const encryptNullable = (v?: string | null) => (v ? encryptString(v) : null);
export const decryptNullable = (v?: string | null) => {
  if (!v) return null;
  try {
    return decryptString(v);
  } catch {
    return null;
  }
};

/** Keyed hash for exact-match lookups of encrypted identifiers (national ID, IBAN). */
export function lookupHash(value: string): string {
  return createHmac("sha256", hashKey).update(value.trim()).digest("base64url");
}

export function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function numericCode(digits = 6): string {
  let s = "";
  for (let i = 0; i < digits; i++) s += randomInt(0, 10).toString();
  return s;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

// ───────────── Envelope encryption: one data key per waqf, wrapped by the master key ─────────────

export function newDataKey(): { raw: Buffer; wrapped: string } {
  const raw = randomBytes(32);
  return { raw, wrapped: encryptString(raw.toString("base64")) };
}

export function unwrapDataKey(wrapped: string): Buffer {
  return Buffer.from(decryptString(wrapped), "base64");
}

export function encryptBuffer(data: Buffer, key: Buffer): { ct: Buffer; iv: string; tag: string } {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([cipher.update(data), cipher.final()]);
  return { ct, iv: iv.toString("base64url"), tag: cipher.getAuthTag().toString("base64url") };
}

export function decryptBuffer(ct: Buffer, key: Buffer, iv: string, tag: string): Buffer {
  const decipher = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([decipher.update(ct), decipher.final()]);
}

export const masterDataKey = () => masterKey;
