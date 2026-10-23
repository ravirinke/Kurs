import { loadPortfolio } from "@aksjeliga/db";
import type { Metadata } from "next";
import { notFound } from "next/navigation";

import { AutoRefresh } from "@/components/auto-refresh";
import { PortfolioView } from "@/components/portfolio-view";
import { t } from "@/i18n";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireLeagueMember } from "@/server/league-access";
import { getPrices } from "@/server/prices";

export const metadata: Metadata = { title: t.portfolio.title };

export default async function MyPortfolioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, member } = await requireLeagueMember(id, `/ligaer/${id}/portefolje`);
  const now = await serverNow();
  const view = await loadPortfolio(getDb(), await getPrices(now), {
    leagueId: id,
    memberId: member.id,
    viewerUserId: user.id,
    now,
  });
  if (!view) notFound();
  return (
    <>
      <AutoRefresh />
      <PortfolioView view={view} leagueId={id} />
    </>
  );
}
