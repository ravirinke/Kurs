import { createClient } from "@supabase/supabase-js";

export interface SeedUser {
  email: string;
  displayName: string;
}

/** Local test users. Log in with a magic link; the email lands in Mailpit. */
export const TEST_USERS = {
  ola: { email: "ola@test.no", displayName: "Ola" },
  kari: { email: "kari@test.no", displayName: "Kari" },
  per: { email: "per@test.no", displayName: "Per" },
} as const satisfies Record<string, SeedUser>;

/**
 * Creates users through the Supabase Auth admin API, so they are real auth users that can
 * sign in. Returns their ids; existing users are reused.
 */
export async function seedUsers(
  supabaseUrl: string,
  secretKey: string,
  users: readonly SeedUser[],
): Promise<Map<string, string>> {
  const admin = createClient(supabaseUrl, secretKey, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
  const ids = new Map<string, string>();

  const { data: existing, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (listError) throw listError;

  for (const user of users) {
    const found = existing.users.find((candidate) => candidate.email === user.email);
    if (found) {
      ids.set(user.email, found.id);
      continue;
    }
    const { data, error } = await admin.auth.admin.createUser({
      email: user.email,
      email_confirm: true,
      user_metadata: { display_name: user.displayName },
    });
    if (error) throw error;
    ids.set(user.email, data.user.id);
  }
  return ids;
}
