import type { Metadata } from "next";

import { FakeMoneyBadge } from "@/components/fake-money-badge";
import { t } from "@/i18n";

import { SignInForm } from "./sign-in-form";

export const metadata: Metadata = { title: t.auth.title };

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ neste?: string; feil?: string }>;
}) {
  const { neste, feil } = await searchParams;
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-8 px-4 py-12">
      <div className="flex flex-col gap-3">
        <FakeMoneyBadge />
        <h1 className="font-display text-4xl font-bold tracking-tight">{t.app.name}</h1>
        <p className="text-muted-foreground">{t.app.tagline}</p>
      </div>
      <SignInForm next={neste ?? "/"} linkFailed={feil === "lenke"} />
    </main>
  );
}
