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

/** Someone's portfolio, as far as the league's visibility allows (decided in core). */
export default async function MemberPortfolioPage({
  params,
}: {
  params: Promise<{ id: string; memberId: string }>;
}) {
  const { id, memberId } = await params;
  const { user } = await requireLeagueMember(id, `/ligaer/${id}/medlemmer/${memberId}`);
  const now = await serverNow();
  const view = await loadPortfolio(getDb(), await getPrices(now), {
    leagueId: id,
    memberId,
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
