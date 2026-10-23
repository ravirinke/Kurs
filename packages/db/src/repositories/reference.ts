import { EXCHANGES, type Exchange, type Instrument } from "@aksjeliga/core";
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
  // In the order of the reference data (Oslo first), then any added later by id.
  const order = (id: string) => {
    const index = EXCHANGES.findIndex((exchange) => exchange.id === id);
    return index === -1 ? EXCHANGES.length : index;
  };
  rows.sort((a, b) => order(a.id) - order(b.id) || a.id.localeCompare(b.id));
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
