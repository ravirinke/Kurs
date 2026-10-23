import type { Decimal } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import { t } from "@/i18n";

import { formatDateTime, formatPercent, formatTime } from "./format";

/** Any rejection or validation error from core or db: a code plus optional details. */
export interface CodedError {
  code: string;
  exchangeId?: string;
  closesAt?: DateTime;
  nextOpenAt?: DateTime | null;
  max?: number;
  limit?: Decimal;
}

/** Norwegian text for an error code. Unknown codes get a generic message. */
export function errorMessage(
  error: CodedError,
  exchangeNames: Record<string, string> = {},
): string {
  const messages = t.errors;
  switch (error.code) {
    case "NAME_TOO_LONG":
      return messages.NAME_TOO_LONG(error.max ?? 60);
    case "DESCRIPTION_TOO_LONG":
      return messages.DESCRIPTION_TOO_LONG(error.max ?? 500);
    case "END_BEFORE_MARKET_CLOSE":
      return messages.END_BEFORE_MARKET_CLOSE(
        exchangeNames[error.exchangeId ?? ""] ?? error.exchangeId ?? "",
        error.closesAt ? formatTime(error.closesAt) : "",
      );
    case "MARKET_CLOSED":
      return error.nextOpenAt
        ? messages.MARKET_CLOSED_UNTIL(formatDateTime(error.nextOpenAt))
        : messages.MARKET_CLOSED;
    case "MAX_POSITION_SHARE_EXCEEDED":
      return messages.MAX_POSITION_SHARE_EXCEEDED(
        error.limit ? formatPercent(error.limit, { signed: false, decimals: 0 }) : "",
      );
    default: {
      const message = (messages as Record<string, unknown>)[error.code];
      return typeof message === "string" ? message : messages.unknown;
    }
  }
}
