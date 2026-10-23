/*
 * Seeds the local database: `pnpm db:seed` (or `pnpm db:reset` for a clean start).
 * Uses the real wall clock: this is a script, not business logic.
 */
import { fixedClock } from "@aksjeliga/core";
import { DateTime } from "luxon";

import { createDatabase } from "../client";
import { loadRootEnv, requireEnv } from "../env";
import { createMockPriceProvider } from "../mock-prices";

import { seedReferenceData } from "./reference-data";
import { seedTestLeague, TEST_LEAGUE_INVITE_CODE } from "./test-league";
import { seedUsers, TEST_USERS } from "./users";

async function main(): Promise<void> {
  loadRootEnv();
  const { db, close } = createDatabase(requireEnv("DATABASE_URL"));
  try {
    await seedReferenceData(db);
    console.log("✓ Exchanges, trading hours, holidays and instruments");

    const ids = await seedUsers(
      requireEnv("NEXT_PUBLIC_SUPABASE_URL"),
      requireEnv("SUPABASE_SECRET_KEY"),
      Object.values(TEST_USERS),
    );
    const idOf = (email: string) => {
      const id = ids.get(email);
      if (!id) throw new Error(`User ${email} was not created`);
      return id;
    };
    console.log(
      `✓ Test users: ${Object.values(TEST_USERS)
        .map((user) => user.email)
        .join(", ")}`,
    );

    const now = DateTime.utc();
    const provider = await createMockPriceProvider(db, { clock: fixedClock(now) });
    const result = await seedTestLeague(
      db,
      provider,
      { ola: idOf(TEST_USERS.ola.email), kari: idOf(TEST_USERS.kari.email) },
      now,
    );
    console.log(
      result === "created"
        ? `✓ Testligaen (invite code ${TEST_LEAGUE_INVITE_CODE}) with trades for Ola and Kari`
        : "• Testligaen already exists, left unchanged",
    );
  } finally {
    await close();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
