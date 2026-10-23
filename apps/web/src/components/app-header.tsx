import { Clock, UserRound } from "lucide-react";
import Link from "next/link";

import { t } from "@/i18n";

import { FakeMoneyBadge } from "./fake-money-badge";

export function AppHeader({
  displayName,
  timeTravel,
}: {
  displayName: string | null;
  timeTravel: string | null;
}) {
  return (
    <header className="bg-background/90 sticky top-0 z-40 border-b backdrop-blur">
      {timeTravel && (
        <Link
          href="/profil"
          className="bg-warning text-background flex items-center justify-center gap-2 px-4 py-1 text-xs font-semibold"
        >
          <Clock aria-hidden className="size-3.5" />
          {t.profile.timeTravel.active}: {timeTravel}
        </Link>
      )}
      <div className="mx-auto flex h-14 max-w-5xl items-center justify-between gap-3 px-4">
        <Link href="/" className="font-display text-xl font-bold tracking-tight">
          {t.app.name}
        </Link>
        <div className="flex items-center gap-2">
          <FakeMoneyBadge className="hidden sm:inline-flex" />
          {displayName && (
            <Link
              href="/profil"
              className="hover:bg-muted flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium"
              aria-label={t.nav.profile}
            >
              <UserRound aria-hidden className="size-4" />
              <span className="max-w-32 truncate">{displayName}</span>
            </Link>
          )}
        </div>
      </div>
      <div className="mx-auto max-w-5xl px-4 pb-2 sm:hidden">
        <FakeMoneyBadge />
      </div>
    </header>
  );
}
