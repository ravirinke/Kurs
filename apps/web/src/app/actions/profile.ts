"use server";

import { updateDisplayName } from "@aksjeliga/db";
import { DateTime } from "luxon";
import type { Route } from "next";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";

import { errorMessage } from "@/lib/errors";
import { field } from "@/lib/parse";
import { encodeTimeTravel, TIME_TRAVEL_COOKIE } from "@/server/clock";
import { getDb } from "@/server/db";
import { serverEnv } from "@/server/env";
import { requireUser, safeNext } from "@/server/session";

export type FormState =
  { status: "idle" } | { status: "saved" } | { status: "error"; message: string };

/** First sign-in and the profile page: choose the name shown in leagues. */
export async function saveDisplayName(_previous: FormState, form: FormData): Promise<FormState> {
  const user = await requireUser();
  const result = await updateDisplayName(getDb(), {
    userId: user.id,
    displayName: field(form, "displayName"),
  });
  if (!result.ok) return { status: "error", message: errorMessage(result.error) };
  revalidatePath("/", "layout");
  const next = field(form, "neste");
  if (next) redirect(safeNext(next) as Route);
  return { status: "saved" };
}

/** Dev only: move the app's clock to a chosen moment (Norwegian time). */
export async function setTimeTravel(form: FormData): Promise<void> {
  await requireUser();
  if (!serverEnv.timeTravelEnabled) return;
  const chosen = DateTime.fromISO(field(form, "at"), { zone: "Europe/Oslo" });
  if (!chosen.isValid) return;
  (await cookies()).set(TIME_TRAVEL_COOKIE, encodeTimeTravel(chosen), {
    path: "/",
    sameSite: "lax",
    httpOnly: true,
  });
  revalidatePath("/", "layout");
}

export async function clearTimeTravel(): Promise<void> {
  await requireUser();
  (await cookies()).delete(TIME_TRAVEL_COOKIE);
  revalidatePath("/", "layout");
}
