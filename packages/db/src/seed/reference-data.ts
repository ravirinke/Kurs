import { EXCHANGES } from "@aksjeliga/core";

import type { Database } from "../client";
import { exchangeHolidays, exchanges, exchangeTradingHours, instruments } from "../schema";

import { INSTRUMENT_CATALOGUE } from "./instruments";

/**
 * Exchanges, hours and holidays from packages/core (one source of truth), and the
 * instrument catalogue. Safe to run again: existing rows are left alone.
 *
 * ⚠️ Holidays and half days were entered manually; verify them against the official
 * exchange calendars (docs/decisions.md).
 */
export async function seedReferenceData(db: Database): Promise<void> {
  await db.transaction(async (tx) => {
    await tx
      .insert(exchanges)
      .values(
        EXCHANGES.map(({ id, name, timeZone, currency }) => ({ id, name, timeZone, currency })),
      )
      .onConflictDoNothing();
    await tx
      .insert(exchangeTradingHours)
      .values(
        EXCHANGES.flatMap((exchange) =>
          exchange.sessions.map((session) => ({
            exchangeId: exchange.id,
            weekday: session.weekday,
            opensAt: session.open,
            closesAt: session.close,
          })),
        ),
      )
      .onConflictDoNothing();
    await tx
      .insert(exchangeHolidays)
      .values(
        EXCHANGES.flatMap((exchange) =>
          exchange.holidays.map((holiday) => ({
            exchangeId: exchange.id,
            date: holiday.date,
            name: holiday.name,
            closesEarlyAt: holiday.closesEarlyAt ?? null,
          })),
        ),
      )
      .onConflictDoNothing();
    await tx
      .insert(instruments)
      .values(INSTRUMENT_CATALOGUE.map(({ mockBasePrice: _price, ...instrument }) => instrument))
      .onConflictDoNothing();
  });
}
