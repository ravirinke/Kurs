import "server-only";

import { DateTime } from "luxon";
import { cookies } from "next/headers";

import { serverEnv } from "./env";

/*
 * The server's "now". In development, with ALLOW_TIME_TRAVEL=1, a cookie can move it to
 * another moment (e.g. a Saturday, or the minute before the US close) to test opening
 * hours without waiting. Time keeps running from the chosen moment.
 */

export const TIME_TRAVEL_COOKIE = "aksjeliga-time";

/** Cookie value: "<chosen ISO time>|<real epoch ms when chosen>". */
export function encodeTimeTravel(chosen: DateTime, real: DateTime = DateTime.utc()): string {
  return `${chosen.toUTC().toISO() ?? ""}|${String(real.toMillis())}`;
}

export function decodeTimeTravel(value: string, real: DateTime): DateTime | null {
  const [iso, setAt] = value.split("|");
  if (!iso || !setAt) return null;
  const chosen = DateTime.fromISO(iso, { zone: "utc" });
  const setAtMillis = Number.parseInt(setAt, 10);
  if (!chosen.isValid || Number.isNaN(setAtMillis)) return null;
  return chosen.plus({ milliseconds: real.toMillis() - setAtMillis });
}

export async function serverNow(): Promise<DateTime> {
  const real = DateTime.utc();
  if (!serverEnv.timeTravelEnabled) return real;
  const value = (await cookies()).get(TIME_TRAVEL_COOKIE)?.value;
  return (value ? decodeTimeTravel(value, real) : null) ?? real;
}

export async function isTimeTravelling(): Promise<boolean> {
  if (!serverEnv.timeTravelEnabled) return false;
  return (await cookies()).get(TIME_TRAVEL_COOKIE) !== undefined;
}
