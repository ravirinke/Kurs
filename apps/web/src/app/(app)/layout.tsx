import { loadProfile } from "@aksjeliga/db";
import type { ReactNode } from "react";

import { AppHeader } from "@/components/app-header";
import { formatLongDateTime } from "@/lib/format";
import { isTimeTravelling, serverNow } from "@/server/clock";
import { getDb } from "@/server/db";
import { currentUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await currentUser();
  const profile = user ? await loadProfile(getDb(), user.id) : null;
  const timeTravel = (await isTimeTravelling()) ? formatLongDateTime(await serverNow()) : null;
  return (
    <>
      <AppHeader
        displayName={profile?.nameConfirmed ? profile.displayName : null}
        timeTravel={timeTravel}
      />
      <main className="mx-auto w-full max-w-5xl px-4 pt-6 pb-16">{children}</main>
    </>
  );
}
