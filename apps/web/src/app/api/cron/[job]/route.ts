import { timingSafeEqual } from "node:crypto";

import { isJobName, runJob } from "@aksjeliga/db";
import { DateTime } from "luxon";
import { type NextRequest, NextResponse } from "next/server";

import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { getPrices } from "@/server/prices";

/*
 * Cron endpoints: GET /api/cron/daily (once a day at 06:30 Europe/Oslo), or one job:
 * /api/cron/corporate-actions, /api/cron/finalize, /api/cron/snapshots.
 * The caller sends `Authorization: Bearer <CRON_SECRET>` (what Vercel Cron sends). Every job
 * is idempotent, so calling one twice is harmless. Locally: `pnpm jobs`.
 * With ALLOW_TIME_TRAVEL=1, `?now=<ISO time>` runs the job as of another moment.
 */

function authorized(request: NextRequest): boolean {
  const expected = Buffer.from(`Bearer ${serverEnv.cronSecret}`);
  const given = Buffer.from(request.headers.get("authorization") ?? "");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ job: string }> },
): Promise<NextResponse> {
  if (!authorized(request)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const { job } = await params;
  if (!isJobName(job)) return NextResponse.json({ error: "unknown job" }, { status: 404 });

  let now = await serverNow();
  const requested = request.nextUrl.searchParams.get("now");
  if (requested !== null) {
    const chosen = DateTime.fromISO(requested, { zone: "utc" });
    if (!serverEnv.timeTravelEnabled || !chosen.isValid)
      return NextResponse.json({ error: "now is not allowed here" }, { status: 400 });
    now = chosen;
  }

  const report = await runJob(job, getDb(), await getPrices(now), { now });
  return NextResponse.json({ job, now: now.toISO(), ...report });
}
