import "server-only";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  DATABASE_URL: z.string().min(1),
  APP_URL: z.string().url().default("http://localhost:3000"),
  MASTER_KEY: z.string().min(40),
  HASH_KEY: z.string().min(40),
  SESSION_SECRET: z.string().min(40),
  STORAGE_DIR: z.string().default("./storage"),
  SMS_PROVIDER: z.string().default("outbox"),
  EMAIL_PROVIDER: z.string().default("outbox"),
  PAYMENT_PROVIDER: z.string().default("sandbox"),
  AI_PROVIDER: z.string().default("local"),
  AI_API_KEY: z.string().optional(),
  AI_API_URL: z.string().optional(),
  AI_MODEL: z.string().optional(),
  CHROMIUM_PATH: z.string().optional(),
  /** Shows OTP codes on screen while no SMS provider is connected. MUST be false in real production. */
  DEMO_SHOW_OTP: z.enum(["true", "false"]).default("false"),
  COOKIE_SECURE: z.enum(["true", "false"]).optional(),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
export const showOtpOnScreen = env.DEMO_SHOW_OTP === "true" && env.SMS_PROVIDER === "outbox";
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : env.APP_URL.startsWith("https://");
