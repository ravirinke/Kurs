import {
  type Decimal,
  deriveLeagueStatus,
  type Exchange,
  getMarketStatus,
  type Instrument,
  type League,
  type MarketStatus,
  PriceDataError,
  type PricePoint,
  type PriceProvider,
  priceWithDayChange,
  type PriceWithDayChange,
  replayUntil,
  resolvePortfolioAccess,
  ZERO,
} from "@aksjeliga/core";
import { and, eq } from "drizzle-orm";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { must } from "../must";
import { loadLeague } from "../repositories/leagues";
import {
  countInstruments,
  loadExchanges,
  loadFeaturedInstruments,
  loadInstruments,
  searchInstruments,
} from "../repositories/reference";
import { transactions } from "../schema";

import { loadActiveMembers, loadLeagueEvents } from "./leaderboard";

export interface InstrumentQuote {
  instrument: Instrument;
  exchange: Exchange;
  quote: PriceWithDayChange;
}

export interface TradingHome {
  league: League;
  exchanges: { exchange: Exchange; status: MarketStatus; instrumentCount: number }[];
  winners: InstrumentQuote[];
  losers: InstrumentQuote[];
}

/** Restricts lists to the exchanges the PriceProvider in use can price (all, if absent). */
export interface PricedExchanges {
  pricedExchangeIds?: readonly string[] | null;
}

const MOVERS = 5;
/** Instruments per page of a list: each one costs a price lookup. */
export const INSTRUMENT_PAGE_SIZE = 25;

/** The league's exchanges that can be traded: allowed by the league and priced by a source. */
async function tradableExchanges(
  db: Executor,
  league: League,
  input: PricedExchanges,
): Promise<Exchange[]> {
  return (await loadExchanges(db)).filter(
    (exchange) =>
      league.allowedExchangeIds.includes(exchange.id) &&
      (!input.pricedExchangeIds || input.pricedExchangeIds.includes(exchange.id)),
  );
}

/**
 * Prices with the change today for some instruments. One the source cannot price right now
 * is left out rather than failing the whole list.
 */
async function quoteAll(
  provider: PriceProvider,
  exchanges: readonly Exchange[],
  instruments: readonly Instrument[],
  now: DateTime,
): Promise<InstrumentQuote[]> {
  const quoted = await Promise.all(
    instruments.map(async (instrument): Promise<InstrumentQuote | null> => {
      const exchange = exchanges.find((candidate) => candidate.id === instrument.exchangeId);
      if (!exchange) return null;
      try {
        return { instrument, exchange, quote: await priceWithDayChange(provider, instrument, now) };
      } catch (error) {
        if (error instanceof PriceDataError) return null;
        throw error;
      }
    }),
  );
  return quoted.filter((entry): entry is InstrumentQuote => entry !== null);
}

/**
 * The "Handle" page: the exchanges of the league with status, and the biggest movers today
 * among the well-known stocks and the ones traded in this league. (With thousands of
 * instruments we cannot price them all to find the true biggest movers.)
 */
export async function loadTradingHome(
  db: Executor,
  provider: PriceProvider,
  input: { leagueId: string; now: DateTime } & PricedExchanges,
): Promise<TradingHome | null> {
  const league = await loadLeague(db, input.leagueId);
  if (!league) return null;
  const exchanges = await tradableExchanges(db, league, input);
  const exchangeIds = exchanges.map((exchange) => exchange.id);
  const [counts, featured, traded] = await Promise.all([
    countInstruments(db, exchangeIds),
    loadFeaturedInstruments(db, exchangeIds),
    db
      .selectDistinct({ instrumentId: transactions.instrumentId })
      .from(transactions)
      .where(and(eq(transactions.leagueId, league.id), eq(transactions.type, "buy"))),
  ]);
  const featuredIds = new Set(featured.map((instrument) => instrument.id));
  const others = await loadInstruments(
    db,
    traded.flatMap((row) =>
      row.instrumentId && !featuredIds.has(row.instrumentId) ? [row.instrumentId] : [],
    ),
  );
  const quotes = await quoteAll(provider, exchanges, [...featured, ...others], input.now);
  const sorted = [...quotes].sort((a, b) =>
    b.quote.changeFraction.comparedTo(a.quote.changeFraction),
  );
  return {
    league,
    exchanges: exchanges.map((exchange) => ({
      exchange,
      status: getMarketStatus(exchange, input.now),
      instrumentCount: counts.get(exchange.id) ?? 0,
    })),
    winners: sorted.filter((entry) => entry.quote.changeFraction.greaterThan(0)).slice(0, MOVERS),
    losers: sorted
      .reverse()
      .filter((entry) => entry.quote.changeFraction.lessThan(0))
      .slice(0, MOVERS),
  };
}

export interface InstrumentPage {
  items: InstrumentQuote[];
  /** There are more matches: ask for the next page. */
  hasMore: boolean;
}

/**
 * One page of the instruments on an exchange, or of those matching a search, limited to the
 * exchanges of the league. Only the instruments on the page are priced.
 */
export async function loadInstrumentQuotes(
  db: Executor,
  provider: PriceProvider,
  input: {
    leagueId: string;
    exchangeId?: string;
    search?: string;
    /** 0 is the first page. */
    page?: number;
    now: DateTime;
  } & PricedExchanges,
): Promise<InstrumentPage | null> {
  const league = await loadLeague(db, input.leagueId);
  if (!league) return null;
  const exchanges = await tradableExchanges(db, league, input);
  const page = Math.max(0, Math.trunc(input.page ?? 0));
  const matching = await searchInstruments(db, {
    exchangeIds: exchanges
      .filter((exchange) => !input.exchangeId || exchange.id === input.exchangeId)
      .map((exchange) => exchange.id),
    ...(input.search === undefined ? {} : { search: input.search }),
    limit: INSTRUMENT_PAGE_SIZE + 1,
    offset: page * INSTRUMENT_PAGE_SIZE,
  });
  return {
    items: await quoteAll(provider, exchanges, matching.slice(0, INSTRUMENT_PAGE_SIZE), input.now),
    hasMore: matching.length > INSTRUMENT_PAGE_SIZE,
  };
}

export type ChartPeriod = "1d" | "1w" | "1m" | "3m" | "1y";
export const CHART_PERIODS: readonly ChartPeriod[] = ["1d", "1w", "1m", "3m", "1y"];

export interface InstrumentDetail {
  league: League;
  instrument: Instrument;
  exchange: Exchange;
  isAllowed: boolean;
  status: MarketStatus;
  quote: PriceWithDayChange;
  history: Record<ChartPeriod, PricePoint[]>;
  periodReturns: Record<ChartPeriod, Decimal | null>;
  /** The viewer's own shares (null if not a member). */
  ownQuantity: Decimal | null;
  /** Other members holding it, as far as the visibility rule allows. */
  owners: { displayName: string; quantity: Decimal; asOf: DateTime }[];
  /** True when some members' holdings could not be shown (hidden visibility). */
  ownersHidden: boolean;
}

function periodStart(period: ChartPeriod, now: DateTime, sessionStart: DateTime): DateTime {
  switch (period) {
    case "1d":
      return sessionStart;
    case "1w":
      return now.minus({ weeks: 1 });
    case "1m":
      return now.minus({ months: 1 });
    case "3m":
      return now.minus({ months: 3 });
    case "1y":
      return now.minus({ years: 1 });
  }
}

/** Everything the stock page needs. */
export async function loadInstrumentDetail(
  db: Executor,
  provider: PriceProvider,
  input: { leagueId: string; instrumentId: string; viewerUserId: string; now: DateTime },
): Promise<InstrumentDetail | null> {
  const { now } = input;
  const league = await loadLeague(db, input.leagueId);
  const [instrument] = await loadInstruments(db, [input.instrumentId]);
  if (!league || !instrument) return null;
  const exchange = must(
    (await loadExchanges(db)).find((candidate) => candidate.id === instrument.exchangeId),
    "exchange",
  );
  const status = getMarketStatus(exchange, now);
  const quote = await priceWithDayChange(provider, instrument, now);

  // The current session if open, otherwise the most recent one.
  const sessionStart =
    status.currentSession?.opensAt ?? (await sessionOpenBefore(provider, instrument, quote.at));
  const [intraday, hourly, daily] = await Promise.all([
    provider.getPriceHistory(instrument.id, sessionStart, now, "5m"),
    provider.getPriceHistory(instrument.id, now.minus({ weeks: 1 }), now, "1h"),
    provider.getPriceHistory(instrument.id, now.minus({ years: 1 }), now, "1d"),
  ]);
  const history: Record<ChartPeriod, PricePoint[]> = {
    "1d": intraday,
    "1w": hourly,
    "1m": daily.filter(
      (point) => point.at.toMillis() >= periodStart("1m", now, sessionStart).toMillis(),
    ),
    "3m": daily.filter(
      (point) => point.at.toMillis() >= periodStart("3m", now, sessionStart).toMillis(),
    ),
    "1y": daily,
  };
  const periodReturns = Object.fromEntries(
    Object.entries(history).map(([period, points]) => {
      if (period === "1d") return [period, quote.changeFraction];
      const first = points[0];
      return [period, first ? quote.price.minus(first.price).ratioTo(first.price) : null];
    }),
  ) as Record<ChartPeriod, Decimal | null>;

  // Ownership within the league, following the visibility rule.
  const members = await loadActiveMembers(db, league.id);
  const viewer = members.find((member) => member.userId === input.viewerUserId);
  const events = await loadLeagueEvents(db, league);
  let ownQuantity: Decimal | null = null;
  const owners: InstrumentDetail["owners"] = [];
  let ownersHidden = false;
  if (viewer) {
    const leagueStatus = deriveLeagueStatus(league, now);
    for (const member of members) {
      const memberEvents = events.get(member.memberId) ?? [];
      if (member.memberId === viewer.memberId) {
        ownQuantity =
          replayUntil(league.currency, memberEvents, now).positions.get(instrument.id)?.quantity ??
          ZERO;
        continue;
      }
      const access = resolvePortfolioAccess({
        visibility: league.visibility,
        leagueStatus,
        viewerIsMember: true,
        viewerMemberId: viewer.memberId,
        targetMemberId: member.memberId,
        now,
      });
      if (access.kind !== "full" && access.kind !== "delayed") {
        ownersHidden = true;
        continue;
      }
      const asOf = access.kind === "delayed" ? access.asOf : now;
      const quantity = replayUntil(league.currency, memberEvents, asOf).positions.get(
        instrument.id,
      )?.quantity;
      if (quantity?.greaterThan(0))
        owners.push({ displayName: member.displayName, quantity, asOf });
    }
  }

  return {
    league,
    instrument,
    exchange,
    isAllowed: league.allowedExchangeIds.includes(exchange.id),
    status,
    quote,
    history,
    periodReturns,
    ownQuantity,
    owners,
    ownersHidden,
  };
}

/** Opening time of the session a closing price belongs to. */
async function sessionOpenBefore(
  provider: PriceProvider,
  instrument: Instrument,
  closedAt: DateTime,
): Promise<DateTime> {
  const status = await provider.getMarketStatus(
    instrument.exchangeId,
    closedAt.minus({ minutes: 1 }),
  );
  return status.currentSession?.opensAt ?? closedAt.minus({ hours: 8 });
}
