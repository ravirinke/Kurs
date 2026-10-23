import { loadProfile } from "@aksjeliga/db";
import type { Metadata, Route } from "next";
import { redirect } from "next/navigation";

import { DisplayNameForm } from "@/components/display-name-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { getDb } from "@/server/db";
import { requireUser, safeNext } from "@/server/session";

export const metadata: Metadata = { title: t.welcome.title };

export default async function WelcomePage({
  searchParams,
}: {
  searchParams: Promise<{ neste?: string }>;
}) {
  const next = safeNext((await searchParams).neste);
  const user = await requireUser(`/velkommen?neste=${encodeURIComponent(next)}`);
  const profile = await loadProfile(getDb(), user.id);
  if (profile?.nameConfirmed) redirect(next as Route);

  return (
    <div className="mx-auto flex max-w-md flex-col gap-6 pt-6">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="font-display text-2xl">
            {t.welcome.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground">{t.welcome.intro}</p>
          <DisplayNameForm defaultName="" next={next} submitLabel={t.welcome.save} />
        </CardContent>
      </Card>
    </div>
  );
}
