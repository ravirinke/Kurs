import { existsSync } from "node:fs";
import path from "node:path";

/** Loads the repo-root .env (one for the whole monorepo) into process.env, if present. */
export function loadRootEnv(startDir: string = process.cwd()): void {
  let dir = path.resolve(startDir);
  for (;;) {
    if (existsSync(path.join(dir, "pnpm-workspace.yaml"))) {
      const envFile = path.join(dir, ".env");
      if (existsSync(envFile)) process.loadEnvFile(envFile);
      return;
    }
    const parent = path.dirname(dir);
    if (parent === dir) return;
    dir = parent;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env in the repo root.`);
  return value;
}
