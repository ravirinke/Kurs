import "server-only";

import { loadProfile, type Profile } from "@aksjeliga/db";
import type { Route } from "next";
import { redirect } from "next/navigation";

import { getDb } from "./db";
import { supabaseServer } from "./supabase";

export interface SessionUser {
  id: string;
  email: string;
}

/** The signed-in user, verified with Supabase Auth (not just read from the cookie). */
export async function currentUser(): Promise<SessionUser | null> {
  const supabase = await supabaseServer();
  const { data } = await supabase.auth.getUser();
  if (!data.user) return null;
  return { id: data.user.id, email: data.user.email ?? "" };
}

/** Only allow redirects to paths inside the app. */
export function safeNext(next: string | null | undefined): string {
  return next?.startsWith("/") && !next.startsWith("//") ? next : "/";
}

export async function requireUser(next = "/"): Promise<SessionUser> {
  const user = await currentUser();
  if (!user) redirect(`/logg-inn?neste=${encodeURIComponent(next)}` as Route);
  return user;
}

/** A signed-in user who has chosen a display name (first sign-in asks for it). */
export async function requireProfile(next = "/"): Promise<{ user: SessionUser; profile: Profile }> {
  const user = await requireUser(next);
  const profile = await loadProfile(getDb(), user.id);
  if (!profile?.nameConfirmed) redirect(`/velkommen?neste=${encodeURIComponent(next)}` as Route);
  return { user, profile };
}
