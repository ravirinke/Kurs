import Link from "next/link";

import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center gap-4 px-4 text-center">
      <p className="font-display text-gold text-6xl font-bold">404</p>
      <h1 className="font-display text-2xl font-semibold">{t.notFound.title}</h1>
      <p className="text-muted-foreground">{t.notFound.text}</p>
      <Button asChild>
        <Link href="/">{t.nav.myLeagues}</Link>
      </Button>
    </main>
  );
}
