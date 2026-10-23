import { convert, deriveLeagueStatus, Money, ZERO } from "@aksjeliga/core";
import { CHART_PERIODS, type ChartPeriod, loadInstrumentDetail } from "@aksjeliga/db";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { BackLink } from "@/components/back-link";
import { Change } from "@/components/change";
import { PriceChart } from "@/components/price-chart";
import { MarketStatusBadge } from "@/components/status-badges";
import { TradeButtons } from "@/components/trade-sheet";
import { t } from "@/i18n";
import { currencyLabel, direction, formatMoney, formatNumber, formatQuantity } from "@/lib/format";
import { cn } from "@/lib/utils";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireLeagueMember } from "@/server/league-access";
import { getPrices } from "@/server/prices";

export const metadata: Metadata = { title: t.trade.title };

export default async function InstrumentPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string; instrumentId: string }>;
  searchParams: Promise<{ periode?: string }>;
}) {
  const { id, instrumentId } = await params;
  const requested = (await searchParams).periode;
  const period: ChartPeriod = CHART_PERIODS.includes(requested as ChartPeriod)
    ? (requested as ChartPeriod)
    : "1d";
  const { user, league, member } = await requireLeagueMember(
    id,
    `/ligaer/${id}/aksjer/${instrumentId}`,
  );
  const now = await serverNow();
  const db = getDb();
  const prices = await getPrices(now);
  const detail = await loadInstrumentDetail(db, prices, {
    leagueId: id,
    instrumentId,
    viewerUserId: user.id,
    now,
  });
  if (!detail) notFound();
  const { instrument, exchange, quote, status } = detail;

  const ownQuantity = detail.ownQuantity ?? ZERO;
  const ownValue = ownQuantity.greaterThan(0)
    ? convert(
        quote.price.times(ownQuantity),
        await prices.getFxRate(instrument.currency, league.currency, now),
      ).round()
    : null;
  const periodReturn = detail.periodReturns[period];
  const cash = Money.of(member.cashBalance, league.currency);
  const canTrade = detail.isAllowed && deriveLeagueStatus(league, now) === "active";

  return (
    <div className="flex flex-col gap-6 pb-20 sm:pb-0">
      <AutoRefresh enabled={status.isOpen} />
      <BackLink href={`/ligaer/${id}/handle` as Route}>{t.trade.title}</BackLink>

      <header className="flex flex-col gap-2">
        <span className="bg-muted w-fit rounded-full px-3 py-1 text-xs font-medium">
          {exchange.name}
        </span>
        <h1 className="font-display text-3xl font-bold tracking-tight">{instrument.name}</h1>
        <p className="text-muted-foreground text-sm">{instrument.ticker}</p>
        <p className="flex items-baseline gap-2">
          <span
            className="font-display text-4xl font-bold tabular-nums"
            data-testid="instrument-price"
          >
            {formatNumber(
              quote.price.amount,
              Math.max(2, Math.min(4, quote.price.amount.decimalPlaces())),
            )}
          </span>
          <span className="text-muted-foreground font-medium">
            {currencyLabel(quote.price.currency)}
          </span>
        </p>
        <p className="flex flex-wrap items-center gap-2 text-sm">
          <Change fraction={quote.changeFraction} amount={quote.change} />
          <span className="text-muted-foreground">
            {quote.source === "live" ? t.market.live : t.market.atClose}
          </span>
        </p>
        <MarketStatusBadge status={status} now={now} />
      </header>

      <section className="flex flex-col gap-3">
        <PriceChart
          points={detail.history[period].map((point) => ({ at: point.at, value: point.price }))}
          intraday={period === "1d"}
          direction={periodReturn ? direction(periodReturn) : "flat"}
          label={`${instrument.name} ${t.trade.periods[period]}`}
        />
        <nav className="grid grid-cols-5 gap-1" aria-label={t.portfolio.chart}>
          {CHART_PERIODS.map((option) => {
            const value = detail.periodReturns[option];
            return (
              <Link
                key={option}
                href={`/ligaer/${id}/aksjer/${instrumentId}?periode=${option}` as Route}
                aria-current={option === period ? "true" : undefined}
                scroll={false}
                className={cn(
                  "flex flex-col items-center rounded-lg px-1 py-2 text-xs",
                  option === period ? "bg-muted font-semibold" : "hover:bg-muted/60",
                )}
              >
                <span>{t.trade.periods[option]}</span>
                {value ? (
                  <Change fraction={value} showArrow={false} className="text-[0.7rem]" />
                ) : (
                  <span>–</span>
                )}
              </Link>
            );
          })}
        </nav>
      </section>

      <section className="bg-card flex flex-col gap-2 rounded-xl border p-4 text-sm">
        {ownValue && (
          <p className="font-medium">
            {t.trade.youOwn(formatQuantity(ownQuantity), formatMoney(ownValue))}
          </p>
        )}
        {detail.owners.length > 0 ? (
          <p>
            {t.trade.ownersInLeague(detail.owners.map((owner) => owner.displayName).join(", "))}{" "}
            {league.visibility === "delayed" && (
              <span className="text-muted-foreground">{t.trade.ownersDelayed}</span>
            )}
          </p>
        ) : detail.ownersHidden ? (
          <p className="text-muted-foreground">{t.trade.ownersHidden}</p>
        ) : (
          <p className="text-muted-foreground">{t.trade.nobodyOwns}</p>
        )}
      </section>

      {!detail.isAllowed && <p className="text-muted-foreground text-sm">{t.trade.notAllowed}</p>}

      <div className="bg-background/95 sticky bottom-0 -mx-4 border-t px-4 py-3 backdrop-blur sm:static sm:mx-0 sm:border-0 sm:p-0">
        <TradeButtons
          leagueId={id}
          instrumentId={instrumentId}
          instrumentName={instrument.name}
          ownedQuantity={ownQuantity.toFixed()}
          cash={cash.amount.toFixed(2)}
          cashLabel={formatMoney(cash)}
          currencyLabel={currencyLabel(league.currency)}
          disabled={!canTrade}
        />
      </div>
    </div>
  );
}
