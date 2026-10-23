import type { DateTime } from "luxon";

import { type Exchange, type ExchangeId, getSession } from "../market";
import { type Currency, decimal, isLeagueCurrency, Money, MONEY_DECIMALS } from "../money";
import { zonedTime } from "../time";
import { defaultFeeRule } from "../trading/fees";

import { deriveLeagueStatus } from "./status";
import type { League, LeagueSettings, Visibility } from "./types";

export const DEFAULT_VISIBILITY: Visibility = "delayed";
export const MAX_NAME_LENGTH = 60;
export const MAX_DESCRIPTION_LENGTH = 500;
/** Upper bound on the fee rate a league can set (5 %). */
export const MAX_FEE_RATE = decimal("0.05");
/** A start time this far in the past still counts as "now" (form filled in slowly). */
const START_TOLERANCE_MINUTES = 10;

export const DEFAULT_START_AMOUNT: Readonly<Record<Currency, string>> = {
  NOK: "100000",
  SEK: "100000",
  DKK: "75000",
  EUR: "10000",
  USD: "10000",
};

/** Sensible defaults for the create-league form. */
export function defaultLeagueSettings(
  currency: Currency,
  exchanges: readonly Exchange[],
): Omit<LeagueSettings, "name" | "description" | "startsAt" | "endsAt"> {
  return {
    currency,
    startAmount: Money.of(DEFAULT_START_AMOUNT[currency], currency),
    visibility: DEFAULT_VISIBILITY,
    allowedExchangeIds: exchanges.map((exchange) => exchange.id),
    feeRule: defaultFeeRule(currency),
    maxPositionShare: null,
  };
}

export type LeagueSettingsError =
  | { code: "NAME_REQUIRED" }
  | { code: "NAME_TOO_LONG"; max: number }
  | { code: "DESCRIPTION_TOO_LONG"; max: number }
  | { code: "UNSUPPORTED_CURRENCY" }
  | { code: "START_AMOUNT_INVALID" }
  | { code: "FEE_INVALID" }
  | { code: "NO_EXCHANGES" }
  | { code: "UNKNOWN_EXCHANGE"; exchangeId: ExchangeId }
  | { code: "START_IN_PAST" }
  | { code: "END_BEFORE_START" }
  | { code: "END_IN_PAST" }
  | { code: "END_BEFORE_MARKET_CLOSE"; exchangeId: ExchangeId; closesAt: DateTime }
  | { code: "MAX_POSITION_SHARE_INVALID" }
  | { code: "FIELD_LOCKED"; field: keyof LeagueSettings }
  | { code: "LEAGUE_FINISHED" };

/**
 * The end time must fall after every allowed exchange has closed on that day: for each
 * exchange with a session on the end time's local date, the end must be at or after the close.
 */
export function validateEndTime(
  endsAt: DateTime,
  exchanges: readonly Exchange[],
): LeagueSettingsError[] {
  const errors: LeagueSettingsError[] = [];
  for (const exchange of exchanges) {
    const session = getSession(exchange, endsAt.setZone(exchange.timeZone).toFormat("yyyy-MM-dd"));
    if (session && endsAt.toMillis() < session.closesAt.toMillis()) {
      errors.push({
        code: "END_BEFORE_MARKET_CLOSE",
        exchangeId: exchange.id,
        closesAt: session.closesAt,
      });
    }
  }
  return errors;
}

/**
 * A valid end time on a calendar date (in the user's zone): the latest close among the
 * allowed exchanges that trade that day, or 18:00 if none of them do.
 */
export function suggestEndTime(
  date: string,
  zone: string,
  exchanges: readonly Exchange[],
): DateTime {
  let latest: DateTime | null = null;
  for (const exchange of exchanges) {
    const session = getSession(exchange, date);
    if (session && (!latest || session.closesAt.toMillis() > latest.toMillis()))
      latest = session.closesAt;
  }
  return (latest ?? zonedTime(date, "18:00", zone)).setZone(zone);
}

function selectExchanges(
  ids: readonly ExchangeId[],
  known: readonly Exchange[],
): { selected: Exchange[]; errors: LeagueSettingsError[] } {
  const selected: Exchange[] = [];
  const errors: LeagueSettingsError[] = [];
  for (const id of ids) {
    const exchange = known.find((candidate) => candidate.id === id);
    if (exchange) selected.push(exchange);
    else errors.push({ code: "UNKNOWN_EXCHANGE", exchangeId: id });
  }
  return { selected, errors };
}

/** Validates the settings of a new league. Returns every problem found. */
export function validateLeagueSettings(
  settings: LeagueSettings,
  knownExchanges: readonly Exchange[],
  now: DateTime,
): LeagueSettingsError[] {
  const errors: LeagueSettingsError[] = [];

  const name = settings.name.trim();
  if (name.length === 0) errors.push({ code: "NAME_REQUIRED" });
  if (name.length > MAX_NAME_LENGTH) errors.push({ code: "NAME_TOO_LONG", max: MAX_NAME_LENGTH });
  if (settings.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({ code: "DESCRIPTION_TOO_LONG", max: MAX_DESCRIPTION_LENGTH });
  }

  if (!isLeagueCurrency(settings.currency)) errors.push({ code: "UNSUPPORTED_CURRENCY" });

  const start = settings.startAmount;
  if (
    start.currency !== settings.currency ||
    !start.amount.greaterThan(0) ||
    start.amount.greaterThan("1000000000") ||
    start.amount.decimalPlaces() > MONEY_DECIMALS
  ) {
    errors.push({ code: "START_AMOUNT_INVALID" });
  }

  const fee = settings.feeRule;
  if (
    fee.minimum.currency !== settings.currency ||
    fee.minimum.isNegative() ||
    fee.rate.isNegative() ||
    fee.rate.greaterThan(MAX_FEE_RATE)
  ) {
    errors.push({ code: "FEE_INVALID" });
  }

  const { selected, errors: exchangeErrors } = selectExchanges(
    settings.allowedExchangeIds,
    knownExchanges,
  );
  errors.push(...exchangeErrors);
  if (settings.allowedExchangeIds.length === 0) errors.push({ code: "NO_EXCHANGES" });

  if (settings.startsAt.toMillis() < now.minus({ minutes: START_TOLERANCE_MINUTES }).toMillis()) {
    errors.push({ code: "START_IN_PAST" });
  }
  if (settings.endsAt.toMillis() <= settings.startsAt.toMillis())
    errors.push({ code: "END_BEFORE_START" });
  errors.push(...validateEndTime(settings.endsAt, selected));

  const share = settings.maxPositionShare;
  if (share !== null && (!share.greaterThan(0) || share.greaterThan(1))) {
    errors.push({ code: "MAX_POSITION_SHARE_INVALID" });
  }

  return errors;
}

/** Only these can change once the league has started (docs/decisions.md). */
export const EDITABLE_AFTER_START = [
  "name",
  "description",
  "endsAt",
] as const satisfies readonly (keyof LeagueSettings)[];

export type LeagueSettingsPatch = Partial<LeagueSettings>;

function isUnchanged(league: League, field: keyof LeagueSettings, value: unknown): boolean {
  const current: unknown = league[field];
  if (value === current) return true;
  if (
    typeof value === "object" &&
    value !== null &&
    typeof current === "object" &&
    current !== null
  ) {
    return JSON.stringify(value) === JSON.stringify(current);
  }
  return false;
}

/**
 * Validates a change to an existing league. Before the start everything may change (and is
 * validated like a new league); after the start only name, description and a future end time.
 */
export function validateLeagueUpdate(
  league: League,
  patch: LeagueSettingsPatch,
  knownExchanges: readonly Exchange[],
  now: DateTime,
): LeagueSettingsError[] {
  const status = deriveLeagueStatus(league, now);
  const next: LeagueSettings = { ...league, ...patch };

  if (status === "upcoming") return validateLeagueSettings(next, knownExchanges, now);

  const errors: LeagueSettingsError[] = [];
  for (const [field, value] of Object.entries(patch) as [keyof LeagueSettings, unknown][]) {
    const editable = (EDITABLE_AFTER_START as readonly string[]).includes(field);
    if (!editable && !isUnchanged(league, field, value))
      errors.push({ code: "FIELD_LOCKED", field });
  }

  const name = next.name.trim();
  if (name.length === 0) errors.push({ code: "NAME_REQUIRED" });
  if (name.length > MAX_NAME_LENGTH) errors.push({ code: "NAME_TOO_LONG", max: MAX_NAME_LENGTH });
  if (next.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push({ code: "DESCRIPTION_TOO_LONG", max: MAX_DESCRIPTION_LENGTH });
  }

  if (patch.endsAt && !patch.endsAt.equals(league.endsAt)) {
    if (status === "finished") {
      errors.push({ code: "LEAGUE_FINISHED" });
    } else {
      if (patch.endsAt.toMillis() <= now.toMillis()) errors.push({ code: "END_IN_PAST" });
      const { selected } = selectExchanges(league.allowedExchangeIds, knownExchanges);
      errors.push(...validateEndTime(patch.endsAt, selected));
    }
  }

  return errors;
}
