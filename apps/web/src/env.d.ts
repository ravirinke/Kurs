// Environment variables the web app reads (see .env.example). Declared so they can be read
// with dot access: Next.js only inlines NEXT_PUBLIC_* values written as process.env.NAME.
declare namespace NodeJS {
  interface ProcessEnv {
    NEXT_PUBLIC_SUPABASE_URL?: string;
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY?: string;
    DATABASE_URL?: string;
    SUPABASE_SECRET_KEY?: string;
    CRON_SECRET?: string;
    ALLOW_TIME_TRAVEL?: string;
  }
}
