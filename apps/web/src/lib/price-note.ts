import { APP_TIME_ZONE, localDate } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import { t } from "@/i18n";

import { formatDateTime, formatTime } from "./format";

/**
 * The line under a price that says what kind of price it is: at the close, made up (the
 * mock), real time, or delayed, with the time of the last trade so its age is always clear.
 */
export function priceNote(
  quote: { source: "live" | "last_close"; at: DateTime; delayed: boolean },
  options: { now: DateTime; fictional: boolean },
): string {
  if (quote.source === "last_close") return t.market.atClose;
  if (options.fictional) return t.market.live;
  const sameDay = localDate(quote.at, APP_TIME_ZONE) === localDate(options.now, APP_TIME_ZONE);
  const time = sameDay ? formatTime(quote.at) : formatDateTime(quote.at);
  return quote.delayed ? t.market.delayed(time) : t.market.realTime(time);
}
