import { eq } from "drizzle-orm";

import type { Database, Executor } from "../client";
import { profiles } from "../schema";

export const MAX_DISPLAY_NAME_LENGTH = 30;

export type DisplayNameError = { code: "NAME_REQUIRED" } | { code: "NAME_TOO_LONG"; max: number };

export interface Profile {
  id: string;
  displayName: string;
  nameConfirmed: boolean;
}

export async function loadProfile(db: Executor, userId: string): Promise<Profile | null> {
  const [row] = await db
    .select({
      id: profiles.id,
      displayName: profiles.displayName,
      nameConfirmed: profiles.nameConfirmed,
    })
    .from(profiles)
    .where(eq(profiles.id, userId));
  return row ?? null;
}

export function validateDisplayName(name: string): DisplayNameError | null {
  const trimmed = name.trim();
  if (trimmed.length === 0) return { code: "NAME_REQUIRED" };
  if (trimmed.length > MAX_DISPLAY_NAME_LENGTH)
    return { code: "NAME_TOO_LONG", max: MAX_DISPLAY_NAME_LENGTH };
  return null;
}

/** Sets the name shown in leagues, and marks it as chosen (ends first-sign-in onboarding). */
export async function updateDisplayName(
  db: Database,
  input: { userId: string; displayName: string },
): Promise<{ ok: true } | { ok: false; error: DisplayNameError }> {
  const error = validateDisplayName(input.displayName);
  if (error) return { ok: false, error };
  await db
    .update(profiles)
    .set({ displayName: input.displayName.trim().replace(/\s+/g, " "), nameConfirmed: true })
    .where(eq(profiles.id, input.userId));
  return { ok: true };
}
