-- Jobs (phase 5): the dev-only table of simulated corporate actions stays closed.
--
-- simulated_corporate_actions is read and written only by the server (direct connection),
-- for the mock provider. Browsers get no grants (default privileges already revoke them)
-- and RLS without policies, so nothing leaks even if a grant is added by mistake.

alter table public.simulated_corporate_actions enable row level security;
revoke all on public.simulated_corporate_actions from anon, authenticated;
