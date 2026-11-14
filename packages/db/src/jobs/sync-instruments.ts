import { and, eq, inArray } from "drizzle-orm";

import type { Database } from "../client";
import { type ListedInstrument, type MarketData, MarketDataError } from "../prices/sources/types";
import { exchanges, instruments } from "../schema";

export interface InstrumentSyncReport {
  added: number;
  reactivated: number;
  deactivated: number;
  /** Exchanges whose list could not be fetched this time; they are left untouched. */
  failed: string[];
}

/** A list this short means the source is broken, not that the exchange emptied. */
const MIN_PLAUSIBLE_LIST = 50;
const INSERT_CHUNK = 500;
/** Words kept in capitals when a name arrives in all caps ("BW LPG", "DNB BANK ASA"). */
const SHORT_WORD = 3;

/** "FIRST SOLAR INC" → "First Solar Inc". Names that already have lower case are kept. */
export function displayName(name: string): string {
  if (name !== name.toUpperCase()) return name;
  return name
    .split(" ")
    .map((word) =>
      word.length <= SHORT_WORD ? word : word.charAt(0) + word.slice(1).toLowerCase(),
    )
    .join(" ");
}

/**
 * Brings the instrument table in line with the exchanges' own lists: new shares are added,
 * ones that have left a list are marked inactive (never deleted: trades refer to them) and
 * ones that are back are reactivated. Names and ISINs we already have are left alone.
 * Idempotent; a failing source only means that exchange waits until the next run.
 */
export async function syncInstruments(
  db: Database,
  marketData: MarketData,
): Promise<InstrumentSyncReport> {
  const report: InstrumentSyncReport = { added: 0, reactivated: 0, deactivated: 0, failed: [] };
  const known = await db.select({ id: exchanges.id }).from(exchanges);

  for (const { id: exchangeId } of known) {
    if (!marketData.exchangeIds.includes(exchangeId)) continue;
    let listed: ListedInstrument[];
    try {
      listed = await marketData.listInstruments(exchangeId);
    } catch (error) {
      if (!(error instanceof MarketDataError)) throw error;
      report.failed.push(exchangeId);
      continue;
    }
    if (listed.length < MIN_PLAUSIBLE_LIST) {
      report.failed.push(exchangeId);
      continue;
    }

    const existing = await db
      .select({ id: instruments.id, ticker: instruments.ticker, isActive: instruments.isActive })
      .from(instruments)
      .where(eq(instruments.exchangeId, exchangeId));
    const existingTickers = new Set(existing.map((row) => row.ticker));
    const listedTickers = new Set(listed.map((entry) => entry.ticker));

    const fresh = listed.filter((entry) => !existingTickers.has(entry.ticker));
    for (let start = 0; start < fresh.length; start += INSERT_CHUNK) {
      const inserted = await db
        .insert(instruments)
        .values(
          fresh.slice(start, start + INSERT_CHUNK).map((entry) => ({
            ticker: entry.ticker,
            isin: entry.isin,
            name: displayName(entry.name),
            exchangeId,
            currency: entry.currency,
          })),
        )
        // For example an ISIN we already have under another ticker: ours is kept.
        .onConflictDoNothing()
        .returning({ id: instruments.id });
      report.added += inserted.length;
    }

    const back = existing.filter((row) => !row.isActive && listedTickers.has(row.ticker));
    const gone = existing.filter((row) => row.isActive && !listedTickers.has(row.ticker));
    for (const [rows, isActive] of [
      [back, true],
      [gone, false],
    ] as const) {
      if (rows.length === 0) continue;
      await db
        .update(instruments)
        .set({ isActive })
        .where(
          and(
            eq(instruments.exchangeId, exchangeId),
            inArray(
              instruments.id,
              rows.map((row) => row.id),
            ),
          ),
        );
    }
    report.reactivated += back.length;
    report.deactivated += gone.length;
  }
  return report;
}
