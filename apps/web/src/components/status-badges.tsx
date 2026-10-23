import type { LeagueStatus, MarketStatus } from "@aksjeliga/core";
import type { DateTime } from "luxon";

import { t } from "@/i18n";
import { formatCountdown } from "@/lib/format";
import { cn } from "@/lib/utils";

const LEAGUE_STYLE: Record<LeagueStatus, string> = {
  active: "bg-positive/15 text-positive",
  upcoming: "bg-primary/15 text-primary",
  finished: "bg-gold/15 text-gold",
  cancelled: "bg-muted text-muted-foreground",
};

export function LeagueStatusBadge({ status }: { status: LeagueStatus }) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold",
        LEAGUE_STYLE[status],
      )}
    >
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {t.status[status]}
    </span>
  );
}

/** "Slutter om 29 d 4 t" / "Starter om 2 d 1 t" / "Avsluttet". */
export function leagueCountdown(
  status: LeagueStatus,
  startsAt: DateTime,
  endsAt: DateTime,
  now: DateTime,
): string {
  if (status === "upcoming") return t.status.startsIn(formatCountdown(now, startsAt) ?? "");
  if (status === "active") return t.status.endsIn(formatCountdown(now, endsAt) ?? "");
  return t.status[status];
}

/** "● Åpen – stenger om 2 t 10 min" / "○ Stengt – åpner om 3 t 12 min". */
export function MarketStatusBadge({
  status,
  now,
  className,
}: {
  status: MarketStatus;
  now: DateTime;
  className?: string;
}) {
  const text = status.isOpen
    ? status.currentSession
      ? t.market.closesIn(formatCountdown(now, status.currentSession.closesAt) ?? "")
      : t.market.open
    : status.nextOpenAt
      ? t.market.opensIn(formatCountdown(now, status.nextOpenAt) ?? "")
      : t.market.closed;
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-sm",
        status.isOpen ? "text-positive" : "text-muted-foreground",
        className,
      )}
    >
      <span aria-hidden>{status.isOpen ? "●" : "○"}</span>
      {text}
    </span>
  );
}
