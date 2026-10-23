import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "drizzle-kit";

// One .env for the whole monorepo, in the repo root. drizzle-kit runs from packages/db and
// loads this file in a way where import.meta.dirname is not available.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl)
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env in the repo root.");

/*
 * The Drizzle schema is the source of truth for tables. Migrations are written straight into
 * supabase/migrations with Supabase's timestamp naming, so `supabase db reset` applies them.
 * Security (RLS, grants, triggers, SQL functions) lives in hand-written custom migrations
 * (`pnpm db:generate:custom`).
 */
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema/index.ts",
  out: "../../supabase/migrations",
  migrations: { prefix: "supabase" },
  schemaFilter: ["public"],
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
