/*
 * Runs a cron job against the running app, exactly as the scheduler will in production:
 *
 *   pnpm jobs                       the daily run (corporate actions, finalization, snapshots)
 *   pnpm jobs finalize              one job: corporate-actions | finalize | snapshots
 *   pnpm jobs daily --now 2026-11-02T06:30+01:00   as of another moment (ALLOW_TIME_TRAVEL=1)
 *
 * Needs `pnpm dev` running. Reads APP_URL and CRON_SECRET from the repo-root .env.
 */
import { existsSync } from "node:fs";
import path from "node:path";

const rootEnv = path.resolve(import.meta.dirname, "../../../.env");
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const args = process.argv.slice(2);
const nowFlag = args.indexOf("--now");
const now = nowFlag === -1 ? undefined : args[nowFlag + 1];
const job =
  args.find((arg, index) => !arg.startsWith("--") && (nowFlag === -1 || index !== nowFlag + 1)) ??
  "daily";

const appUrl = process.env["APP_URL"];
const secret = process.env.CRON_SECRET;
if (!appUrl || !secret) {
  console.error("APP_URL and CRON_SECRET must be set in .env (see .env.example).");
  process.exit(1);
}

const url = new URL(`/api/cron/${job}`, appUrl);
if (now) url.searchParams.set("now", now);
const response = await fetch(url, { headers: { authorization: `Bearer ${secret}` } }).catch(
  (error: unknown) => {
    console.error(`Could not reach ${appUrl}. Is \`pnpm dev\` running?`, error);
    process.exit(1);
  },
);
console.log(JSON.stringify(await response.json(), null, 2));
if (!response.ok) process.exit(1);
