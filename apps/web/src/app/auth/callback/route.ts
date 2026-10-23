import { type NextRequest, NextResponse } from "next/server";

import { safeNext } from "@/server/session";
import { supabaseServer } from "@/server/supabase";

/** The magic link lands here: exchange the one-time code for a session, then continue. */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const code = searchParams.get("code");
  const next = safeNext(searchParams.get("neste"));

  if (code) {
    const supabase = await supabaseServer();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) return NextResponse.redirect(new URL(next, request.url));
  }
  return NextResponse.redirect(
    new URL(`/logg-inn?feil=lenke&neste=${encodeURIComponent(next)}`, request.url),
  );
}
