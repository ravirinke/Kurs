import type { LeagueCard as LeagueCardData } from "@aksjeliga/db";
import { ChevronRight, Trophy, UserPlus } from "lucide-react";
import type { DateTime } from "luxon";
import type { Route } from "next";
import Link from "next/link";

import { t } from "@/i18n";

import { Change } from "./change";
import { LeagueStatusBadge, leagueCountdown } from "./status-badges";

export function LeagueCard({ card, now }: { card: LeagueCardData; now: DateTime }) {
  const { league, status, me } = card;
  return (
    <Link
      href={`/ligaer/${league.id}` as Route}
      className="bg-card hover:border-primary/50 group flex flex-col gap-3 rounded-xl border p-4 transition-colors"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 flex-col gap-1">
          <h3 className="font-display truncate text-lg font-semibold">{league.name}</h3>
          <p className="text-muted-foreground text-sm">
            {leagueCountdown(status, league.startsAt, league.endsAt, now)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {card.pendingRequestCount > 0 && (
            <span className="bg-warning/15 text-warning inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold">
              <UserPlus aria-hidden className="size-3" />
              {t.leagues.pendingBadge(card.pendingRequestCount)}
            </span>
          )}
          <LeagueStatusBadge status={status} />
        </div>
      </div>

      {status === "upcoming" && <p className="text-sm">{t.leagues.members(card.memberCount)}</p>}

      {me && status !== "upcoming" && (
        <div className="flex items-end justify-between gap-3">
          <div className="flex flex-col">
            <span className="font-display text-2xl font-bold">
              {me.isTied
                ? t.leagues.sharedPlace(me.rank, card.memberCount)
                : t.leagues.place(me.rank, card.memberCount)}
            </span>
            {status === "finished" && card.winners.length > 0 && (
              <span className="text-gold flex items-center gap-1 text-sm font-medium">
                <Trophy aria-hidden className="size-4" />
                {card.winners.length === 1
                  ? t.leagues.winner(card.winners.join(", "))
                  : t.leagues.winners(card.winners.join(", "))}
              </span>
            )}
          </div>
          <div className="flex flex-col items-end gap-0.5 text-sm">
            <Change fraction={me.returnFraction} className="text-base font-semibold" />
            {me.dayChange && status === "active" && (
              <span className="text-muted-foreground">
                {t.leagues.today} <Change fraction={me.dayChange.fraction} />
              </span>
            )}
          </div>
        </div>
      )}
      <ChevronRight
        aria-hidden
        className="text-muted-foreground hidden size-4 self-end group-hover:block"
      />
    </Link>
  );
}
