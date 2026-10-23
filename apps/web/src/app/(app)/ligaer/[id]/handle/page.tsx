import { Money } from "@aksjeliga/core";
import { loadInstrumentQuotes, loadTradingHome } from "@aksjeliga/db";
import { ChevronRight, Search } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { BackLink } from "@/components/back-link";
import { InstrumentRow } from "@/components/instrument-row";
import { type Mover, Movers } from "@/components/movers";
import { MarketStatusBadge } from "@/components/status-badges";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { formatMoney } from "@/lib/format";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireLeagueMember } from "@/server/league-access";
import { getPrices } from "@/server/prices";

export const metadata: Metadata = { title: t.trade.title };

export default async function TradingPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ bors?: string; q?: string }>;
}) {
  const { id } = await params;
  const { bors, q } = await searchParams;
  const { league, member } = await requireLeagueMember(id, `/ligaer/${id}/handle`);
  const now = await serverNow();
  const db = getDb();
  const prices = await getPrices(now);
  const home = await loadTradingHome(db, prices, { leagueId: id, now });
  if (!home) notFound();

  const search = q?.trim() ?? "";
  const exchange = home.exchanges.find((entry) => entry.exchange.id === bors);
  const list =
    search || exchange
      ? await loadInstrumentQuotes(db, prices, {
          leagueId: id,
          now,
          ...(search ? { search } : {}),
          ...(exchange ? { exchangeId: exchange.exchange.id } : {}),
        })
      : null;
  const toMover = (entry: (typeof home.winners)[number]): Mover => ({
    key: entry.instrument.id,
    label: entry.instrument.name,
    sublabel: `${entry.instrument.ticker} · ${entry.exchange.name}`,
    fraction: entry.quote.changeFraction,
    href: `/ligaer/${id}/aksjer/${entry.instrument.id}` as Route,
  });

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh enabled={home.exchanges.some((entry) => entry.status.isOpen)} />
      <BackLink href={`/ligaer/${id}` as Route}>{league.name}</BackLink>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t.trade.title}</h1>
        <p className="text-sm">
          <span className="text-muted-foreground">{t.trade.cash}: </span>
          <span className="font-semibold tabular-nums">
            {formatMoney(Money.of(member.cashBalance, league.currency))}
          </span>
        </p>
      </header>

      <form className="relative" action={`/ligaer/${id}/handle`}>
        <Search
          aria-hidden
          className="text-muted-foreground absolute top-1/2 left-3 size-4 -translate-y-1/2"
        />
        <Input
          name="q"
          type="search"
          defaultValue={search}
          placeholder={t.trade.search}
          aria-label={t.trade.search}
          className="pl-9"
        />
      </form>

      {list ? (
        <section className="flex flex-col gap-3">
          {exchange && (
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="font-display text-xl font-semibold">{exchange.exchange.name}</h2>
              <MarketStatusBadge status={exchange.status} now={now} />
            </div>
          )}
          {list.length === 0 ? (
            <p className="text-muted-foreground">{t.trade.noResults}</p>
          ) : (
            <ul className="flex flex-col gap-1">
              {list.map((entry) => (
                <InstrumentRow key={entry.instrument.id} entry={entry} leagueId={id} />
              ))}
            </ul>
          )}
          <Link href={`/ligaer/${id}/handle` as Route} className="text-primary text-sm">
            {t.nav.back}
          </Link>
        </section>
      ) : (
        <>
          <Movers winners={home.winners.map(toMover)} losers={home.losers.map(toMover)} />
          <section className="flex flex-col gap-2">
            <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
              {t.trade.exchanges}
            </h2>
            <ul className="flex flex-col gap-1">
              {home.exchanges.map((entry) => (
                <li key={entry.exchange.id}>
                  <Link
                    href={`/ligaer/${id}/handle?bors=${entry.exchange.id}` as Route}
                    className="bg-card hover:border-primary/40 flex items-center justify-between gap-3 rounded-lg border px-4 py-3"
                  >
                    <span className="flex flex-col">
                      <span className="font-medium">{entry.exchange.name}</span>
                      <MarketStatusBadge status={entry.status} now={now} className="text-xs" />
                    </span>
                    <span className="text-muted-foreground flex items-center gap-1 text-sm">
                      {t.trade.stocks(entry.instrumentCount)}{" "}
                      <ChevronRight aria-hidden className="size-4" />
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  );
}
