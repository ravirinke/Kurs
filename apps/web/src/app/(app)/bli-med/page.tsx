import type { Metadata } from "next";

import { JoinForm } from "@/components/join-form";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { t } from "@/i18n";
import { requireProfile } from "@/server/session";

export const metadata: Metadata = { title: t.join.title };

export default async function JoinPage() {
  await requireProfile("/bli-med");
  return (
    <div className="mx-auto flex max-w-md flex-col gap-6">
      <Card>
        <CardHeader>
          <CardTitle as="h1" className="font-display text-2xl">
            {t.join.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p className="text-muted-foreground">{t.join.intro}</p>
          <JoinForm submitLabel={t.join.submit} />
        </CardContent>
      </Card>
    </div>
  );
}
