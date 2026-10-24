import { APP_TIME_ZONE, localDate } from "@aksjeliga/core";
import { loadInstruments, loadSimulatedCorporateActions } from "@aksjeliga/db";
import { DateTime } from "luxon";
import type { Metadata } from "next";

import { clearTimeTravel, setTimeTravel } from "@/app/actions/profile";
import { signOut } from "@/app/actions/auth";
import { BackLink } from "@/components/back-link";
import { DisplayNameForm } from "@/components/display-name-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { formatDate, formatLongDateTime, formatNumber, formatPrice } from "@/lib/format";
import { isTimeTravelling, serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { requireProfile } from "@/server/session";

import { RunJobsForm, SimulateDividendForm, SimulateSplitForm } from "./dev-tools";

const dateOf = (date: string) => formatDate(DateTime.fromISO(date, { zone: APP_TIME_ZONE }));

export const metadata: Metadata = { title: t.profile.title };

export default async function ProfilePage() {
  const { user, profile } = await requireProfile("/profil");
  const now = await serverNow();
  const travelling = await isTimeTravelling();
  const dev = serverEnv.timeTravelEnabled
    ? await (async () => {
        const db = getDb();
        const [instruments, simulated] = await Promise.all([
          loadInstruments(db),
          loadSimulatedCorporateActions(db),
        ]);
        const choices = instruments.map((instrument) => ({
          id: instrument.id,
          label: `${instrument.name} (${instrument.ticker})`,
        }));
        return { instruments, choices, simulated };
      })()
    : null;
  const nameOf = new Map(dev?.instruments.map((instrument) => [instrument.id, instrument.name]));
  const today = localDate(now, APP_TIME_ZONE);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <BackLink href="/">{t.nav.myLeagues}</BackLink>
      <h1 className="font-display text-3xl font-bold tracking-tight">{t.profile.title}</h1>
      <Card>
        <CardHeader>
          <CardTitle>{t.profile.name}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t.profile.signedInAs(user.email)}</p>
          <DisplayNameForm defaultName={profile.displayName} submitLabel={t.profile.save} />
        </CardContent>
      </Card>

      {serverEnv.timeTravelEnabled && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle>{t.profile.timeTravel.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">{t.profile.timeTravel.intro}</p>
            <p className="text-sm font-medium">
              {t.profile.timeTravel.current(formatLongDateTime(now))}
            </p>
            <form action={setTimeTravel} className="flex flex-wrap gap-2">
              <Input
                type="datetime-local"
                name="at"
                aria-label={t.profile.timeTravel.title}
                defaultValue={now.setZone("Europe/Oslo").toFormat("yyyy-MM-dd'T'HH:mm")}
                className="w-auto"
                required
              />
              <Button type="submit" variant="secondary">
                {t.profile.timeTravel.set}
              </Button>
            </form>
            {travelling && (
              <form action={clearTimeTravel}>
                <Button type="submit" variant="outline">
                  {t.profile.timeTravel.reset}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      )}

      {dev && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle>{t.profile.simulate.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-6">
            <p className="text-muted-foreground text-sm">{t.profile.simulate.intro}</p>
            <SimulateSplitForm instruments={dev.choices} today={today} />
            <SimulateDividendForm instruments={dev.choices} today={today} />
            <section className="flex flex-col gap-2">
              <h3 className="font-semibold">{t.profile.simulate.listTitle}</h3>
              {dev.simulated.length === 0 ? (
                <p className="text-muted-foreground text-sm">{t.profile.simulate.none}</p>
              ) : (
                <ul className="flex flex-col gap-1 text-sm">
                  {dev.simulated.map((action) => {
                    const name = nameOf.get(action.instrumentId) ?? "";
                    return (
                      <li key={action.id}>
                        {action.kind === "split"
                          ? t.profile.simulate.splitLine(
                              name,
                              formatNumber(action.ratioFrom, action.ratioFrom.decimalPlaces()),
                              formatNumber(action.ratioTo, action.ratioTo.decimalPlaces()),
                              dateOf(action.effectiveDate),
                            )
                          : t.profile.simulate.dividendLine(
                              name,
                              formatPrice(action.amountPerShare),
                              dateOf(action.exDate),
                              dateOf(action.payDate),
                            )}
                      </li>
                    );
                  })}
                </ul>
              )}
            </section>
          </CardContent>
        </Card>
      )}

      {dev && (
        <Card className="border-warning/50">
          <CardHeader>
            <CardTitle>{t.profile.jobs.title}</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="text-muted-foreground text-sm">{t.profile.jobs.intro}</p>
            <RunJobsForm />
          </CardContent>
        </Card>
      )}

      <form action={signOut}>
        <Button type="submit" variant="outline" className="w-full">
          {t.auth.signOut}
        </Button>
      </form>
    </div>
  );
}
