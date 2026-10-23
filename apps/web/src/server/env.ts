import "server-only";

function required(name: string, value: string | undefined): string {
  if (!value) throw new Error(`${name} is not set. Copy .env.example to .env in the repo root.`);
  return value;
}

export const serverEnv = {
  get databaseUrl() {
    return required("DATABASE_URL", process.env.DATABASE_URL);
  },
  get supabaseUrl() {
    return required("NEXT_PUBLIC_SUPABASE_URL", process.env.NEXT_PUBLIC_SUPABASE_URL);
  },
  get supabasePublishableKey() {
    return required(
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    );
  },
  /** Dev-only "time machine" (see clock.ts). Never active in production builds. */
  get timeTravelEnabled() {
    return process.env.NODE_ENV !== "production" && process.env.ALLOW_TIME_TRAVEL === "1";
  },
};
