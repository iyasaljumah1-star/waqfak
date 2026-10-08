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
  // SMS (SMS_PROVIDER = outbox | taqnyat | unifonic | msegat)
  SMS_API_KEY: z.string().optional(),
  SMS_SENDER: z.string().optional(),
  SMS_USERNAME: z.string().optional(),
  // Email (EMAIL_PROVIDER = outbox | smtp)
  SMTP_URL: z.string().optional(), // smtps://user:pass@smtp.example.com:465
  EMAIL_FROM: z.string().optional(), // "وقفك <no-reply@waqfak.sa>"
  // Storage (STORAGE_PROVIDER = local | s3)
  STORAGE_PROVIDER: z.enum(["local", "s3"]).default("local"),
  S3_ENDPOINT: z.string().optional(),
  S3_REGION: z.string().optional(),
  S3_BUCKET: z.string().optional(),
  S3_ACCESS_KEY_ID: z.string().optional(),
  S3_SECRET_ACCESS_KEY: z.string().optional(),
  JOB_SECRET: z.string().optional(),
});

export const env = schema.parse(process.env);
export const isProd = env.NODE_ENV === "production";
export const showOtpOnScreen = env.DEMO_SHOW_OTP === "true" && env.SMS_PROVIDER === "outbox";
export const cookieSecure = env.COOKIE_SECURE ? env.COOKIE_SECURE === "true" : env.APP_URL.startsWith("https://");
