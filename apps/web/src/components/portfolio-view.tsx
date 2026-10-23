import type { PortfolioView as PortfolioData } from "@aksjeliga/db";
import { ChevronLeft, EyeOff } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { t } from "@/i18n";
import {
  direction,
  formatDateTime,
  formatFxRate,
  formatMoney,
  formatMoneyWhole,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";

import { Change } from "./change";
import { PriceChart } from "./price-chart";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="font-display text-xl font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function AllocationBars({
  slices,
}: {
  slices: { label: string; value: string; percent: string; width: string }[];
}) {
  return (
    <ul className="flex flex-col gap-2">
      {slices.map((slice) => (
        <li key={slice.label} className="flex flex-col gap-1 text-sm">
          <span className="flex justify-between gap-2">
            <span className="truncate">{slice.label}</span>
            <span className="text-muted-foreground shrink-0 tabular-nums">
              {slice.percent} · {slice.value}
            </span>
          </span>
          <span className="bg-muted h-2 overflow-hidden rounded-full">
            <span className="bg-primary block h-full rounded-full" style={{ width: slice.width }} />
          </span>
        </li>
      ))}
    </ul>
  );
}

export function PortfolioView({ view, leagueId }: { view: PortfolioData; leagueId: string }) {
  const { summary, access } = view;
  const title = view.isOwn ? t.portfolio.title : t.portfolio.titleOf(view.member.displayName);
  const bars = (slices: NonNullable<PortfolioData["allocation"]>["byInstrument"]) =>
    slices.map((slice) => ({
      label: slice.label || t.portfolio.cash,
      value: formatMoneyWhole(slice.value),
      percent: formatPercent(slice.fraction, { signed: false, decimals: 1 }),
      width: `${slice.fraction.times(100).toDecimalPlaces(1).toFixed(1)}%`,
    }));

  return (
    <div className="flex flex-col gap-8">
      <Link
        href={`/ligaer/${leagueId}` as Route}
        className="text-muted-foreground flex items-center gap-1 text-sm"
      >
        <ChevronLeft aria-hidden className="size-4" /> {view.league.name}
      </Link>

      <header className="flex flex-col gap-1">
        <h1 className="text-muted-foreground text-sm font-medium">{title}</h1>
        <p className="font-display text-4xl font-bold tabular-nums" data-testid="portfolio-value">
          {formatMoney(summary.value)}
        </p>
        <p className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <span>
            <Change fraction={summary.returnFraction} amount={summary.returnAmount} />{" "}
            <span className="text-muted-foreground">{t.portfolio.sinceStart}</span>
          </span>
          {summary.dayChange && (
            <span>
              <Change fraction={summary.dayChange.fraction} />{" "}
              <span className="text-muted-foreground">{t.portfolio.today}</span>
            </span>
          )}
        </p>
        {view.cash && (
          <p className="text-sm">
            <span className="text-muted-foreground">{t.portfolio.cash}: </span>
            <span className="font-medium tabular-nums">{formatMoney(view.cash)}</span>
          </p>
        )}
      </header>

      {view.history.length > 1 && (
        <Section title={t.portfolio.chart}>
          <PriceChart
            points={view.history}
            direction={direction(summary.returnFraction)}
            label={t.portfolio.chart}
          />
        </Section>
      )}

      {access.kind === "returnOnly" && (
        <p className="bg-muted flex items-center gap-2 rounded-xl p-4 text-sm">
          <EyeOff aria-hidden className="size-4 shrink-0" />
          {t.portfolio.hiddenNote}
        </p>
      )}

      {(access.kind === "full" || access.kind === "delayed") && (
        <>
          {access.kind === "delayed" && view.holdingsAsOf && (
            <p className="text-muted-foreground text-sm">
              {t.portfolio.delayedNote(formatDateTime(view.holdingsAsOf))}
            </p>
          )}
          <Section title={t.portfolio.holdings}>
            {view.holdings.length === 0 ? (
              <p className="text-muted-foreground">{t.portfolio.noHoldings}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {view.holdings.map((holding) => (
                  <li key={holding.instrument.id}>
                    <Link
                      href={`/ligaer/${leagueId}/aksjer/${holding.instrument.id}` as Route}
                      className="bg-card hover:border-primary/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
                    >
                      <span className="flex min-w-0 flex-col">
                        <span className="truncate font-medium">{holding.instrument.name}</span>
                        <span className="text-muted-foreground truncate text-xs">
                          {holding.instrument.ticker} · {holding.exchangeName} ·{" "}
                          {t.portfolio.quantity(formatQuantity(holding.quantity))}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-0.5 text-sm">
                        <span className="font-semibold tabular-nums">
                          {formatMoney(holding.value)}
                        </span>
                        <span className="flex gap-2 text-xs">
                          <Change fraction={holding.returnFraction} />
                          {holding.dayChange && (
                            <span className="text-muted-foreground">
                              {t.portfolio.today} <Change fraction={holding.dayChange.fraction} />
                            </span>
                          )}
                        </span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {view.allocation && (
            <Section title={t.portfolio.allocation}>
              <div className="grid gap-6 sm:grid-cols-2">
                <div className="flex flex-col gap-2">
                  <h3 className="text-muted-foreground text-sm font-medium">
                    {t.portfolio.byStock}
                  </h3>
                  <AllocationBars
                    slices={bars([...view.allocation.byInstrument, view.allocation.cash])}
                  />
                </div>
                <div className="flex flex-col gap-2">
                  <h3 className="text-muted-foreground text-sm font-medium">
                    {t.portfolio.byExchange}
                  </h3>
                  <AllocationBars
                    slices={bars([...view.allocation.byExchange, view.allocation.cash])}
                  />
                </div>
              </div>
            </Section>
          )}

          <Section title={t.portfolio.trades}>
            {view.trades.length === 0 ? (
              <p className="text-muted-foreground">{t.portfolio.noTrades}</p>
            ) : (
              <ul className="flex flex-col gap-1">
                {view.trades.map((trade) => (
                  <li
                    key={trade.id}
                    className="bg-card flex flex-col gap-1 rounded-lg border px-3 py-2.5 text-sm"
                  >
                    <span className="flex justify-between gap-2">
                      <span>
                        <span
                          className={cn(
                            "font-semibold",
                            trade.side === "buy" ? "text-positive" : "text-negative",
                          )}
                        >
                          {trade.side === "buy"
                            ? t.portfolio.tradeLine.buy
                            : t.portfolio.tradeLine.sell}
                        </span>{" "}
                        {formatQuantity(trade.quantity)} {trade.instrument.name}
                      </span>
                      <span className="font-medium tabular-nums">
                        {formatMoney(trade.totalAmount)}
                      </span>
                    </span>
                    <span className="text-muted-foreground text-xs tabular-nums">
                      {formatDateTime(trade.at)} · {formatPrice(trade.price)}
                      {trade.price.currency !== trade.totalAmount.currency &&
                        ` · ${t.portfolio.tradeLine.fx} ${formatFxRate(trade.fxRate, { full: true })}`}
                      {` · ${t.portfolio.tradeLine.fee} ${formatMoney(trade.fee)}`}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </>
      )}
    </div>
  );
}
