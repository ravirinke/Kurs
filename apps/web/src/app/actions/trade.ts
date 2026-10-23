"use server";

import { maxQuantityForAmount, Money, type Quote, type TradeSide } from "@aksjeliga/core";
import {
  createQuote,
  executeTrade,
  loadInstrument,
  loadLeague,
  type TradingRejection,
} from "@aksjeliga/db";
import type { DateTime } from "luxon";
import { revalidatePath } from "next/cache";

import { t } from "@/i18n";
import { errorMessage } from "@/lib/errors";
import { formatFxRate, formatMoney, formatPrice, formatQuantity } from "@/lib/format";
import { parseDecimalInput } from "@/lib/parse";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { getPrices } from "@/server/prices";
import { requireProfile } from "@/server/session";

/** A quote as the trade sheet shows it: every number already formatted on the server. */
export interface QuoteView {
  quoteId: string;
  side: TradeSide;
  quantity: string;
  /** Plain decimal string, to ask for a fresh quote with the same quantity. */
  quantityRaw: string;
  calculation: string;
  fee: string;
  total: string;
  /** Milliseconds until the price expires, measured on the server. */
  expiresInMs: number;
}

export type QuoteResult = { ok: true; quote: QuoteView } | { ok: false; message: string };
export type ConfirmResult =
  { ok: true; message: string } | { ok: false; message: string; retry: boolean };

function describeQuote(quote: Quote, now: DateTime): QuoteView {
  const quantity = formatQuantity(quote.quantity);
  const sameCurrency = quote.price.currency === quote.grossAmount.currency;
  const calculation = sameCurrency
    ? `${quantity} × ${formatPrice(quote.price)} = ${formatMoney(quote.grossAmount)}`
    : `${quantity} × ${formatPrice(quote.price)} × ${formatFxRate(quote.fxRate.rate, { full: true })} = ${formatMoney(quote.grossAmount)}`;
  return {
    quoteId: quote.id,
    side: quote.side,
    quantity,
    quantityRaw: quote.quantity.toFixed(),
    calculation,
    fee: `${quote.side === "buy" ? "+" : "−"} ${t.trade.sheet.fee} ${formatMoney(quote.fee)}`,
    total: formatMoney(quote.totalAmount),
    expiresInMs: Math.max(0, quote.expiresAt.toMillis() - now.toMillis()),
  };
}

function firstMessage(rejections: readonly TradingRejection[]): string {
  const [first] = rejections;
  return first ? errorMessage(first) : t.errors.unknown;
}

/**
 * Step 1: price an order. The client sends instrument, side and either a quantity or an
 * amount of money; the server turns an amount into whole shares and locks the price.
 */
export async function requestQuote(input: {
  leagueId: string;
  instrumentId: string;
  side: TradeSide;
  mode: "quantity" | "amount";
  value: string;
}): Promise<QuoteResult> {
  const { user } = await requireProfile();
  const now = await serverNow();
  const db = getDb();
  const prices = await getPrices(now);

  const value = parseDecimalInput(input.value);
  if (!value) return { ok: false, message: t.errors.INVALID_QUANTITY };
  let quantity = value;

  if (input.mode === "amount") {
    const [league, instrument] = await Promise.all([
      loadLeague(db, input.leagueId),
      loadInstrument(db, input.instrumentId),
    ]);
    if (!league || !instrument) return { ok: false, message: t.errors.INSTRUMENT_NOT_FOUND };
    const [price, rate] = await Promise.all([
      prices.getQuote(instrument.id, now),
      prices.getFxRate(instrument.currency, league.currency, now),
    ]);
    quantity = maxQuantityForAmount({
      amount: Money.of(value, league.currency),
      price: price.price,
      fxRate: rate,
      feeRule: league.feeRule,
    });
    if (quantity.isZero()) return { ok: false, message: t.errors.AMOUNT_TOO_SMALL };
  }

  const result = await createQuote(db, prices, {
    userId: user.id,
    leagueId: input.leagueId,
    order: { type: "market", side: input.side, instrumentId: input.instrumentId, quantity },
    now,
  });
  if (!result.ok) return { ok: false, message: firstMessage(result.rejections) };
  return { ok: true, quote: describeQuote(result.quote, now) };
}

/** Step 2: execute the quote the user saw, at exactly that price. */
export async function confirmTrade(input: {
  leagueId: string;
  instrumentId: string;
  instrumentName: string;
  quoteId: string;
  idempotencyKey: string;
}): Promise<ConfirmResult> {
  const { user } = await requireProfile();
  const now = await serverNow();
  const db = getDb();
  const result = await executeTrade(db, await getPrices(now), {
    userId: user.id,
    quoteId: input.quoteId,
    idempotencyKey: input.idempotencyKey,
    now,
  });
  if (!result.ok) {
    const retry = result.rejections.some(
      (rejection) => rejection.code === "QUOTE_EXPIRED" || rejection.code === "QUOTE_ALREADY_USED",
    );
    return { ok: false, message: firstMessage(result.rejections), retry };
  }

  revalidatePath(`/ligaer/${input.leagueId}`, "layout");
  const { quote } = result;
  const quantity = formatQuantity(quote.quantity);
  const total = formatMoney(quote.totalAmount);
  return {
    ok: true,
    message:
      quote.side === "buy"
        ? t.trade.sheet.bought(quantity, input.instrumentName, total)
        : t.trade.sheet.sold(quantity, input.instrumentName, total),
  };
}
