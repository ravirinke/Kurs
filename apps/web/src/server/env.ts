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
  /** Shared secret the cron caller sends as `Authorization: Bearer …`. */
  get cronSecret() {
    return required("CRON_SECRET", process.env.CRON_SECRET);
  },
  /** "live" for real prices; anything else is the mock (see prices.ts). */
  get priceProvider(): "mock" | "live" {
    return process.env.PRICE_PROVIDER === "live" ? "live" : "mock";
  },
  /** Finnhub key for real-time US quotes. Without it, live prices all come from Yahoo. */
  get finnhubApiKey(): string | undefined {
    const key = process.env.FINNHUB_API_KEY;
    return key === undefined || key === "" ? undefined : key;
  },
  /** Dev-only "time machine" (see clock.ts). Never active in production builds. */
  get timeTravelEnabled() {
    return process.env.NODE_ENV !== "production" && process.env.ALLOW_TIME_TRAVEL === "1";
  },
};
