import { type SQL, sql } from "drizzle-orm";
import { type AnyPgColumn, numeric, timestamp } from "drizzle-orm/pg-core";

/*
 * Money, prices, FX rates and quantities are unconstrained `numeric`, read and written as
 * strings, never JS numbers. Precision is enforced with CHECK constraints on scale instead of
 * numeric(p, s): numeric(p, s) would silently round a value with too many decimals, hiding a
 * bug; a CHECK makes the insert fail.
 */
export const decimalColumn = (name: string) => numeric(name, { mode: "string" });

export const timestamptz = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });

/** Booked amounts: at most 2 decimals. */
export const AMOUNT_SCALE = 2;
/** Locked prices: at most 4 decimals. */
export const PRICE_SCALE = 4;
/** Locked FX rates: at most 6 decimals. */
export const FX_SCALE = 6;
/** Quantities: whole shares today, room for fractions later. */
export const QUANTITY_SCALE = 6;

export function maxScale(column: AnyPgColumn, scale: number): SQL {
  return sql`scale(${column}) <= ${sql.raw(String(scale))}`;
}
