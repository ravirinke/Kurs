import { Coins } from "lucide-react";

import { t } from "@/i18n";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-xl flex-col justify-center gap-6 px-4 py-12">
      <span
        className="bg-muted text-muted-foreground inline-flex w-fit items-center gap-1.5 rounded-full px-3 py-1 text-sm font-medium"
        title={t.app.fakeMoneyExplainer}
      >
        <Coins aria-hidden className="size-4" />
        {t.app.fakeMoney}
      </span>
      <h1 className="font-display text-5xl font-bold tracking-tight">{t.app.name}</h1>
      <p className="text-muted-foreground text-lg">{t.app.tagline}</p>
      <p className="bg-card rounded-lg border p-4">{t.home.comingSoon}</p>
    </main>
  );
}
