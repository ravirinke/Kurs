import type { DateTime } from "luxon";

import type { ExchangeId } from "../market";
import type { Currency, Decimal, Money } from "../money";
import type { FeeRule } from "../trading/fees";

export type LeagueStatus = "upcoming" | "active" | "finished";

/**
 * - open: everyone sees all holdings and trades in real time.
 * - delayed: others see holdings and trades 24 hours late.
 * - hidden: others see only the return until the league is finished.
 */
export type Visibility = "open" | "delayed" | "hidden";

export interface LeagueSettings {
  name: string;
  description: string;
  currency: Currency;
  startAmount: Money;
  startsAt: DateTime;
  endsAt: DateTime;
  visibility: Visibility;
  allowedExchangeIds: readonly ExchangeId[];
  feeRule: FeeRule;
  /** Fraction of portfolio value, e.g. 0.25. Null when off. */
  maxPositionShare: Decimal | null;
}

export interface League extends LeagueSettings {
  id: string;
  ownerId: string;
  inviteCode: string;
  /** Set once by the finalization job. Results are never recomputed after this. */
  finalizedAt: DateTime | null;
}
