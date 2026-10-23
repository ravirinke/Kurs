import { existsSync } from "node:fs";
import path from "node:path";

import type { NextConfig } from "next";

// One .env for the whole monorepo, in the repo root. (Not @next/env: it caches the env Next
// already loaded for apps/web and silently ignores a second directory.) Next runs from apps/web.
const rootEnv = path.resolve(process.cwd(), "../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const nextConfig: NextConfig = {
  // Workspace packages are shipped as TypeScript source.
  transpilePackages: ["@aksjeliga/core", "@aksjeliga/db"],
  // The Postgres driver runs on the server only and is not bundled.
  serverExternalPackages: ["postgres"],
  typedRoutes: true,
  // Next reads .env before this file runs, so values from the root .env are passed on
  // explicitly. Only public values belong here: they are inlined into every bundle.
  env: {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ?? "",
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "",
  },
};

export default nextConfig;
