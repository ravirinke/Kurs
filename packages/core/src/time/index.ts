import { DateTime } from "luxon";

/**
 * Source of "now". core never reads the system clock directly (enforced by ESLint):
 * functions take `now` as an argument, and long-lived objects take a Clock.
 */
export interface Clock {
  now(): DateTime;
}

/**
 * The app's home time zone, used for calendar days ("today", daily snapshots, "dagens
 * endring"). Exchange hours always use the exchange's own zone.
 */
export const APP_TIME_ZONE = "Europe/Oslo";

/** Start of the calendar day in the app time zone: the boundary for "today's change". */
export function startOfAppDay(at: DateTime): DateTime {
  return at.setZone(APP_TIME_ZONE).startOf("day");
}

/** A clock that always returns the same instant. */
export function fixedClock(at: DateTime): Clock {
  return { now: () => at };
}

/** Parses an ISO timestamp that includes an offset (e.g. "2026-10-26T13:30:00Z") into UTC. */
export function instant(iso: string): DateTime {
  if (!/(Z|[+-]\d{2}:?\d{2})$/.test(iso)) {
    throw new RangeError(`Timestamp must include an offset: ${iso}`);
  }
  const result = DateTime.fromISO(iso, { setZone: true });
  if (!result.isValid) throw new RangeError(`Invalid ISO timestamp: ${iso}`);
  return result.toUTC();
}

/** A wall-clock time in an IANA zone, e.g. ("2026-10-26", "09:30", "America/New_York"). */
export function zonedTime(isoDate: string, time: string, zone: string): DateTime {
  const result = DateTime.fromISO(`${isoDate}T${time}`, { zone });
  if (!result.isValid) throw new RangeError(`Invalid time ${isoDate} ${time} in ${zone}`);
  return result;
}

/** The calendar date (yyyy-MM-dd) of an instant in a zone. */
export function localDate(at: DateTime, zone: string): string {
  return at.setZone(zone).toFormat("yyyy-MM-dd");
}

export function isBefore(a: DateTime, b: DateTime): boolean {
  return a.toMillis() < b.toMillis();
}

export function isSameOrAfter(a: DateTime, b: DateTime): boolean {
  return a.toMillis() >= b.toMillis();
}
