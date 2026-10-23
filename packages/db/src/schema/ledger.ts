import { sql } from "drizzle-orm";
import {
  bigint,
  check,
  index,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import {
  AMOUNT_SCALE,
  decimalColumn,
  FX_SCALE,
  maxScale,
  PRICE_SCALE,
  QUANTITY_SCALE,
  timestamptz,
} from "./columns";
import { currencyEnum, orderTypeEnum, tradeSideEnum, transactionTypeEnum } from "./enums";
import { leagueMembers, leagues } from "./leagues";
import { corporateActions } from "./market-data";
import { instruments } from "./reference";

/** A price the server locked for a member, valid for 30 seconds and usable once. */
export const quotes = pgTable(
  "quotes",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    memberId: uuid("member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    orderType: orderTypeEnum("order_type").notNull().default("market"),
    side: tradeSideEnum("side").notNull(),
    quantity: decimalColumn("quantity").notNull(),
    price: decimalColumn("price").notNull(),
    priceCurrency: currencyEnum("price_currency").notNull(),
    fxRate: decimalColumn("fx_rate").notNull(),
    grossAmount: decimalColumn("gross_amount").notNull(),
    fee: decimalColumn("fee").notNull(),
    totalAmount: decimalColumn("total_amount").notNull(),
    createdAt: timestamptz("created_at").notNull(),
    expiresAt: timestamptz("expires_at").notNull(),
    /** Set when the quote is executed. A used quote can never be executed again. */
    usedAt: timestamptz("used_at"),
  },
  (table) => [
    index("quotes_member").on(table.memberId),
    check("quote_quantity_positive", sql`${table.quantity} > 0`),
    check("quote_price_scale", maxScale(table.price, PRICE_SCALE)),
    check("quote_fx_scale", maxScale(table.fxRate, FX_SCALE)),
    check("quote_gross_scale", maxScale(table.grossAmount, AMOUNT_SCALE)),
    check("quote_fee_scale", maxScale(table.fee, AMOUNT_SCALE)),
    check("quote_expires_after_creation", sql`${table.expiresAt} > ${table.createdAt}`),
  ],
);

/**
 * THE SOURCE OF TRUTH. Every deposit, trade, fee, dividend and split, immutable (a trigger
 * blocks UPDATE and DELETE). Cash and holdings can always be rebuilt from these rows.
 *
 * `amount` is the signed effect on cash in the league currency:
 *   deposit +amount · buy −(gross + fee) · sell +(gross − fee) · fee −amount ·
 *   dividend +amount · split +cash in lieu
 */
export const transactions = pgTable(
  "transactions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    /** Insertion order; breaks ties between rows with the same occurred_at. */
    sequence: bigint("sequence", { mode: "bigint" }).generatedAlwaysAsIdentity(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id),
    memberId: uuid("member_id")
      .notNull()
      .references(() => leagueMembers.id),
    type: transactionTypeEnum("type").notNull(),
    occurredAt: timestamptz("occurred_at").notNull(),
    amount: decimalColumn("amount").notNull(),

    // Trades, dividends and splits
    instrumentId: uuid("instrument_id").references(() => instruments.id),
    quantity: decimalColumn("quantity"),

    // Trades: the locked values, so stock and FX returns can be separated later
    price: decimalColumn("price"),
    priceCurrency: currencyEnum("price_currency"),
    fxRate: decimalColumn("fx_rate"),
    grossAmount: decimalColumn("gross_amount"),
    fee: decimalColumn("fee"),
    quoteId: uuid("quote_id")
      .unique()
      .references(() => quotes.id),
    idempotencyKey: text("idempotency_key"),

    // Dividends and splits
    corporateActionId: uuid("corporate_action_id").references(() => corporateActions.id),
    amountPerShare: decimalColumn("amount_per_share"),
    dividendCurrency: currencyEnum("dividend_currency"),
    ratioFrom: decimalColumn("ratio_from"),
    ratioTo: decimalColumn("ratio_to"),
    quantityBefore: decimalColumn("quantity_before"),
    quantityAfter: decimalColumn("quantity_after"),

    description: text("description"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("transactions_member_order").on(table.memberId, table.occurredAt, table.sequence),
    index("transactions_league").on(table.leagueId),
    uniqueIndex("transactions_idempotency")
      .on(table.memberId, table.idempotencyKey)
      .where(sql`${table.idempotencyKey} is not null`),
    // One dividend or split per member per corporate action: makes the job idempotent.
    uniqueIndex("transactions_corporate_action")
      .on(table.memberId, table.corporateActionId)
      .where(sql`${table.corporateActionId} is not null`),
    check("amount_scale", maxScale(table.amount, AMOUNT_SCALE)),
    check(
      "tx_price_scale",
      sql`${table.price} is null or scale(${table.price}) <= ${sql.raw(String(PRICE_SCALE))}`,
    ),
    check(
      "tx_fx_scale",
      sql`${table.fxRate} is null or scale(${table.fxRate}) <= ${sql.raw(String(FX_SCALE))}`,
    ),
    check(
      "tx_quantity_scale",
      sql`${table.quantity} is null or scale(${table.quantity}) <= ${sql.raw(String(QUANTITY_SCALE))}`,
    ),
    check(
      "trade_fields",
      sql`${table.type} not in ('buy', 'sell') or (
        ${table.instrumentId} is not null and ${table.quantity} > 0 and ${table.price} is not null
        and ${table.priceCurrency} is not null and ${table.fxRate} > 0
        and ${table.grossAmount} is not null and ${table.fee} >= 0
        and ${table.quoteId} is not null and ${table.idempotencyKey} is not null)`,
    ),
    check(
      "dividend_fields",
      sql`${table.type} <> 'dividend' or (
        ${table.instrumentId} is not null and ${table.corporateActionId} is not null
        and ${table.quantity} > 0 and ${table.amountPerShare} is not null
        and ${table.dividendCurrency} is not null and ${table.fxRate} > 0 and ${table.amount} >= 0)`,
    ),
    check(
      "split_fields",
      sql`${table.type} <> 'split' or (
        ${table.instrumentId} is not null and ${table.corporateActionId} is not null
        and ${table.ratioFrom} > 0 and ${table.ratioTo} > 0
        and ${table.quantityBefore} is not null and ${table.quantityAfter} is not null
        and ${table.amount} >= 0)`,
    ),
    check("deposit_positive", sql`${table.type} <> 'deposit' or ${table.amount} > 0`),
    check("fee_negative", sql`${table.type} <> 'fee' or ${table.amount} < 0`),
  ],
);

/** Cache of current holdings, rebuilt from transactions (see rebuildMemberCache). */
export const holdings = pgTable(
  "holdings",
  {
    memberId: uuid("member_id")
      .notNull()
      .references(() => leagueMembers.id, { onDelete: "cascade" }),
    instrumentId: uuid("instrument_id")
      .notNull()
      .references(() => instruments.id),
    quantity: decimalColumn("quantity").notNull(),
    /** Total cost including brokerage, league currency, full precision. */
    costBasis: decimalColumn("cost_basis").notNull(),
  },
  (table) => [
    primaryKey({ columns: [table.memberId, table.instrumentId] }),
    check("holding_quantity_positive", sql`${table.quantity} > 0`),
  ],
);
