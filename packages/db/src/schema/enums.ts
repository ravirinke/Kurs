import { CURRENCIES } from "@aksjeliga/core";
import { pgEnum } from "drizzle-orm/pg-core";

export const currencyEnum = pgEnum("currency", CURRENCIES);
export const visibilityEnum = pgEnum("visibility", ["open", "delayed", "hidden"]);
export const tradeSideEnum = pgEnum("trade_side", ["buy", "sell"]);
/** Only "market" for now; "limit" can be added later without touching existing rows. */
export const orderTypeEnum = pgEnum("order_type", ["market"]);
export const transactionTypeEnum = pgEnum("transaction_type", [
  "deposit",
  "buy",
  "sell",
  "fee",
  "dividend",
  "split",
]);
export const joinRequestStatusEnum = pgEnum("join_request_status", [
  "pending",
  "approved",
  "declined",
]);
export const corporateActionKindEnum = pgEnum("corporate_action_kind", ["split", "dividend"]);
export const priceKindEnum = pgEnum("price_kind", ["close", "intraday"]);
