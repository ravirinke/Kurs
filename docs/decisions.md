# Architecture decisions

Short notes on decisions and clarifications. Newest at the bottom. The original brief is in `oppdrag.md`.

## 2026-10-23 – Phase 0 clarifications

- **Rounding: half-up**, 2 decimals for amounts in league currency, applied only when an amount is booked (written to a transaction) or displayed. Intermediate calculations keep full precision. Chosen over banker's rounding so the estimate a user checks by hand matches what is booked.
- **Single cash balance per member, in the league currency.** No multi-currency cash accounts. Every trade, fee and dividend is converted to the league currency at the moment it is booked.
- **Whole shares only.** Fractional shares are not supported, and there is no league setting for it (the brief proposed a setting defaulting to off; the product owner chose to drop it). Quantity is still stored as `numeric` so this can be revisited without a migration of existing data.
- **Dividends are credited without withholding tax.**
- **Leaderboard tie-break for members without trades:** their join time is used as their "last trade" time. Rule: equal return % → the member whose last trade (or join time, if no trades) is oldest ranks higher.
- **Max position share is checked on buy only.** A buy is rejected if the resulting position would exceed the limit, valued at quote time. Sells are never blocked, and a position that grows past the limit through price movement is allowed.
- **Local Supabase requires Docker Desktop.**

## 2026-10-23 – Phase 1 tooling

- **Versions:** Node 24, pnpm 12 (via corepack, pinned in `packageManager`), Turborepo 2, Next.js 16, React 19, Tailwind 4, Vitest 5.
- **TypeScript pinned to 6.0.x.** TypeScript 7 is out, but typescript-eslint supports `<6.1` only. Upgrade when it does.
- **ESLint pinned to 9.** ESLint 10 is out, but the React and import plugins used by eslint-config-next don't support it yet.
- **Stricter than `strict`:** `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, `noPropertyAccessFromIndexSignature` (so env vars are read as `process.env["X"]`). Lint uses typescript-eslint `strictTypeChecked`.
- **`core` purity is enforced by ESLint** (`no-restricted-imports`): no Next/React, database or Node I/O modules.
- **Workspace packages are consumed as TypeScript source** (no build step); Next transpiles them via `transpilePackages`.
- **One `.env` in the repo root**, loaded explicitly by `next.config.ts` and `drizzle.config.ts`, instead of one env file per package.
- **Supabase keys:** we use the new key names (`PUBLISHABLE_KEY` / `SECRET_KEY`) rather than the legacy `anon` / `service_role` JWTs. The local values in `.env.example` are the CLI's public defaults, not secrets.
- **Supabase Storage is disabled locally** (not used yet). Auth emails go to Mailpit; `site_url` is `http://localhost:3000`.
- **Dark mode** follows the OS by default; `class="dark"` / `class="light"` on `<html>` overrides it. Both the colour tokens and Tailwind's `dark:` variant use the same rule.
- **Vitest runs with `TZ=UTC`** so tests never depend on the developer's machine time zone.
