import type { Exchange, Instrument } from "@aksjeliga/core";
import { eq, inArray } from "drizzle-orm";

import type { Executor } from "../client";
import { toExchange, toInstrument } from "../mappers";
import { exchangeHolidays, exchanges, exchangeTradingHours, instruments } from "../schema";

export async function loadExchanges(db: Executor): Promise<Exchange[]> {
  const [rows, hours, holidays] = await Promise.all([
    db.select().from(exchanges).orderBy(exchanges.id),
    db.select().from(exchangeTradingHours),
    db.select().from(exchangeHolidays),
  ]);
  return rows.map((row) =>
    toExchange(
      row,
      hours.filter((hour) => hour.exchangeId === row.id).sort((a, b) => a.weekday - b.weekday),
      holidays.filter((holiday) => holiday.exchangeId === row.id),
    ),
  );
}

export async function loadInstrument(db: Executor, id: string): Promise<Instrument | null> {
  const [row] = await db.select().from(instruments).where(eq(instruments.id, id));
  return row ? toInstrument(row) : null;
}

export async function loadInstruments(
  db: Executor,
  ids?: readonly string[],
): Promise<Instrument[]> {
  if (ids?.length === 0) return [];
  const query = db.select().from(instruments);
  const rows = ids ? await query.where(inArray(instruments.id, [...ids])) : await query;
  return rows.map(toInstrument);
}
