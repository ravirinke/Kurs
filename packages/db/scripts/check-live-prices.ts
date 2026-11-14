/*
 * Manual check of the real price provider against the local database: prices a few known
 * shares through the same cache the app uses and prints what it got. Not part of the tests.
 *
 *   pnpm --filter @aksjeliga/db exec tsx scripts/check-live-prices.ts [TICKER ...]
 *
 * Needs the local database (pnpm db:start) and, for Finnhub quotes, FINNHUB_API_KEY in .env.
 * A warning about "a closed day in our calendar" means the exchange calendar in
 * packages/core/src/market/exchanges.ts is wrong for that date.
 */
import { fixedClock } from "@aksjeliga/core";
import { inArray } from "drizzle-orm";
import { DateTime } from "luxon";

import {
  CachedPriceProvider,
  createDatabase,
  createLiveMarketData,
  loadExchanges,
  loadRootEnv,
  requireEnv,
  schema,
} from "../src";

loadRootEnv();

const DEFAULT_TICKERS = ["EQNR", "DNB", "AAPL", "MSFT", "JPM"];
const tickers = process.argv.slice(2).length > 0 ? process.argv.slice(2) : DEFAULT_TICKERS;

const { db, close } = createDatabase(requireEnv("DATABASE_URL"), { maxConnections: 5 });
try {
  const now = DateTime.utc();
  const provider = new CachedPriceProvider({
    db,
    clock: fixedClock(now),
    exchanges: await loadExchanges(db),
    marketData: createLiveMarketData({ finnhubApiKey: process.env["FINNHUB_API_KEY"] }),
  });
  const instruments = await db
    .select()
    .from(schema.instruments)
    .where(inArray(schema.instruments.ticker, tickers));

  console.log(`Now: ${now.toISO()}`);
  const started = performance.now();
  await Promise.all(
    instruments.map(async (instrument) => {
      const [quote, previous, year, week, actions, toNok] = await Promise.all([
        provider.getQuote(instrument.id, now),
        provider.getLastClose(instrument.id, now.minus({ days: 7 })),
        provider.getPriceHistory(instrument.id, now.minus({ years: 1 }), now, "1d"),
        provider.getPriceHistory(instrument.id, now.minus({ weeks: 1 }), now, "1h"),
        provider.getCorporateActions(instrument.id, now.minus({ days: 60 }), now),
        provider.getFxRate(instrument.currency, "NOK", now),
      ]);
      console.log(
        [
          `${instrument.ticker} (${instrument.exchangeId})`,
          `${quote.price.amount.toFixed()} ${instrument.currency} [${quote.source}${quote.delayed ? ", delayed" : ""}]`,
          `price from ${quote.at.toISO()}`,
          `close a week ago ${previous.price.amount.toFixed()} (${previous.closedAt.toISODate()})`,
          `1y chart ${String(year.length)} days from ${year[0]?.price.amount.toFixed(2) ?? "-"}`,
          `1w chart ${String(week.length)} points`,
          `${String(actions.length)} corporate actions in 60 days`,
          `${instrument.currency}/NOK ${toNok.rate.toFixed(4)}`,
        ].join(" | "),
      );
      for (const action of actions) {
        console.log(
          action.kind === "split"
            ? `    split ${action.ratioFrom.toFixed()}:${action.ratioTo.toFixed()} effective ${action.effectiveDate}`
            : `    dividend ${action.amountPerShare.amount.toFixed()} ${action.amountPerShare.currency}, ex-date ${action.exDate}`,
        );
      }
    }),
  );
  console.log(`Took ${String(Math.round(performance.now() - started))} ms`);

  const errors = await db.select().from(schema.priceFetchState);
  const asked = instruments.map((instrument) => instrument.id);
  for (const row of errors.filter(
    (state) => state.lastError && asked.some((id) => state.key.endsWith(id)),
  ))
    console.log(`Source error for ${row.key}: ${row.lastError ?? ""}`);
} finally {
  await close();
}
