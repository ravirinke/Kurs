import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

import { serverEnv } from "./env";

/** Supabase client for server components, server actions and route handlers. */
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(serverEnv.supabaseUrl, serverEnv.supabasePublishableKey, {
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet)
            cookieStore.set(name, value, options);
        } catch {
          // Called from a server component, where cookies are read-only. proxy.ts refreshes
          // the session cookies on every request, so this is safe to ignore.
        }
      },
    },
  });
}
