import "dotenv/config";
import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/server/db/schema/index.ts",
  out: "./drizzle",
  casing: "snake_case",
  schemaFilter: ["public", "restricted"],
  dbCredentials: { url: process.env.DATABASE_OWNER_URL ?? "" },
});
