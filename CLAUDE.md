# CLAUDE.md

Fake-money stock league app. Friends compete in leagues trading real stocks with fictional money.
Full brief: `docs/oppdrag.md` (Norwegian, source of truth). Design: `docs/design.md`. Decisions: `docs/decisions.md`.

## Working agreement

- Work **one phase at a time** (phases in `docs/oppdrag.md` §7). Stop after each phase, summarize what was done, the choices made and what to test, then wait for approval.
- If something is unclear or conflicting, ask instead of guessing. Record clarifications in `docs/decisions.md`.
- Talk to the product owner in Norwegian. Code, identifiers, comments and commits are in English.
- **Never commit or push without the product owner's explicit permission**, each time. When a phase is done, say it is ready to commit and wait.

## Commands

`pnpm dev` · `pnpm test` · `pnpm typecheck` · `pnpm lint` · `pnpm format` · `pnpm db:start` / `db:stop`
All of `test`, `typecheck` and `lint` must pass before a phase is done.

## Layout

- `packages/core`: all business logic (trading, FX, market hours, valuation, leaderboard, visibility, corporate actions, `PriceProvider`). **Pure TypeScript, no I/O**, no Next.js, React or database imports (enforced by ESLint). Shared with the future Expo app.
- `packages/db`: Drizzle schema, migrations, RLS policies, seed.
- `packages/config`: shared tsconfig / ESLint / Prettier / Vitest.
- `apps/web`: Next.js App Router. Thin layer: server actions or route handlers call `core`.
- One `.env` in the repo root (see `.env.example`), loaded by `apps/web/next.config.ts` and `packages/db/drizzle.config.ts`.

## Non-negotiable rules

1. **Never use JS `number` for money, prices, FX rates or quantities.** Use decimal.js in TS and `numeric` in Postgres. Serialize as strings.
2. **Rounding:** half-up, only when an amount is booked or displayed. Full precision in between.
3. **Transactions are the truth.** Trades, fees, dividends and splits are immutable events. Holdings and cash can always be rebuilt from them; `holdings` is just a cache.
4. **The server sets the price.** Clients send only instrument, side and quantity. Never trust a client-supplied price or amount.
5. **Trades are atomic:** one DB transaction, `SELECT … FOR UPDATE` on the member row, idempotency key.
6. **Price data only through `PriceProvider`.** Nothing else knows which provider is in use.
7. **Time:** store UTC. Exchange hours are defined in the exchange's local time (IANA zone) and computed with Luxon. Never use the machine's local time zone in logic.
8. **Visibility** is one function in `core`, enforced on the server and with RLS, never only in the UI.

## Product rules worth remembering

- Single cash balance per member, in the league currency. Whole shares only.
- Trading only in regular exchange hours. Market orders only (keep room for limit orders later).
- Max position share is checked on buy only.
- Leaderboard ties: oldest last trade ranks higher; tied members who never traded share the place (several winners possible).
- No member limit. Joining is direct before the start; after the start it needs the owner's approval.

## UI

- All user-facing text and the app name live in `apps/web/src/i18n/nb.ts`. No hard-coded UI strings in components.
- Norwegian number formatting (`19 805,00 kr`, `+2,34 %`) through one formatting module.
- Up/down is never shown by colour alone: also use a sign and an arrow.
- Always make it clear the money is fictional.
- Take inspiration from Nordnet's structure and flow, never its look (logo, name, brand colours, icons, copy).
- Colour tokens live in `apps/web/src/app/globals.css` and mirror `docs/design.md`.

## Gotchas

- TypeScript is pinned to 6.0.x because typescript-eslint does not support 7 yet. ESLint is pinned to 9 because eslint-config-next's plugins don't support 10.
- On Windows, Docker's CLI may not be on PATH in an already-open shell after installing Docker Desktop. Restart the terminal.
- After `shadcn add`, check the generated imports (it once produced `from "cn"` instead of `@/lib/utils`) and run `pnpm format`.
