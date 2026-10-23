"use server";

import { headers } from "next/headers";
import { redirect } from "next/navigation";

import { t } from "@/i18n";
import { field } from "@/lib/parse";
import { safeNext } from "@/server/session";
import { supabaseServer } from "@/server/supabase";

export type SignInState =
  { status: "idle" } | { status: "sent"; email: string } | { status: "error"; message: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

async function origin(): Promise<string> {
  const list = await headers();
  const host = list.get("x-forwarded-host") ?? list.get("host") ?? "localhost:3000";
  const protocol =
    list.get("x-forwarded-proto") ??
    (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${protocol}://${host}`;
}

/** Sends a magic link. The link comes back to /auth/callback, then to `neste`. */
export async function sendMagicLink(_previous: SignInState, form: FormData): Promise<SignInState> {
  const email = field(form, "email").trim().toLowerCase();
  if (!EMAIL.test(email)) return { status: "error", message: t.auth.invalidEmail };
  const next = safeNext(field(form, "neste"));

  const supabase = await supabaseServer();
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: `${await origin()}/auth/callback?neste=${encodeURIComponent(next)}`,
      shouldCreateUser: true,
    },
  });
  if (error) return { status: "error", message: t.auth.sendFailed };
  return { status: "sent", email };
}

export async function signOut(): Promise<void> {
  const supabase = await supabaseServer();
  await supabase.auth.signOut();
  redirect("/logg-inn");
}
