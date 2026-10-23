import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

import { AMOUNT_SCALE, decimalColumn, maxScale, timestamptz } from "./columns";
import { currencyEnum, joinRequestStatusEnum, visibilityEnum } from "./enums";
import { exchanges, profiles } from "./reference";

export const leagues = pgTable(
  "leagues",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => profiles.id),
    name: text("name").notNull(),
    description: text("description").notNull().default(""),
    currency: currencyEnum("currency").notNull(),
    startAmount: decimalColumn("start_amount").notNull(),
    startsAt: timestamptz("starts_at").notNull(),
    endsAt: timestamptz("ends_at").notNull(),
    visibility: visibilityEnum("visibility").notNull().default("delayed"),
    /** Fraction of the gross amount (0.0005 = 0.05 %). */
    feeRate: decimalColumn("fee_rate").notNull(),
    /** In the league currency. */
    feeMinimum: decimalColumn("fee_minimum").notNull(),
    /** Fraction of portfolio value; null = no limit. */
    maxPositionShare: decimalColumn("max_position_share"),
    inviteCode: text("invite_code").notNull().unique(),
    /**
     * Set once by the finalization job. Status is otherwise derived from the times:
     * upcoming before starts_at, active until ends_at, finished after.
     */
    finalizedAt: timestamptz("finalized_at"),
    /** Set when the owner cancels the league before the start. Hidden from everyone after. */
    cancelledAt: timestamptz("cancelled_at"),
    createdAt: timestamptz("created_at").notNull().defaultNow(),
  },
  (table) => [
    check("ends_after_start", sql`${table.endsAt} > ${table.startsAt}`),
    check("start_amount_positive", sql`${table.startAmount} > 0`),
    check("start_amount_scale", maxScale(table.startAmount, AMOUNT_SCALE)),
    check("fee_rate_range", sql`${table.feeRate} >= 0 and ${table.feeRate} <= 0.05`),
    check("fee_minimum_valid", sql`${table.feeMinimum} >= 0 and scale(${table.feeMinimum}) <= 2`),
    check(
      "max_position_share_range",
      sql`${table.maxPositionShare} is null or (${table.maxPositionShare} > 0 and ${table.maxPositionShare} <= 1)`,
    ),
    check("name_length", sql`char_length(${table.name}) between 1 and 60`),
  ],
);

export const leagueAllowedExchanges = pgTable(
  "league_allowed_exchanges",
  {
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    exchangeId: text("exchange_id")
      .notNull()
      .references(() => exchanges.id),
  },
  (table) => [primaryKey({ columns: [table.leagueId, table.exchangeId] })],
);

export const leagueMembers = pgTable(
  "league_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    joinedAt: timestamptz("joined_at").notNull(),
    /**
     * Cache of the cash balance, rebuilt from transactions. This row is also the lock every
     * trade takes (SELECT … FOR UPDATE), so a member's trades run one at a time.
     */
    cashBalance: decimalColumn("cash_balance").notNull(),
    /** Cache of the latest buy/sell time, for the leaderboard tie-break. */
    lastTradeAt: timestamptz("last_trade_at"),
    /** Written once by the finalization job, never recomputed. */
    finalRank: integer("final_rank"),
    finalValue: decimalColumn("final_value"),
    finalReturn: decimalColumn("final_return"),
    isWinner: boolean("is_winner").notNull().default(false),
    /**
     * Set when the owner removes the member. The row (and its transactions) stays, so the
     * user can never join again with a fresh start amount; they just lose access.
     */
    removedAt: timestamptz("removed_at"),
  },
  (table) => [
    uniqueIndex("league_members_league_user").on(table.leagueId, table.userId),
    index("league_members_user").on(table.userId),
    check("cash_not_negative", sql`${table.cashBalance} >= 0`),
    check("cash_scale", maxScale(table.cashBalance, AMOUNT_SCALE)),
    check("final_value_scale", sql`${table.finalValue} is null or scale(${table.finalValue}) <= 2`),
  ],
);

/** Joining after the start needs the owner's approval (docs/decisions.md). */
export const leagueJoinRequests = pgTable(
  "league_join_requests",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    leagueId: uuid("league_id")
      .notNull()
      .references(() => leagues.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => profiles.id),
    requestedAt: timestamptz("requested_at").notNull(),
    status: joinRequestStatusEnum("status").notNull().default("pending"),
    decidedAt: timestamptz("decided_at"),
    decidedBy: uuid("decided_by").references(() => profiles.id),
  },
  (table) => [
    uniqueIndex("league_join_requests_one_pending")
      .on(table.leagueId, table.userId)
      .where(sql`${table.status} = 'pending'`),
    check("decision_consistent", sql`(${table.status} = 'pending') = (${table.decidedAt} is null)`),
  ],
);
