import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  pgTable,
  primaryKey,
  smallint,
  text,
  time,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { authUsers } from "drizzle-orm/supabase";

import { timestamptz } from "./columns";
import { currencyEnum } from "./enums";

/** One row per auth user, created by a trigger on auth.users. */
export const profiles = pgTable("profiles", {
  id: uuid("id")
    .primaryKey()
    .references(() => authUsers.id, { onDelete: "cascade" }),
  displayName: text("display_name").notNull(),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

/** Exchanges are identified by their MIC code (XOSL, XNAS, …). */
export const exchanges = pgTable("exchanges", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  timeZone: text("time_zone").notNull(),
  currency: currencyEnum("currency").notNull(),
});

/** Regular hours per weekday, in the exchange's local time. */
export const exchangeTradingHours = pgTable(
  "exchange_trading_hours",
  {
    exchangeId: text("exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade" }),
    /** 1 = Monday … 7 = Sunday (ISO, same as Luxon). */
    weekday: smallint("weekday").notNull(),
    opensAt: time("opens_at").notNull(),
    closesAt: time("closes_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.exchangeId, table.weekday] }),
    check("weekday_range", sql`${table.weekday} between 1 and 7`),
    check("opens_before_close", sql`${table.opensAt} < ${table.closesAt}`),
  ],
);

/**
 * Closed days and half days. ⚠️ Seeded from manually entered data that must be checked
 * against each exchange's official calendar (docs/decisions.md).
 */
export const exchangeHolidays = pgTable(
  "exchange_holidays",
  {
    exchangeId: text("exchange_id")
      .notNull()
      .references(() => exchanges.id, { onDelete: "cascade" }),
    date: date("date", { mode: "string" }).notNull(),
    name: text("name").notNull(),
    /** Null: closed all day. Set: a half day closing at this local time. */
    closesEarlyAt: time("closes_early_at"),
  },
  (table) => [primaryKey({ columns: [table.exchangeId, table.date] })],
);

export const instruments = pgTable(
  "instruments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticker: text("ticker").notNull(),
    isin: text("isin").notNull().unique(),
    name: text("name").notNull(),
    exchangeId: text("exchange_id")
      .notNull()
      .references(() => exchanges.id),
    currency: currencyEnum("currency").notNull(),
    isActive: boolean("is_active").notNull().default(true),
  },
  (table) => [unique("instruments_exchange_ticker").on(table.exchangeId, table.ticker)],
);
