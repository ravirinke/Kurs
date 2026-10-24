import { deriveLeagueStatus } from "@aksjeliga/core";
import {
  finalizeLeagueIfDue,
  loadActivity,
  loadActiveMembers,
  loadExchanges,
  loadLeaderboard,
  loadPendingJoinRequests,
} from "@aksjeliga/db";
import { Briefcase, CandlestickChart, Settings } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { decideJoinRequestAction } from "@/app/actions/leagues";
import { ActionButton } from "@/components/action-button";
import { AutoRefresh } from "@/components/auto-refresh";
import { BackLink } from "@/components/back-link";
import { LeaderboardTable, Podium } from "@/components/leaderboard-table";
import { type Mover, Movers } from "@/components/movers";
import { ShareInvite } from "@/components/share-invite";
import { LeagueStatusBadge, leagueCountdown } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import {
  formatDate,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatPrice,
  formatQuantity,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireLeagueMember } from "@/server/league-access";
import { getPrices } from "@/server/prices";

export const metadata: Metadata = { title: t.league.tabs.table };

type Tab = "tabell" | "aktivitet" | "om";
const TABS: { id: Tab; label: string }[] = [
  { id: "tabell", label: t.league.tabs.table },
  { id: "aktivitet", label: t.league.tabs.activity },
  { id: "om", label: t.league.tabs.about },
];

export default async function LeaguePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ fane?: string; ny?: string }>;
}) {
  const { id } = await params;
  const { fane, ny } = await searchParams;
  const tab: Tab = fane === "aktivitet" || fane === "om" ? fane : "tabell";
  const { user, league, isOwner } = await requireLeagueMember(id, `/ligaer/${id}`);
  const now = await serverNow();
  const db = getDb();
  const prices = await getPrices(now);
  // A league that ended since the last job run gets its final result now (idempotent).
  await finalizeLeagueIfDue(db, prices, { leagueId: id, now });
  const board = await loadLeaderboard(db, prices, id, now);
  if (!board) notFound();
  const status = deriveLeagueStatus(league, now);
  const pending = isOwner ? await loadPendingJoinRequests(db, id) : [];

  return (
    <div className="flex flex-col gap-6">
      <AutoRefresh enabled={status === "active"} />
      <BackLink href="/">{t.nav.myLeagues}</BackLink>
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="font-display text-3xl font-bold tracking-tight">{league.name}</h1>
          <div className="flex items-center gap-2">
            <LeagueStatusBadge status={status} />
            {isOwner && (
              <Button asChild variant="ghost" size="icon" aria-label={t.league.settings}>
                <Link href={`/ligaer/${id}/innstillinger` as Route}>
                  <Settings aria-hidden />
                </Link>
              </Button>
            )}
          </div>
        </div>
        <p className="text-muted-foreground">
          {leagueCountdown(status, league.startsAt, league.endsAt, now)}
        </p>
      </header>

      {pending.length > 0 && (
        <section
          className="border-warning/50 bg-warning/10 flex flex-col gap-3 rounded-xl border p-4"
          aria-live="polite"
        >
          <h2 className="font-semibold">{t.league.pendingTitle(pending.length)}</h2>
          <ul className="flex flex-col gap-2">
            {pending.map((request) => (
              <li
                key={request.requestId}
                className="flex flex-wrap items-center justify-between gap-2"
              >
                <span>
                  <span className="font-medium">{request.displayName}</span>{" "}
                  <span className="text-muted-foreground text-sm">
                    · {formatDateTime(request.requestedAt)}
                  </span>
                </span>
                <span className="flex gap-2">
                  <ActionButton
                    action={decideJoinRequestAction}
                    fields={{
                      requestId: request.requestId,
                      decision: "approve",
                      name: request.displayName,
                      leagueId: id,
                    }}
                    size="sm"
                  >
                    {t.league.approve}
                  </ActionButton>
                  <ActionButton
                    action={decideJoinRequestAction}
                    fields={{
                      requestId: request.requestId,
                      decision: "decline",
                      name: request.displayName,
                      leagueId: id,
                    }}
                    size="sm"
                    variant="outline"
                  >
                    {t.league.decline}
                  </ActionButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <nav className="bg-muted flex gap-1 rounded-full p-1" aria-label={league.name}>
        {TABS.map((item) => (
          <Link
            key={item.id}
            href={`/ligaer/${id}${item.id === "tabell" ? "" : `?fane=${item.id}`}` as Route}
            aria-current={tab === item.id ? "page" : undefined}
            className={cn(
              "flex-1 rounded-full px-3 py-1.5 text-center text-sm font-medium transition-colors",
              tab === item.id
                ? "bg-background shadow-sm"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
          </Link>
        ))}
      </nav>

      {tab === "tabell" && (
        <TableTab board={board} leagueId={id} userId={user.id} status={status} />
      )}
      {tab === "aktivitet" && <ActivityTab leagueId={id} userId={user.id} />}
      {tab === "om" && <AboutTab leagueId={id} highlightInvite={ny === "1"} />}

      {status !== "finished" && (
        <div className="grid grid-cols-2 gap-3">
          <Button asChild size="lg">
            <Link href={`/ligaer/${id}/handle` as Route}>
              <CandlestickChart aria-hidden /> {t.league.trade}
            </Link>
          </Button>
          <Button asChild size="lg" variant="outline">
            <Link href={`/ligaer/${id}/portefolje` as Route}>
              <Briefcase aria-hidden /> {t.league.myPortfolio}
            </Link>
          </Button>
        </div>
      )}
    </div>
  );
}

function TableTab({
  board,
  leagueId,
  userId,
  status,
}: {
  board: NonNullable<Awaited<ReturnType<typeof loadLeaderboard>>>;
  leagueId: string;
  userId: string;
  status: ReturnType<typeof deriveLeagueStatus>;
}) {
  const withChange = board.rows.filter((row) => row.dayChange !== null);
  const toMover = (row: (typeof board.rows)[number]): Mover => ({
    key: row.memberId,
    label: row.displayName,
    fraction: row.dayChange?.fraction ?? row.returnFraction,
    href: `/ligaer/${leagueId}/medlemmer/${row.memberId}` as Route,
  });
  const byDay = [...withChange].sort((a, b) =>
    (b.dayChange?.fraction ?? b.returnFraction).comparedTo(
      a.dayChange?.fraction ?? a.returnFraction,
    ),
  );
  const winners = byDay
    .filter((row) => row.dayChange?.fraction.greaterThan(0))
    .slice(0, 3)
    .map(toMover);
  const losers = [...byDay]
    .reverse()
    .filter((row) => row.dayChange?.fraction.lessThan(0))
    .slice(0, 3)
    .map(toMover);

  return (
    <div className="flex flex-col gap-6">
      {status === "finished" ? (
        <section className="flex flex-col gap-3">
          <h2 className="font-display text-xl font-semibold">{t.league.finalResult}</h2>
          <Podium rows={board.rows} />
        </section>
      ) : (
        status === "active" && <Movers winners={winners} losers={losers} />
      )}
      <LeaderboardTable
        rows={board.rows}
        leagueId={leagueId}
        viewerUserId={userId}
        showMovement={status === "active"}
      />
      <p className="text-muted-foreground text-xs">{t.league.tieRule}</p>
    </div>
  );
}

async function ActivityTab({ leagueId, userId }: { leagueId: string; userId: string }) {
  const now = await serverNow();
  const activity = await loadActivity(getDb(), { leagueId, viewerUserId: userId, now });
  if (!activity) notFound();
  return (
    <div className="flex flex-col gap-3">
      {activity.delayedUntil && (
        <p className="text-muted-foreground text-sm">
          {t.league.activity.delayed(formatDateTime(activity.delayedUntil))}
        </p>
      )}
      {activity.othersHidden && (
        <p className="text-muted-foreground text-sm">{t.league.activity.hidden}</p>
      )}
      {activity.items.length === 0 ? (
        <p className="text-muted-foreground">{t.league.activity.empty}</p>
      ) : (
        <ul className="flex flex-col gap-1">
          {activity.items.map((item) => (
            <li
              key={item.id}
              className="bg-card flex items-center justify-between gap-3 rounded-lg border px-3 py-2.5"
            >
              <span className="min-w-0">
                <span className="font-medium">{item.isOwn ? t.league.you : item.displayName}</span>{" "}
                {item.side === "buy" ? t.league.activity.bought : t.league.activity.sold}{" "}
                {formatQuantity(item.quantity)}{" "}
                <span className="font-medium">{item.instrument.name}</span>
                <span className="text-muted-foreground block text-xs">
                  {formatDateTime(item.at)} · {formatPrice(item.price)}
                </span>
              </span>
              <span
                className={cn(
                  "shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold",
                  item.side === "buy"
                    ? "bg-positive/15 text-positive"
                    : "bg-negative/15 text-negative",
                )}
              >
                {item.side === "buy" ? t.trade.buy : t.trade.sell}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

async function AboutTab({
  leagueId,
  highlightInvite,
}: {
  leagueId: string;
  highlightInvite: boolean;
}) {
  const db = getDb();
  const { league } = await requireLeagueMember(leagueId, `/ligaer/${leagueId}?fane=om`);
  const [members, exchanges] = await Promise.all([
    loadActiveMembers(db, leagueId),
    loadExchanges(db),
  ]);
  const names = exchanges
    .filter((exchange) => league.allowedExchangeIds.includes(exchange.id))
    .map((exchange) => exchange.name);
  const rules: [string, string][] = [
    [t.league.about.currency, league.currency],
    [t.league.about.startAmount, formatMoney(league.startAmount, { decimals: 0 })],
    [t.league.about.period, `${formatDate(league.startsAt)} – ${formatDate(league.endsAt)}`],
    [t.league.about.visibility, t.createLeague.visibilityOptions[league.visibility].label],
    [
      t.createLeague.fee,
      t.league.about.fee(
        formatPercent(league.feeRule.rate, { signed: false }),
        formatMoney(league.feeRule.minimum),
      ),
    ],
    [t.league.about.exchanges, names.join(", ")],
    [
      t.league.about.maxShare,
      league.maxPositionShare
        ? formatPercent(league.maxPositionShare, { signed: false, decimals: 0 })
        : t.league.about.noMaxShare,
    ],
  ];
  return (
    <div className="flex flex-col gap-6">
      {league.description && <p className="whitespace-pre-line">{league.description}</p>}
      <section
        className={cn(
          "bg-card flex flex-col gap-3 rounded-xl border p-4",
          highlightInvite && "border-primary ring-primary/30 ring-4",
        )}
      >
        <h2 className="font-semibold">{t.league.about.inviteTitle}</h2>
        <p className="text-muted-foreground text-sm">{t.league.about.inviteText}</p>
        <ShareInvite code={league.inviteCode} leagueName={league.name} />
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">{t.league.about.rules}</h2>
        <dl className="bg-card divide-y rounded-xl border">
          {rules.map(([label, value]) => (
            <div key={label} className="flex justify-between gap-4 px-4 py-2.5 text-sm">
              <dt className="text-muted-foreground">{label}</dt>
              <dd className="text-right font-medium">{value}</dd>
            </div>
          ))}
        </dl>
      </section>
      <section className="flex flex-col gap-2">
        <h2 className="font-semibold">
          {t.league.about.members} ({members.length})
        </h2>
        <ul className="bg-card divide-y rounded-xl border">
          {members.map((member) => (
            <li key={member.memberId} className="flex justify-between px-4 py-2.5 text-sm">
              <span>{member.displayName}</span>
              {member.userId === league.ownerId && (
                <span className="text-muted-foreground">{t.league.about.owner}</span>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
