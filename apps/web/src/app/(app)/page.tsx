import { loadMyLeagues } from "@aksjeliga/db";
import { Hourglass, Plus, Ticket } from "lucide-react";
import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";

import { AutoRefresh } from "@/components/auto-refresh";
import { LeagueCard } from "@/components/league-card";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { formatDate } from "@/lib/format";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { getPrices } from "@/server/prices";
import { requireProfile } from "@/server/session";

export const metadata: Metadata = { title: t.leagues.title };

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-muted-foreground text-sm font-semibold tracking-wide uppercase">
        {title}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">{children}</div>
    </section>
  );
}

function Actions() {
  return (
    <div className="flex gap-2">
      <Button asChild>
        <Link href={"/ligaer/ny"}>
          <Plus aria-hidden /> {t.leagues.create}
        </Link>
      </Button>
      <Button asChild variant="outline">
        <Link href={"/bli-med"}>
          <Ticket aria-hidden /> {t.leagues.join}
        </Link>
      </Button>
    </div>
  );
}

export default async function MyLeaguesPage() {
  const { user } = await requireProfile("/");
  const now = await serverNow();
  const mine = await loadMyLeagues(getDb(), await getPrices(now), { userId: user.id, now });
  const isEmpty =
    mine.active.length +
      mine.upcoming.length +
      mine.awaitingApproval.length +
      mine.finished.length ===
    0;

  return (
    <div className="flex flex-col gap-8">
      <AutoRefresh />
      <div className="flex flex-wrap items-center justify-between gap-4">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t.leagues.title}</h1>
        {!isEmpty && <Actions />}
      </div>

      {isEmpty && (
        <div className="bg-card flex flex-col items-center gap-4 rounded-xl border p-8 text-center">
          <h2 className="font-display text-xl font-semibold">{t.leagues.emptyTitle}</h2>
          <p className="text-muted-foreground max-w-md">{t.leagues.emptyText}</p>
          <p className="text-muted-foreground text-sm">{t.app.fakeMoneyExplainer}</p>
          <Actions />
        </div>
      )}

      {mine.active.length > 0 && (
        <Section title={t.leagues.sections.active}>
          {mine.active.map((card) => (
            <LeagueCard key={card.league.id} card={card} now={now} />
          ))}
        </Section>
      )}
      {mine.upcoming.length > 0 && (
        <Section title={t.leagues.sections.upcoming}>
          {mine.upcoming.map((card) => (
            <LeagueCard key={card.league.id} card={card} now={now} />
          ))}
        </Section>
      )}
      {mine.awaitingApproval.length > 0 && (
        <Section title={t.leagues.sections.awaitingApproval}>
          {mine.awaitingApproval.map(({ league, requestedAt }) => (
            <div
              key={league.id}
              className="bg-card flex flex-col gap-2 rounded-xl border border-dashed p-4"
            >
              <h3 className="font-display text-lg font-semibold">{league.name}</h3>
              <p className="text-muted-foreground flex items-center gap-2 text-sm">
                <Hourglass aria-hidden className="size-4" />
                {t.leagues.waitingForOwner} · {formatDate(requestedAt)}
              </p>
            </div>
          ))}
        </Section>
      )}
      {mine.finished.length > 0 && (
        <Section title={t.leagues.sections.finished}>
          {mine.finished.map((card) => (
            <LeagueCard key={card.league.id} card={card} now={now} />
          ))}
        </Section>
      )}
    </div>
  );
}
