import {
  type Clock,
  type CorporateAction,
  type Exchange,
  type Instrument,
  MockPriceProvider,
} from "@aksjeliga/core";

import type { Executor } from "./client";
import { loadExchanges, loadInstruments } from "./repositories/reference";
import { DEFAULT_MOCK_BASE_PRICE, INSTRUMENT_CATALOGUE } from "./seed/instruments";

const basePriceByIsin = new Map(
  INSTRUMENT_CATALOGUE.map((entry) => [entry.isin, entry.mockBasePrice]),
);

/** A MockPriceProvider from already loaded reference data (cheap to build per request). */
export function buildMockPriceProvider(options: {
  clock: Clock;
  exchanges: readonly Exchange[];
  instruments: readonly Instrument[];
  corporateActions?: readonly CorporateAction[];
}): MockPriceProvider {
  return new MockPriceProvider({
    clock: options.clock,
    exchanges: options.exchanges,
    instruments: options.instruments.map((instrument) => ({
      instrument,
      basePrice: basePriceByIsin.get(instrument.isin) ?? DEFAULT_MOCK_BASE_PRICE,
    })),
    ...(options.corporateActions ? { corporateActions: options.corporateActions } : {}),
  });
}

/**
 * A MockPriceProvider for the instruments and exchanges in the database. Callers get a
 * plain PriceProvider and never need to know it is a mock.
 */
export async function createMockPriceProvider(
  db: Executor,
  options: { clock: Clock; corporateActions?: readonly CorporateAction[] },
): Promise<MockPriceProvider> {
  const [exchanges, instruments] = await Promise.all([loadExchanges(db), loadInstruments(db)]);
  return buildMockPriceProvider({ ...options, exchanges, instruments });
}
