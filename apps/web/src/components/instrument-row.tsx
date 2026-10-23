import type { InstrumentQuote } from "@aksjeliga/db";
import type { Route } from "next";
import Link from "next/link";

import { formatPrice } from "@/lib/format";

import { Change } from "./change";

export function InstrumentRow({ entry, leagueId }: { entry: InstrumentQuote; leagueId: string }) {
  const { instrument, exchange, quote } = entry;
  return (
    <li>
      <Link
        href={`/ligaer/${leagueId}/aksjer/${instrument.id}` as Route}
        className="bg-card hover:border-primary/40 flex items-center justify-between gap-3 rounded-lg border px-3 py-3"
      >
        <span className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{instrument.name}</span>
          <span className="text-muted-foreground truncate text-xs">
            {instrument.ticker} · {exchange.name}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end">
          <span className="font-medium tabular-nums">{formatPrice(quote.price)}</span>
          <Change fraction={quote.changeFraction} className="text-xs" />
        </span>
      </Link>
    </li>
  );
}
