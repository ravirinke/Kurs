-- Security: profiles, the immutable ledger, the visibility rule, RLS and grants.
--
-- Model: browsers and apps may only READ, and only what the rules allow. Every write goes
-- through the server (Drizzle on a direct connection), which runs the business rules from
-- packages/core. RLS is the second line of defence if a server query is ever wrong.

--------------------------------------------------------------------------------
-- 1. A profile for every new auth user
--------------------------------------------------------------------------------

create function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name)
  values (
    new.id,
    coalesce(
      nullif(trim(new.raw_user_meta_data ->> 'display_name'), ''),
      nullif(split_part(coalesce(new.email, ''), '@', 1), ''),
      'Spiller'
    )
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

--------------------------------------------------------------------------------
-- 2. Transactions are immutable
--------------------------------------------------------------------------------

create function public.prevent_ledger_change() returns trigger
language plpgsql
as $$
begin
  raise exception 'transactions are immutable: % is not allowed', tg_op
    using errcode = 'P0001';
end;
$$;

create trigger transactions_immutable
  before update or delete on public.transactions
  for each row execute function public.prevent_ledger_change();

create trigger transactions_no_truncate
  before truncate on public.transactions
  for each statement execute function public.prevent_ledger_change();

--------------------------------------------------------------------------------
-- 3. The visibility rule
--
-- ⚠️ MUST MATCH packages/core/src/visibility (resolvePortfolioAccess).
--    packages/db/test/visibility-parity.test.ts checks every combination against core.
--------------------------------------------------------------------------------

create function public.portfolio_access_rule(
  visibility public.visibility,
  league_finished boolean,
  viewer_is_member boolean,
  is_self boolean
) returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when not viewer_is_member then 'none'
    when is_self then 'full'
    when league_finished then 'full'
    when visibility = 'open' then 'full'
    when visibility = 'delayed' then 'delayed'
    else 'return_only'
  end
$$;

-- Delayed visibility shows what happened more than 24 hours ago (DELAYED_VISIBILITY_HOURS).
create function public.delayed_visibility_cutoff() returns timestamptz
language sql
stable
set search_path = ''
as $$
  select now() - interval '24 hours'
$$;

-- Helpers are SECURITY DEFINER so they can read the tables they protect without recursing
-- into RLS. They only ever answer questions about the calling user (auth.uid()).

create function public.is_league_member(target_league uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members m
    where m.league_id = target_league and m.user_id = (select auth.uid())
  )
$$;

create function public.is_league_owner(target_league uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.leagues l
    where l.id = target_league and l.owner_id = (select auth.uid())
  )
$$;

create function public.is_own_member(target_member uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members m
    where m.id = target_member and m.user_id = (select auth.uid())
  )
$$;

create function public.shares_league_with(other_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members mine
    join public.league_members theirs on theirs.league_id = mine.league_id
    where mine.user_id = (select auth.uid()) and theirs.user_id = other_user
  )
$$;

-- 'none' | 'full' | 'delayed' | 'return_only' for the calling user looking at a member.
create function public.portfolio_access(target_member uuid) returns text
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(
    (
      select public.portfolio_access_rule(
        l.visibility,
        l.finalized_at is not null or l.ends_at <= now(),
        exists (
          select 1 from public.league_members v
          where v.league_id = m.league_id and v.user_id = (select auth.uid())
        ),
        m.user_id = (select auth.uid())
      )
      from public.league_members m
      join public.leagues l on l.id = m.league_id
      where m.id = target_member
    ),
    'none'
  )
$$;

revoke execute on function public.handle_new_user() from public, anon, authenticated;

--------------------------------------------------------------------------------
-- 4. Grants: read-only, and only the columns that may be shown
--------------------------------------------------------------------------------

revoke all on all tables in schema public from anon, authenticated;
revoke all on all sequences in schema public from anon, authenticated;
-- Tables created by later migrations start closed too.
alter default privileges for role postgres in schema public revoke all on tables from anon, authenticated;
alter default privileges for role postgres in schema public revoke all on sequences from anon, authenticated;

grant select on
  public.exchanges,
  public.exchange_trading_hours,
  public.exchange_holidays,
  public.instruments,
  public.prices,
  public.fx_rates,
  public.corporate_actions,
  public.profiles,
  public.leagues,
  public.league_allowed_exchanges,
  public.league_join_requests,
  public.quotes,
  public.transactions,
  public.holdings
to authenticated;

-- Cash balance and the time of the last trade are part of a portfolio, so they are not
-- readable directly. The server returns a member's own cash, and the leaderboard.
grant select (id, league_id, user_id, joined_at, final_rank, final_value, final_return, is_winner)
  on public.league_members to authenticated;

grant select (league_id, member_id, date, value, return_fraction, taken_at)
  on public.portfolio_snapshots to authenticated;

grant update (display_name) on public.profiles to authenticated;

--------------------------------------------------------------------------------
-- 5. Row level security
--------------------------------------------------------------------------------

alter table public.exchanges enable row level security;
alter table public.exchange_trading_hours enable row level security;
alter table public.exchange_holidays enable row level security;
alter table public.instruments enable row level security;
alter table public.prices enable row level security;
alter table public.fx_rates enable row level security;
alter table public.corporate_actions enable row level security;
alter table public.profiles enable row level security;
alter table public.leagues enable row level security;
alter table public.league_allowed_exchanges enable row level security;
alter table public.league_members enable row level security;
alter table public.league_join_requests enable row level security;
alter table public.quotes enable row level security;
alter table public.transactions enable row level security;
alter table public.holdings enable row level security;
alter table public.portfolio_snapshots enable row level security;

-- Reference and market data: any signed-in user.
create policy "signed-in users read exchanges" on public.exchanges
  for select to authenticated using (true);
create policy "signed-in users read trading hours" on public.exchange_trading_hours
  for select to authenticated using (true);
create policy "signed-in users read holidays" on public.exchange_holidays
  for select to authenticated using (true);
create policy "signed-in users read instruments" on public.instruments
  for select to authenticated using (true);
create policy "signed-in users read prices" on public.prices
  for select to authenticated using (true);
create policy "signed-in users read fx rates" on public.fx_rates
  for select to authenticated using (true);
create policy "signed-in users read corporate actions" on public.corporate_actions
  for select to authenticated using (true);

-- Profiles: your own, and those of people in a league with you.
create policy "read own and fellow members' profiles" on public.profiles
  for select to authenticated
  using (id = (select auth.uid()) or public.shares_league_with(id));
create policy "update own profile" on public.profiles
  for update to authenticated
  using (id = (select auth.uid()))
  with check (id = (select auth.uid()));

-- Leagues and their members: only leagues you are a member of.
create policy "members read their leagues" on public.leagues
  for select to authenticated using (public.is_league_member(id));
create policy "members read allowed exchanges" on public.league_allowed_exchanges
  for select to authenticated using (public.is_league_member(league_id));
create policy "members read fellow members" on public.league_members
  for select to authenticated using (public.is_league_member(league_id));
create policy "members read snapshots" on public.portfolio_snapshots
  for select to authenticated using (public.is_league_member(league_id));

-- Join requests: the person asking, and the league owner.
create policy "requester and owner read join requests" on public.league_join_requests
  for select to authenticated
  using (user_id = (select auth.uid()) or public.is_league_owner(league_id));

-- Quotes: only your own.
create policy "read own quotes" on public.quotes
  for select to authenticated using (public.is_own_member(member_id));

-- Transactions and holdings follow the visibility rule.
create policy "read transactions allowed by visibility" on public.transactions
  for select to authenticated
  using (
    case public.portfolio_access(member_id)
      when 'full' then true
      when 'delayed' then occurred_at <= public.delayed_visibility_cutoff()
      else false
    end
  );

-- The holdings cache is the current state, so it is only shown with full access. Delayed
-- holdings are rebuilt by the server from the visible transactions.
create policy "read holdings with full access" on public.holdings
  for select to authenticated
  using (public.portfolio_access(member_id) = 'full');
