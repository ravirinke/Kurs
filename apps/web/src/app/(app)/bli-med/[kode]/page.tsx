import { loadInvitePreview } from "@aksjeliga/db";
import { Hourglass } from "lucide-react";
import type { Metadata, Route } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";

import { FormError } from "@/components/form-error";
import { JoinForm } from "@/components/join-form";
import { LeagueStatusBadge, leagueCountdown } from "@/components/status-badges";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { formatMoney } from "@/lib/format";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireProfile } from "@/server/session";

export const metadata: Metadata = { title: t.join.title };

export default async function InvitePage({
  params,
  searchParams,
}: {
  params: Promise<{ kode: string }>;
  searchParams: Promise<{ sendt?: string }>;
}) {
  const { kode } = await params;
  const code = decodeURIComponent(kode);
  const { user } = await requireProfile(`/bli-med/${kode}`);
  const now = await serverNow();
  const preview = await loadInvitePreview(getDb(), { inviteCode: code, userId: user.id, now });
  if (!preview) notFound();
  if (preview.viewer === "member") redirect(`/ligaer/${preview.league.id}` as Route);
  const { league, status } = preview;
  const justRequested = (await searchParams).sendt === "1";

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <Card>
        <CardHeader className="flex flex-col gap-2">
          <LeagueStatusBadge status={status} />
          <CardTitle as="h1" className="font-display text-2xl">
            {t.join.previewTitle(league.name)}
          </CardTitle>
          <p className="text-muted-foreground text-sm">
            {t.join.ownedBy(preview.ownerName)} · {t.leagues.members(preview.memberCount)} ·{" "}
            {leagueCountdown(status, league.startsAt, league.endsAt, now)}
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {league.description && <p>{league.description}</p>}
          <p className="text-sm">
            {t.league.about.startAmount}:{" "}
            <strong>{formatMoney(league.startAmount, { decimals: 0 })}</strong>
          </p>

          {preview.viewer === "removed" && <FormError message={t.errors.REMOVED_FROM_LEAGUE} />}
          {status === "finished" && <FormError message={t.errors.LEAGUE_FINISHED} />}
          {status === "cancelled" && <FormError message={t.errors.LEAGUE_CANCELLED} />}

          {preview.viewer === "pending" && (
            <p className="bg-muted flex items-center gap-2 rounded-lg p-3 text-sm">
              <Hourglass aria-hidden className="size-4 shrink-0" />
              {justRequested ? t.join.requested : t.errors.ALREADY_REQUESTED}
            </p>
          )}

          {preview.viewer === "none" && (status === "upcoming" || status === "active") && (
            <>
              <p className="text-muted-foreground text-sm">
                {status === "upcoming" ? t.join.directInfo : t.join.approvalInfo}
              </p>
              <JoinForm
                code={code}
                submitLabel={status === "upcoming" ? t.join.submit : t.join.requestSubmit}
              />
            </>
          )}

          <Button asChild variant="ghost">
            <Link href="/">{t.nav.myLeagues}</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
