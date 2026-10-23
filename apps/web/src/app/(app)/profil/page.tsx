import type { Metadata } from "next";

import { clearTimeTravel, setTimeTravel } from "@/app/actions/profile";
import { signOut } from "@/app/actions/auth";
import { DisplayNameForm } from "@/components/display-name-form";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { formatLongDateTime } from "@/lib/format";
import { isTimeTravelling, serverNow } from "@/server/clock";
import { serverEnv } from "@/server/env";
import { requireProfile } from "@/server/session";

export const metadata: Metadata = { title: t.profile.title };

export default async function ProfilePage() {
  const { user, profile } = await requireProfile("/profil");
  const now = await serverNow();
  const travelling = await isTimeTravelling();

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
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

      <form action={signOut}>
        <Button type="submit" variant="outline" className="w-full">
          {t.auth.signOut}
        </Button>
      </form>
    </div>
  );
}
