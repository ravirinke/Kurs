import { APP_TIME_ZONE, DEFAULT_MINIMUM_FEE, DEFAULT_START_AMOUNT } from "@aksjeliga/core";
import { loadExchanges } from "@aksjeliga/db";
import type { Metadata } from "next";

import { BackLink } from "@/components/back-link";
import { t } from "@/i18n";
import { serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { requireProfile } from "@/server/session";

import { CreateLeagueForm } from "./create-league-form";

export const metadata: Metadata = { title: t.createLeague.title };

export default async function CreateLeaguePage() {
  await requireProfile("/ligaer/ny");
  const now = await serverNow();
  const exchanges = await loadExchanges(getDb());
  return (
    <div className="mx-auto flex max-w-xl flex-col gap-6">
      <BackLink href="/">{t.nav.myLeagues}</BackLink>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t.createLeague.title}</h1>
      <CreateLeagueForm
        nowIso={now.toISO() ?? ""}
        exchanges={exchanges}
        defaultStartAmounts={DEFAULT_START_AMOUNT}
        defaultFeeMinimums={DEFAULT_MINIMUM_FEE}
        defaultEndDate={now.setZone(APP_TIME_ZONE).plus({ weeks: 4 }).toFormat("yyyy-MM-dd")}
      />
    </div>
  );
}
