-- Real prices (phase 6): security for the price cache.
--
-- latest_quotes is market data like prices and fx_rates: signed-in users may read it.
-- price_fetch_state is the server's bookkeeping (it can hold a source's error text), so it
-- stays closed: no grants (default privileges already revoke them) and RLS without policies.

alter table public.latest_quotes enable row level security;
grant select on public.latest_quotes to authenticated;
create policy "signed-in users read latest quotes" on public.latest_quotes
  for select to authenticated using (true);

alter table public.price_fetch_state enable row level security;
revoke all on public.price_fetch_state from anon, authenticated;

-- Instrument search by name or ticker over a few thousand rows.
create index instruments_search on public.instruments (exchange_id, lower(name));
