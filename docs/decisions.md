# Architecture decisions

Short notes on decisions and clarifications. Newest at the bottom. The original brief is in `oppdrag.md`.

## 2026-10-23 – Phase 0 clarifications

- **Rounding: half-up**, 2 decimals for amounts in league currency, applied only when an amount is booked (written to a transaction) or displayed. Intermediate calculations keep full precision. Chosen over banker's rounding so the estimate a user checks by hand matches what is booked.
- **Single cash balance per member, in the league currency.** No multi-currency cash accounts. Every trade, fee and dividend is converted to the league currency at the moment it is booked.
- **Whole shares only.** Fractional shares are not supported, and there is no league setting for it (the brief proposed a setting defaulting to off; the product owner chose to drop it). Quantity is still stored as `numeric` so this can be revisited without a migration of existing data.
- **Dividends are credited without withholding tax.**
- **Leaderboard tie-break for members without trades:** their join time is used as their "last trade" time. Rule: equal return % → the member whose last trade (or join time, if no trades) is oldest ranks higher.
- **Local Supabase requires Docker Desktop** (being installed by the product owner).
