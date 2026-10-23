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

## 2026-10-23 – Phase 2 clarifications

- **FX precision:** a quote locks the FX rate rounded half-up to **6 decimals**, and that exact rate is used in the calculation and stored on the transaction. Two decimals (as Nordnet displays) were rejected: e.g. NOK→USD 0.0922 → 0.09 would misprice by 2.4 %. Display: 2 decimals when the rate is ≥ 1, 4 when < 1; the trade breakdown shows the full locked rate so the user can verify it.
- **Prices** are locked with up to 4 decimals (half-up).
- **Booked amounts:** gross = quantity × price × locked FX, rounded half-up to 2 decimals. Fee = max(gross × fee rate, minimum), rounded half-up to 2 decimals. Buy total = gross + fee; sell proceeds = gross − fee.
- **Reverse split with a fractional result** (whole shares only): the member keeps the whole shares and receives the fraction as cash ("cash in lieu") at the last close before the split, converted at that close's FX rate.
- **Average cost includes brokerage fees**, in the league currency.
- **Ranking** uses portfolio value rounded to whole øre (2 decimals) and the return computed from it.
- **Tie-break (replaces the brief's rule only for the no-trade case):** equal return → the member whose last trade is **oldest** ranks higher (protects the original against a copycat, who always trades later). Members with equal return who have never traded **share** the place, and rank after tied members who have traded. Members equal on both return and last-trade time also share. Standard competition ranking (1, 1, 3). A shared first place gives several winners.
- **Max position share** uses the portfolio value at quote time (before the trade) as the denominator.
- **A sell whose fee exceeds the proceeds** is rejected if it would make cash negative.
- **League end time:** for every allowed exchange, if that exchange has a session on the end time's local date, the end time must be at or after that session's close.
- **"Finished"** is derived as soon as `now ≥ endsAt` (trading stops). Final results are written once by the finalization job and never recomputed.
- **Leaderboard returns are live for all visibility levels**; visibility only governs holdings and trades.
- **Dividend eligibility:** quantity held at the start of the ex-date (exchange local time). Paid on the pay date at that day's FX rate.

## 2026-10-23 – Phase 2 implementation notes

- **Locked after start: everything except name, description and end time.** The brief lists currency, start amount, fee rules and exchanges as locked; we also lock visibility, late join, max members and max position share, since changing them mid-league is unfair or leaks information. Sending an unchanged locked field is accepted (forms post everything).
- **Default start amounts:** NOK 100 000, SEK 100 000, DKK 75 000, EUR 10 000, USD 10 000.
- **Exchange IDs are MIC codes:** XOSL, XSTO, XCSE, XNAS, XNYS. Reference data (hours, holidays, half days) lives in `packages/core/src/market/exchanges.ts` and will seed the database.
- **⚠️ Holidays and half days for 2026–2027 were entered manually from memory and MUST be verified against the official calendars** of Oslo Børs (Euronext), Nasdaq Nordic and NYSE/Nasdaq before going live. Uncertain entries include Oslo Børs' half day on the Wednesday before Easter and Stockholm's half days (Jan 5, Apr 30, the day before Ascension, the Friday before All Saints).
- **Sessions are [open, close)**: a trade at exactly the closing time is rejected.
- **Quote validity is [createdAt, createdAt + 30 s)** (was 15 s in the brief; changed to 30 s by the product owner in phase 4 planning).
- **Mock prices** follow smooth deterministic noise per instrument (weekly, daily, hourly and 5-minute components), roughly ±10 % around a base price, with 2-decimal ticks. FX drifts by a fraction of a percent. JS numbers are used only for these random multipliers, never for amounts. Prices before a split are multiplied by the split factor as seen at query time. The mock does not drop the price on a dividend's ex-date.
- **core never reads the clock** (`Date.now`, `new Date()`, `DateTime.now/local/utc` are lint errors); never calls `toNumber()`, `parseFloat` or `Math.random`.
- **Rejections are codes, not text** (`INSUFFICIENT_CASH`, `MARKET_CLOSED`, …); the web app maps them to Norwegian.

## 2026-10-23 – Membership changes (product owner)

- **No member limit.** The brief's "max members" setting (default 50) is removed.
- **Late joining always requires the owner's approval.** Replaces the brief's "late join" on/off setting:
  - Before the start: joining with the invite link or code is direct.
  - After the start: joining creates a pending request. Only the league owner can approve or decline it, once.
  - Approved members get the full start amount, deposited at the approval time.
  - Nobody can join or be approved after the league has finished; declining is still possible. A request still pending at the end simply stays unapproved.
  - People with a pending request are not members and see nothing of the league's portfolios.

## 2026-10-23 – Start amount (product owner)

- The league owner picks the currency and types any start amount (> 0, ≤ 1 000 000 000, at most 2 decimals). The form is prefilled with a suggestion per currency (`DEFAULT_START_AMOUNT`: NOK/SEK 100 000, DKK 75 000, EUR/USD 10 000) that can be overwritten.

## 2026-10-23 – Locked fields confirmed (product owner)

- After the start, only **name, description and end time** can change. Everything else is locked: currency, start amount, start time, fees, allowed exchanges, visibility and max position share. (Already implemented in `validateLeagueUpdate`.)
- The end time can be moved both earlier and later, as long as it is in the future and after the allowed exchanges close that day.

## 2026-10-23 – Phase 3: database

- **Migrations:** the Drizzle schema (`packages/db/src/schema`) is the source of truth for tables; `drizzle-kit generate` writes SQL straight into `supabase/migrations` with Supabase's timestamp naming, so `supabase db reset` applies everything. Security (RLS, grants, triggers, SQL functions) is a hand-written custom migration, kept readable in one file.
- **Numeric columns are unconstrained `numeric` with CHECK constraints on `scale()`** (amounts 2, prices 4, FX 6, quantities 6). `numeric(p,s)` would silently round a wrong value; a CHECK makes it fail loudly. Values cross into TypeScript only as strings.
- **Read-only clients.** `anon` gets nothing; `authenticated` gets SELECT only, through RLS. Every write goes through server services in `packages/db` (direct connection, bypasses RLS) that apply the rules from `core`.
- **Column-level grants hide** a member's cash balance and last trade time, and the cash in snapshots. Ranks, returns and values are visible to league members; the server builds the leaderboard.
- **The visibility rule is duplicated in SQL** (`public.portfolio_access_rule`) for RLS. A parity test runs every combination through both. Delayed visibility in RLS shows transactions older than 24 h by the database clock; the holdings cache is only readable with full access, and delayed holdings are rebuilt server-side from visible transactions.
- **Transactions are append-only**: a trigger blocks UPDATE, DELETE and TRUNCATE, even for the server. Consequence: leagues with transactions cannot be deleted; deleting user data (GDPR) will need a deliberate design later.
- **Trade execution** (`executeTrade`): one DB transaction; lock the member row (`FOR UPDATE`), check the idempotency key (same key + same quote returns the original result; same key + other quote is refused), lock the quote and require it unused, replay the member's events through `core` and validate with fresh market status, then append the event, mark the quote used and rewrite the cache. Validation uses the replayed events, not the cache.
- **Known trade-off:** the PriceProvider is called (market status, and valuation for the max-share rule) while the member lock is held. Fine with the mock; with a slow real API, fetch what can be fetched before the transaction.
- **Rejected quotes are not stored.** Quotes are single-use (`used_at`).
- **League status is not a stored column**: derived from the times, with `finalized_at` marking that the final result has been written (the brief's "stored at finalization").
- **Joining is serialised per league** (row lock on the league), so double clicks cannot add a member twice; a partial unique index allows one pending join request per user and league.
- **Invite codes:** 8 characters without look-alikes (no 0/O, 1/I/L), case-insensitive, spaces and dashes ignored.
- **Instruments have UUID ids.** Mock base prices live in the seed catalogue keyed by ISIN; `createMockPriceProvider(db, …)` builds the provider from the database.
- **Seed:** test users via the Supabase Auth admin API (real, can sign in); the test league's trades go through the real `createQuote`/`executeTrade` at past market hours. Re-running the seed leaves existing data alone.
- **Database tests run separately** (`pnpm test:db`, needs `pnpm db:start`) so `pnpm test` works without Docker. Each test creates its own users and leagues. The concurrency tests were checked by removing `FOR UPDATE` (they fail) and the RLS tests by loosening a policy (they fail).

## 2026-10-23 – Phase 4: web app

Product decisions (planned point by point with the product owner):

- Sign-in with magic link only. First sign-in asks for a display name (`profiles.name_confirmed`; names given at sign-up, e.g. by the seed, count as confirmed).
- Home page sections: active, upcoming, awaiting approval, finished. Upcoming cards show the member count, not a rank.
- Create league: one page, with visibility, exchanges, fees and max share under "Flere innstillinger". **Start defaults to the next market open** of the chosen exchanges (`suggestStartTime`); end is a date, the time follows from the exchanges' closes (`suggestEndTime`).
- Invite code: **6 characters**, letters and digits without look-alikes, shown to all members in "Om ligaen" with a share link `/bli-med/<code>`.
- Late join requests are approved from a banner on the league page.
- League page tabs: Tabell (with value in kr, return, movement, today's winners/losers among members), Aktivitet, Om ligaen. Buttons "Handle" and "Min portefølje"; no fixed bottom navigation.
- Trading happens inside a league: exchanges with open/closed status, search, today's winners/losers among stocks, stock page with 1 d / 1 u / 1 m / 3 m / 1 år and who in the league owns it (subject to visibility).
- **Quotes are held for 30 seconds** (was 15). When a quote expires the sheet fetches a new one automatically and highlights it; the user always confirms the price shown.
- Buy by quantity **or by amount**: the server turns an amount into the most whole shares whose total incl. brokerage fits (`maxQuantityForAmount`). Selling is by quantity (with "Alt").
- Portfolio: value, return, today, cash, holdings with return and today's change, value chart since joining, trades, allocation by stock and exchange. The same page shows others' portfolios per the visibility rule.
- Owner settings: name, description, end date; new invite code; **remove member** (soft: `league_members.removed_at`; they lose access and can never rejoin, since rejoining would give a fresh start amount; their transactions stay); **cancel before start** (`leagues.cancelled_at`; hidden from everyone, open requests declined).
- No member limit.

Technical:

- Server components read through services in `packages/db` (`loadMyLeagues`, `loadLeaderboard`, `loadPortfolio`, `loadActivity`, `loadTradingHome`, `loadInstrumentDetail`, …); server actions write through the existing services. Visibility for others' holdings and trades is applied in these services with `resolvePortfolioAccess`.
- "Today" means since the start of the calendar day in Europe/Oslo (`startOfAppDay`), computed live from events and historical prices, not from snapshots.
- `PriceProvider.getPriceHistory` (5 m / 1 h / 1 d) added for charts; charts are a small hand-written SVG component.
- **Dev time machine:** with `ALLOW_TIME_TRAVEL=1` (never in production) a cookie shifts the server's "now"; time keeps running from the chosen moment. Used for manual testing and to make end-to-end tests independent of the real time.
- **Root `.env` loading:** `@next/env`'s `loadEnvConfig` caches the env Next already loaded for `apps/web` and silently ignored the root `.env`; `next.config.ts` now uses `process.loadEnvFile`, and passes the public Supabase values through `env` so the proxy gets them.
- **Local Supabase auth rate limits raised** (`email_sent` was 2 per hour), or testing with several users was impossible.
- End-to-end tests with Playwright (`pnpm test:e2e`) on a mobile viewport. Each run creates its own users.

## 2026-10-23 – App name

- The app is now called **Kurs** (was the working name "Aksjeliga"). Only the user-facing name changed (`nb.app.name`, README, design doc). Internal identifiers (`@aksjeliga/*` package scope, Supabase project id, cookie names) stay as they are.
