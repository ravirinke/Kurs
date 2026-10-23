import {
  canSeeHoldings,
  convert,
  type Decimal,
  deriveLeagueStatus,
  type Instrument,
  type League,
  type LedgerEvent,
  type Mark,
  Money,
  type PortfolioAccess,
  type PriceProvider,
  replayUntil,
  resolvePortfolioAccess,
  returnFraction,
  startOfAppDay,
  type TradeEvent,
  type ValueChange,
  valueChange,
  visibleEvents,
} from "@aksjeliga/core";
import type { DateTime } from "luxon";

import type { Executor } from "../client";
import { must } from "../must";
import { loadLeague } from "../repositories/leagues";
import { loadExchanges, loadInstruments } from "../repositories/reference";

import { type ActiveMember, loadActiveMembers, loadLeagueEvents, valueStates } from "./leaderboard";

export interface HoldingView {
  instrument: Instrument;
  exchangeName: string;
  quantity: Decimal;
  /** Price in the trading currency. */
  price: Money;
  /** In the league currency. */
  value: Money;
  costBasis: Money;
  returnFraction: Decimal;
  dayChange: ValueChange | null;
}

export interface TradeView {
  id: string;
  at: DateTime;
  side: "buy" | "sell";
  instrument: Instrument;
  quantity: Decimal;
  price: Money;
  fxRate: Decimal;
  grossAmount: Money;
  fee: Money;
  /** What left (buy) or reached (sell) the cash balance. */
  totalAmount: Money;
}

export interface AllocationSlice {
  label: string;
  value: Money;
  fraction: Decimal;
}

export interface PortfolioView {
  league: League;
  member: ActiveMember;
  isOwn: boolean;
  access: PortfolioAccess;
  /** Always visible to members (it is on the leaderboard). */
  summary: {
    value: Money;
    returnAmount: Money;
    returnFraction: Decimal;
    dayChange: ValueChange | null;
  };
  /** When holdings are shown: the time they are for (now, or 24 h ago when delayed). */
  holdingsAsOf: DateTime | null;
  cash: Money | null;
  holdings: HoldingView[];
  trades: TradeView[];
  allocation: {
    byInstrument: AllocationSlice[];
    byExchange: AllocationSlice[];
    cash: AllocationSlice;
  } | null;
  history: { at: DateTime; value: Money }[];
}

const MAX_HISTORY_DAYS = 400;

function slice(label: string, value: Money, total: Money): AllocationSlice {
  return { label, value, fraction: total.isZero() ? value.amount.times(0) : value.ratioTo(total) };
}

function holdingValue(quantity: Decimal, mark: Mark): Money {
  return convert(mark.price.times(quantity), mark.fxRate);
}

/**
 * A member's portfolio as `viewerUserId` may see it. Returns null when the viewer is not an
 * active member of the league. The visibility rule from core decides what is included.
 */
export async function loadPortfolio(
  db: Executor,
  provider: PriceProvider,
  input: { leagueId: string; memberId: string; viewerUserId: string; now: DateTime },
): Promise<PortfolioView | null> {
  const { now } = input;
  const league = await loadLeague(db, input.leagueId);
  if (!league) return null;
  const members = await loadActiveMembers(db, league.id);
  const viewer = members.find((member) => member.userId === input.viewerUserId);
  const member = members.find((candidate) => candidate.memberId === input.memberId);
  if (!viewer || !member) return null;

  const access = resolvePortfolioAccess({
    visibility: league.visibility,
    leagueStatus: deriveLeagueStatus(league, now),
    viewerIsMember: true,
    viewerMemberId: viewer.memberId,
    targetMemberId: member.memberId,
    now,
  });
  const events: LedgerEvent[] = (await loadLeagueEvents(db, league)).get(member.memberId) ?? [];
  const valuedAt = now.toMillis() < league.endsAt.toMillis() ? now : league.endsAt;
  const yesterdayEnd = startOfAppDay(valuedAt);

  // Summary: the same numbers as the leaderboard.
  const stateNow = replayUntil(league.currency, events, valuedAt);
  const joinedBeforeToday = member.joinedAt.toMillis() < yesterdayEnd.toMillis();
  const [nowValued, beforeValued] = await Promise.all([
    valueStates(db, provider, league.currency, [stateNow], valuedAt),
    valueStates(
      db,
      provider,
      league.currency,
      joinedBeforeToday ? [replayUntil(league.currency, events, yesterdayEnd)] : [],
      yesterdayEnd,
    ),
  ]);
  const value = must(nowValued.values[0], "value");
  const summary = {
    value,
    returnAmount: value.minus(league.startAmount),
    returnFraction: returnFraction(value, league.startAmount),
    dayChange: beforeValued.values[0] ? valueChange(value, beforeValued.values[0]) : null,
  };

  const history = await valueHistory(db, provider, league, events, member.joinedAt, valuedAt);
  const view: PortfolioView = {
    league,
    member,
    isOwn: viewer.memberId === member.memberId,
    access,
    summary,
    holdingsAsOf: null,
    cash: null,
    holdings: [],
    trades: [],
    allocation: null,
    history,
  };
  if (!canSeeHoldings(access)) return view;

  // Holdings as the viewer may see them: now, or as they were 24 hours ago.
  const asOf = access.kind === "delayed" ? access.asOf : valuedAt;
  const state = replayUntil(league.currency, events, asOf);
  const [shown, dayStart, exchanges] = await Promise.all([
    valueStates(db, provider, league.currency, [state], asOf),
    valueStates(db, provider, league.currency, [state], startOfAppDay(asOf)),
    loadExchanges(db),
  ]);
  const instrumentsById = new Map(
    shown.instruments.map((instrument) => [instrument.id, instrument]),
  );
  const exchangeName = (id: string) => exchanges.find((exchange) => exchange.id === id)?.name ?? id;

  const holdings: HoldingView[] = [...state.positions.values()].map((position) => {
    const instrument = must(instrumentsById.get(position.instrumentId), "instrument");
    const mark = must(shown.marks.get(position.instrumentId), "mark");
    const positionValue = holdingValue(position.quantity, mark);
    const startMark = dayStart.marks.get(position.instrumentId);
    return {
      instrument,
      exchangeName: exchangeName(instrument.exchangeId),
      quantity: position.quantity,
      price: mark.price,
      value: positionValue.round(),
      costBasis: position.costBasis,
      returnFraction: positionValue.minus(position.costBasis).ratioTo(position.costBasis),
      dayChange: startMark
        ? valueChange(positionValue, holdingValue(position.quantity, startMark))
        : null,
    };
  });
  holdings.sort((a, b) => b.value.compare(a.value));

  const total = must(shown.values[0], "value");
  const byExchange = new Map<string, Money>();
  for (const holding of holdings) {
    const name = holding.exchangeName;
    byExchange.set(name, (byExchange.get(name) ?? Money.zero(league.currency)).plus(holding.value));
  }

  const tradeEvents = visibleEvents(events, access).filter(
    (event): event is TradeEvent => event.type === "buy" || event.type === "sell",
  );
  const tradedInstruments = await loadInstruments(db, [
    ...new Set(tradeEvents.map((event) => event.instrumentId)),
  ]);
  const tradeInstrument = new Map(
    tradedInstruments.map((instrument) => [instrument.id, instrument]),
  );

  return {
    ...view,
    holdingsAsOf: asOf,
    cash: state.cash,
    holdings,
    trades: tradeEvents
      .map((event) => ({
        id: event.id,
        at: event.at,
        side: event.type,
        instrument: must(tradeInstrument.get(event.instrumentId), "instrument"),
        quantity: event.quantity,
        price: event.price,
        fxRate: event.fxRate.rate,
        grossAmount: event.grossAmount,
        fee: event.fee,
        totalAmount:
          event.type === "buy"
            ? event.grossAmount.plus(event.fee)
            : event.grossAmount.minus(event.fee),
      }))
      .reverse(),
    allocation: {
      byInstrument: holdings.map((holding) => slice(holding.instrument.name, holding.value, total)),
      byExchange: [...byExchange.entries()].map(([name, amount]) => slice(name, amount, total)),
      // The UI labels this slice (text lives in the web app).
      cash: slice("", state.cash, total),
    },
  };
}

/** Portfolio value at the end of each calendar day since joining, plus the current value. */
async function valueHistory(
  db: Executor,
  provider: PriceProvider,
  league: League,
  events: readonly LedgerEvent[],
  joinedAt: DateTime,
  until: DateTime,
): Promise<{ at: DateTime; value: Money }[]> {
  const points: DateTime[] = [joinedAt];
  for (
    let day = startOfAppDay(joinedAt).plus({ days: 1 });
    day.toMillis() < until.toMillis() && points.length < MAX_HISTORY_DAYS;
    day = day.plus({ days: 1 })
  ) {
    points.push(day);
  }
  points.push(until);
  const values = await Promise.all(
    points.map(async (at) => {
      const {
        values: [valueAt],
      } = await valueStates(
        db,
        provider,
        league.currency,
        [replayUntil(league.currency, events, at)],
        at,
      );
      return { at, value: must(valueAt, "value") };
    }),
  );
  return values;
}
