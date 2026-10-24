import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  check,
  date,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { AMOUNT_SCALE, decimalColumn, maxScale, timestamptz } from "./columns";
import { corporateActionKindEnum, currencyEnum, priceKindEnum } from "./enums";
import { leagueMembers, leagues } from "./leagues";
import { instruments } from "./reference";

/** Prices fetched from the PriceProvider, kept for charts and snapshots. */
export const prices = pgTable(
  "prices",
  {
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    kind: priceKindEnum("kind").notNull(),
    at: timestamptz("at").notNull(),
    price: decimalColumn("price").notNull(),
    currency: currencyEnum("currency").notNull(),
  },
  (table) => [primaryKey({ columns: [table.instrumentId, table.kind, table.at] })],
);

/** FX rates fetched from the PriceProvider, e.g. frozen at an exchange's close. */
export const fxRates = pgTable(
  "fx_rates",
  {
    fromCurrency: currencyEnum("from_currency").notNull(),
    toCurrency: currencyEnum("to_currency").notNull(),
    at: timestamptz("at").notNull(),
    rate: decimalColumn("rate").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.fromCurrency, table.toCurrency, table.at] }),
    check("fx_rate_positive", sql`${table.rate} > 0`),
  ],
);

/** The fields of a split or dividend, shared by the real table and the dev simulation. */
const corporateActionFields = () => ({
  instrumentId: uuid("instrument_id")
    .notNull()
    .references(() => instruments.id),
  kind: corporateActionKindEnum("kind").notNull(),
  /** Split: first trading day at the new price (exchange-local date). */
  effectiveDate: date("effective_date", { mode: "string" }),
  ratioFrom: decimalColumn("ratio_from"),
  ratioTo: decimalColumn("ratio_to"),
  /** Dividend: shares held at the start of this exchange-local date are entitled. */
  exDate: date("ex_date", { mode: "string" }),
  payDate: date("pay_date", { mode: "string" }),
  amountPerShare: decimalColumn("amount_per_share"),
  currency: currencyEnum("currency"),
  createdAt: timestamptz("created_at").notNull().defaultNow(),
});

function corporateActionShape(table: {
  kind: AnyPgColumn;
  effectiveDate: AnyPgColumn;
  ratioFrom: AnyPgColumn;
  ratioTo: AnyPgColumn;
  exDate: AnyPgColumn;
  payDate: AnyPgColumn;
  amountPerShare: AnyPgColumn;
  currency: AnyPgColumn;
}) {
  return [
    check(
      "split_shape",
      sql`${table.kind} <> 'split' or (${table.effectiveDate} is not null and ${table.ratioFrom} > 0 and ${table.ratioTo} > 0)`,
    ),
    check(
      "dividend_shape",
      sql`${table.kind} <> 'dividend' or (${table.exDate} is not null and ${table.payDate} >= ${table.exDate}
        and ${table.amountPerShare} > 0 and ${table.currency} is not null)`,
    ),
  ];
}

/**
 * Splits and dividends, as reported by the PriceProvider. Applying one writes a transaction
 * per affected member.
 */
export const corporateActions = pgTable(
  "corporate_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** The provider's id for the action, so fetching it again never stores it twice. */
    externalId: text("external_id").notNull(),
    ...corporateActionFields(),
    /** Set the first time the job has applied it to every league it concerns. */
    processedAt: timestamptz("processed_at"),
  },
  (table) => [
    index("corporate_actions_instrument").on(table.instrumentId),
    uniqueIndex("corporate_actions_external_id").on(table.externalId),
    ...corporateActionShape(table),
  ],
);

/**
 * Dev only: splits and dividends the mock provider pretends the market had (entered on the
 * profile page with ALLOW_TIME_TRAVEL=1). The jobs still get them through the PriceProvider,
 * exactly as they would from a real one. Never read by anything else.
 */
export const simulatedCorporateActions = pgTable(
  "simulated_corporate_actions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ...corporateActionFields(),
  },
  (table) => [...corporateActionShape(table)],
);

/** End-of-day portfolio value per member, for charts and "today's change". */
export const portfolioSnapshots = pgTable(
  "portfolio_snapshots",
  {
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    /** Calendar date in Europe/Oslo the snapshot belongs to. */
    date: date("date", { mode: "string" }).notNull(),
    value: decimalColumn("value").notNull(),
    cash: decimalColumn("cash").notNull(),
    returnFraction: decimalColumn("return_fraction").notNull(),
    takenAt: timestamptz("taken_at").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.date] }),
    index("portfolio_snapshots_league_date").on(table.leagueId, table.date),
    check("snapshot_value_scale", maxScale(table.value, AMOUNT_SCALE)),
  ],
);
