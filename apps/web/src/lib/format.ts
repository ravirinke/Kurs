/*
 * All number, money and date formatting for the UI, in Norwegian (nb-NO):
 * "19 805,00 kr", "182,40 USD", "+2,34 %", "23. okt. 14:30".
 *
 * Values are rounded half-up with decimal.js first and handed to Intl as strings, so no
 * amount ever passes through a JS number. Spaces inside a value are non-breaking.
 */
import {
  APP_TIME_ZONE,
  type Currency,
  type Decimal,
  type Money,
  roundHalfUp,
} from "@aksjeliga/core";
import type { DateTime } from "luxon";

const LOCALE = "nb-NO";
const NBSP = "\u00A0";
const MINUS = "−";

const formatters = new Map<string, Intl.NumberFormat>();

function numberFormat(decimals: number, signed: boolean): Intl.NumberFormat {
  const key = `${String(decimals)}:${String(signed)}`;
  let formatter = formatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(LOCALE, {
      minimumFractionDigits: decimals,
      maximumFractionDigits: decimals,
      signDisplay: signed ? "exceptZero" : "auto",
    });
    formatters.set(key, formatter);
  }
  return formatter;
}

/** A plain number with fixed decimals: "1 234,50". */
export function formatNumber(
  value: Decimal,
  decimals = 2,
  options: { signed?: boolean } = {},
): string {
  const rounded = roundHalfUp(value, decimals);
  // Never show "−0,00".
  const shown = rounded.isZero() ? rounded.abs() : rounded;
  return numberFormat(decimals, options.signed ?? false).format(
    shown.toFixed(decimals) as `${number}`,
  );
}

/** "kr" for NOK; the currency code for everything else, so SEK and DKK are never confused with NOK. */
export function currencyLabel(currency: Currency): string {
  return currency === "NOK" ? "kr" : currency;
}

/** "19 805,00 kr", "182,40 USD", "+1 200,00 kr" (signed). */
export function formatMoney(
  money: Money,
  options: { decimals?: number; signed?: boolean } = {},
): string {
  return `${formatNumber(money.amount, options.decimals ?? 2, options)}${NBSP}${currencyLabel(money.currency)}`;
}

/** "19 805 kr": for big headline numbers where øre is noise. */
export function formatMoneyWhole(money: Money): string {
  return formatMoney(money, { decimals: 0 });
}

/** A price in its trading currency: 2 decimals, or up to 4 when it has them ("0,1234 USD"). */
export function formatPrice(price: Money): string {
  const decimals = Math.min(4, Math.max(2, price.amount.decimalPlaces()));
  return formatMoney(price, { decimals });
}

/** A fraction as a percentage: 0.0234 → "+2,34 %". Zero is "0,00 %" without a sign. */
export function formatPercent(
  fraction: Decimal,
  options: { signed?: boolean; decimals?: number } = {},
): string {
  return `${formatNumber(fraction.times(100), options.decimals ?? 2, { signed: options.signed ?? true })}${NBSP}%`;
}

export type Direction = "up" | "down" | "flat";

/** Direction of a change after rounding to what is shown, so "0,00 %" is never red. */
export function direction(value: Decimal, decimals = 4): Direction {
  const rounded = roundHalfUp(value, decimals);
  if (rounded.isZero()) return "flat";
  return rounded.isNegative() ? "down" : "up";
}

/** The arrow that goes with a direction (colour is never the only signal). */
export function arrow(dir: Direction): string {
  return dir === "up" ? "▲" : dir === "down" ? "▼" : "";
}

/**
 * An FX rate for display: 2 decimals when ≥ 1, 4 when below. In a trade breakdown, pass
 * `full` to show the exact locked rate (up to 6 decimals) so the user can check the sum.
 */
export function formatFxRate(rate: Decimal, options: { full?: boolean } = {}): string {
  if (options.full) {
    const decimals = Math.min(6, Math.max(2, rate.decimalPlaces()));
    return formatNumber(rate, decimals);
  }
  return formatNumber(rate, rate.greaterThanOrEqualTo(1) ? 2 : 4);
}

/** Whole shares: "1 250". */
export function formatQuantity(quantity: Decimal): string {
  return formatNumber(quantity, Math.min(6, quantity.decimalPlaces()));
}

/** Movement on the leaderboard: "▲ 2", "▼ 1", "–". */
export function formatMovement(places: number | null): string {
  if (places === null || places === 0) return "–";
  return `${places > 0 ? "▲" : "▼"}${NBSP}${String(Math.abs(places))}`;
}

function local(at: DateTime): DateTime {
  return at.setZone(APP_TIME_ZONE).setLocale(LOCALE);
}

/** "okt." for abbreviated months, "mai" for those that are not (Norwegian convention). */
function shortMonth(at: DateTime): string {
  const short = at.toFormat("LLL").replace(/\.$/, "");
  return short.length < at.toFormat("LLLL").length ? `${short}.` : short;
}

/** "23. okt. 14:30" (in Norwegian time). */
export function formatDateTime(at: DateTime): string {
  const time = local(at);
  return `${time.toFormat("d.")} ${shortMonth(time)} ${time.toFormat("HH:mm")}`;
}

/** "23. okt. 2026". */
export function formatDate(at: DateTime): string {
  const time = local(at);
  return `${time.toFormat("d.")} ${shortMonth(time)} ${time.toFormat("yyyy")}`;
}

/** "14:30". */
export function formatTime(at: DateTime): string {
  return local(at).toFormat("HH:mm");
}

/** "fredag 23. oktober kl. 22:00". */
export function formatLongDateTime(at: DateTime): string {
  return local(at).toFormat("cccc d. LLLL 'kl.' HH:mm");
}

/**
 * Time left until `to`, as a short countdown: "29 d 4 t", "3 t 12 min", "12 min",
 * "under 1 min". Returns null when `to` has passed.
 */
export function formatCountdown(from: DateTime, to: DateTime): string | null {
  const totalMinutes = Math.floor((to.toMillis() - from.toMillis()) / 60_000);
  if (to.toMillis() <= from.toMillis()) return null;
  if (totalMinutes < 1) return "under 1 min";
  const days = Math.floor(totalMinutes / (60 * 24));
  const hours = Math.floor((totalMinutes % (60 * 24)) / 60);
  const minutes = totalMinutes % 60;
  if (days > 0) return `${String(days)}${NBSP}d ${String(hours)}${NBSP}t`;
  if (hours > 0) return `${String(hours)}${NBSP}t ${String(minutes)}${NBSP}min`;
  return `${String(minutes)}${NBSP}min`;
}

export { MINUS, NBSP };
