import { existsSync } from "node:fs";
import path from "node:path";

import { defineConfig } from "drizzle-kit";

// One .env for the whole monorepo, in the repo root.
const rootEnv = path.resolve(import.meta.dirname, "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const databaseUrl = process.env["DATABASE_URL"];
if (!databaseUrl)
  throw new Error("DATABASE_URL is not set. Copy .env.example to .env in the repo root.");

// Schema and migrations are added in phase 3.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema",
  out: "./migrations",
  dbCredentials: { url: databaseUrl },
});
