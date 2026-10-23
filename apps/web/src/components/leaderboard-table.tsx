import type { LeaderboardRow } from "@aksjeliga/db";
import { Trophy } from "lucide-react";
import type { Route } from "next";
import Link from "next/link";

import { t } from "@/i18n";
import { formatMoneyWhole, formatMovement } from "@/lib/format";
import { cn } from "@/lib/utils";

import { Change } from "./change";

function Movement({ places }: { places: number | null }) {
  const color =
    places === null || places === 0
      ? "text-muted-foreground"
      : places > 0
        ? "text-positive"
        : "text-negative";
  return <span className={cn("tabular-nums", color)}>{formatMovement(places)}</span>;
}

/**
 * The league table. The viewer's own row is highlighted and sticks to the bottom of the
 * screen while it is scrolled out of view, so you always see your own place.
 */
export function LeaderboardTable({
  rows,
  leagueId,
  viewerUserId,
  showMovement,
}: {
  rows: LeaderboardRow[];
  leagueId: string;
  viewerUserId: string;
  showMovement: boolean;
}) {
  return (
    <div className="flex flex-col">
      <div className="text-muted-foreground grid grid-cols-[2rem_1fr_auto_auto] gap-3 px-3 pb-2 text-xs font-medium sm:grid-cols-[2.5rem_1fr_8rem_7rem_4rem]">
        <span>{t.league.columns.rank}</span>
        <span>{t.league.columns.name}</span>
        <span className="hidden text-right sm:block">{t.league.columns.value}</span>
        <span className="text-right">{t.league.columns.return}</span>
        {showMovement && <span className="text-right">{t.league.columns.today}</span>}
      </div>
      <ol className="flex flex-col gap-1">
        {rows.map((row) => {
          const isMe = row.userId === viewerUserId;
          return (
            <li key={row.memberId} className={cn(isMe && "sticky bottom-3 z-10")}>
              <Link
                href={`/ligaer/${leagueId}/medlemmer/${row.memberId}` as Route}
                className={cn(
                  "bg-card hover:border-primary/40 grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 rounded-lg border px-3 py-3 sm:grid-cols-[2.5rem_1fr_8rem_7rem_4rem]",
                  isMe && "border-primary bg-primary/5 shadow-md",
                )}
              >
                <span
                  className={cn(
                    "font-display text-lg font-bold tabular-nums",
                    row.rank === 1 && "text-gold",
                  )}
                >
                  {row.rank}
                  {row.isTied ? "=" : ""}
                </span>
                <span className="flex min-w-0 flex-col">
                  <span className="flex items-center gap-1.5 truncate font-medium">
                    {row.isWinner && (
                      <Trophy
                        aria-label={t.league.winnerBadge}
                        className="text-gold size-4 shrink-0"
                      />
                    )}
                    <span className="truncate">{row.displayName}</span>
                    {isMe && (
                      <span className="text-muted-foreground text-xs">({t.league.you})</span>
                    )}
                  </span>
                  <span className="text-muted-foreground text-xs tabular-nums sm:hidden">
                    {formatMoneyWhole(row.value)}
                  </span>
                </span>
                <span className="hidden text-right tabular-nums sm:block">
                  {formatMoneyWhole(row.value)}
                </span>
                <Change fraction={row.returnFraction} className="text-right font-semibold" />
                {showMovement && (
                  <span className="text-right text-sm">
                    <Movement places={row.movement} />
                  </span>
                )}
              </Link>
            </li>
          );
        })}
      </ol>
    </div>
  );
}

/** Top three, for a finished league. */
export function Podium({ rows }: { rows: LeaderboardRow[] }) {
  const top = rows.filter((row) => row.rank <= 3).slice(0, 3);
  return (
    <div className="grid grid-cols-3 items-end gap-2">
      {[top[1], top[0], top[2]].map((row, index) =>
        row ? (
          <div
            key={row.memberId}
            className={cn(
              "bg-card flex flex-col items-center gap-1 rounded-xl border p-3 text-center",
              index === 1 ? "border-gold pb-6" : "pb-3",
            )}
          >
            <span className={cn("font-display text-2xl font-bold", row.rank === 1 && "text-gold")}>
              {row.rank}.
            </span>
            <span className="w-full truncate font-medium">{row.displayName}</span>
            <Change fraction={row.returnFraction} className="text-sm" />
          </div>
        ) : (
          <div key={index} />
        ),
      )}
    </div>
  );
}
