/*
 * Manual check of the exchange calendars in packages/core against reality: compares the
 * trading days the calendar expects with the days a very liquid share actually traded
 * (stored by scripts/check-live-prices.ts or the app). Not part of the tests.
 *
 *   pnpm --filter @aksjeliga/db exec tsx scripts/check-live-prices.ts
 *   pnpm --filter @aksjeliga/db exec tsx scripts/check-calendar.ts [from yyyy-MM-dd]
 */
import { getSession, localDate } from "@aksjeliga/core";
import { and, eq, gte } from "drizzle-orm";
import { DateTime } from "luxon";

import { createDatabase, loadExchanges, loadRootEnv, requireEnv, schema, toDateTime } from "../src";

loadRootEnv();

/** One share per exchange that trades every single session. */
const REFERENCE: Readonly<Record<string, string>> = { XOSL: "EQNR", XNAS: "AAPL", XNYS: "JPM" };
const from = DateTime.fromISO(process.argv[2] ?? "2026-01-01", { zone: "utc" });

const { db, close } = createDatabase(requireEnv("DATABASE_URL"), { maxConnections: 2 });
try {
  const today = DateTime.utc();
  for (const exchange of await loadExchanges(db)) {
    const ticker = REFERENCE[exchange.id];
    if (!ticker) continue;
    const rows = await db
      .select({ at: schema.prices.at })
      .from(schema.prices)
      .innerJoin(schema.instruments, eq(schema.instruments.id, schema.prices.instrumentId))
      .where(
        and(
          eq(schema.instruments.ticker, ticker),
          eq(schema.instruments.exchangeId, exchange.id),
          eq(schema.prices.kind, "close"),
          gte(schema.prices.at, from.toJSDate()),
        ),
      );
    const traded = new Set(rows.map((row) => localDate(toDateTime(row.at), exchange.timeZone)));
    const missing: string[] = [];
    let sessions = 0;
    for (let day = from; day.toMillis() < today.minus({ days: 1 }).toMillis();) {
      const date = day.toFormat("yyyy-MM-dd");
      if (getSession(exchange, date)) {
        sessions += 1;
        if (!traded.has(date)) missing.push(date);
      }
      day = day.plus({ days: 1 });
    }
    console.log(
      `${exchange.id}: the calendar has ${String(sessions)} sessions since ${from.toISODate() ?? ""}, ` +
        `${ticker} traded on ${String(traded.size)} days.`,
    );
    if (missing.length > 0)
      console.log(`  Open in our calendar, but ${ticker} did not trade: ${missing.join(", ")}`);
  }
  console.log(
    "Days that traded but are closed in our calendar are warned about when prices are fetched.",
  );
} finally {
  await close();
}
