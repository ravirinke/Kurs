import { APP_TIME_ZONE, deriveLeagueStatus } from "@aksjeliga/core";
import { loadActiveMembers } from "@aksjeliga/db";
import type { Metadata, Route } from "next";
import { notFound } from "next/navigation";

import {
  cancelLeagueAction,
  regenerateInviteCodeAction,
  removeMemberAction,
} from "@/app/actions/leagues";
import { ActionButton } from "@/components/action-button";
import { BackLink } from "@/components/back-link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireLeagueMember } from "@/server/league-access";

import { LeagueDetailsForm } from "./league-details-form";

export const metadata: Metadata = { title: t.settings.title };

export default async function LeagueSettingsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { league, isOwner, user } = await requireLeagueMember(id, `/ligaer/${id}/innstillinger`);
  if (!isOwner) notFound();
  const now = await serverNow();
  const status = deriveLeagueStatus(league, now);
  const members = await loadActiveMembers(getDb(), id);
  const open = status === "upcoming" || status === "active";

  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <BackLink href={`/ligaer/${id}` as Route}>{league.name}</BackLink>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t.settings.title}</h1>

      <Card>
        <CardContent>
          <LeagueDetailsForm
            leagueId={id}
            name={league.name}
            description={league.description}
            endDate={league.endsAt.setZone(APP_TIME_ZONE).toFormat("yyyy-MM-dd")}
            disabled={!open}
          />
          <p className="text-muted-foreground mt-4 text-xs">{t.settings.lockedNote}</p>
        </CardContent>
      </Card>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>{t.settings.inviteTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex items-center justify-between gap-3">
            <span className="font-mono text-2xl font-bold tracking-[0.2em]">
              {league.inviteCode}
            </span>
            <ActionButton
              action={regenerateInviteCodeAction}
              fields={{ leagueId: id }}
              confirm={t.settings.regenerateConfirm}
              variant="outline"
            >
              {t.settings.regenerate}
            </ActionButton>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle>{t.settings.membersTitle}</CardTitle>
        </CardHeader>
        <CardContent>
          <ul className="divide-y">
            {members.map((member) => (
              <li key={member.memberId} className="flex items-center justify-between gap-3 py-2.5">
                <span>{member.displayName}</span>
                {member.userId === user.id ? (
                  <span className="text-muted-foreground text-sm">{t.league.about.owner}</span>
                ) : (
                  open && (
                    <ActionButton
                      action={removeMemberAction}
                      fields={{ leagueId: id, userId: member.userId, name: member.displayName }}
                      confirm={t.settings.removeConfirm(member.displayName)}
                      variant="ghost"
                      size="sm"
                      className="text-negative"
                    >
                      {t.settings.remove}
                    </ActionButton>
                  )
                )}
              </li>
            ))}
          </ul>
        </CardContent>
      </Card>

      {status === "upcoming" && (
        <Card className="border-negative/40">
          <CardHeader>
            <CardTitle>{t.settings.cancelTitle}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            <p className="text-muted-foreground text-sm">{t.settings.cancelText}</p>
            <ActionButton
              action={cancelLeagueAction}
              fields={{ leagueId: id }}
              confirm={t.settings.cancelConfirm}
              variant="destructive"
            >
              {t.settings.cancel}
            </ActionButton>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
