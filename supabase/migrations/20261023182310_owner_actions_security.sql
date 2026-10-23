-- Owner actions: removed members lose access; cancelled leagues; confirmed display names.
--
-- A removed member keeps their league_members row (so they can never rejoin with a fresh
-- start amount), but every RLS helper treats them as not a member.

--------------------------------------------------------------------------------
-- 1. A name given at sign-up (seed, admin API) counts as confirmed
--------------------------------------------------------------------------------

create or replace function public.handle_new_user() returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  given_name text := nullif(trim(new.raw_user_meta_data ->> 'display_name'), '');
begin
  insert into public.profiles (id, display_name, name_confirmed)
  values (
    new.id,
    coalesce(given_name, nullif(split_part(coalesce(new.email, ''), '@', 1), ''), 'Spiller'),
    given_name is not null
  );
  return new;
end;
$$;

--------------------------------------------------------------------------------
-- 2. Membership helpers ignore removed members
--
-- ⚠️ portfolio_access must still match packages/core (resolvePortfolioAccess); only the
--    definition of "member" changes here. visibility-parity.test.ts checks the rule.
--------------------------------------------------------------------------------

create or replace function public.is_league_member(target_league uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members m
    where m.league_id = target_league
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  )
$$;

create or replace function public.is_own_member(target_member uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.league_members m
    where m.id = target_member
      and m.user_id = (select auth.uid())
      and m.removed_at is null
  )
$$;

create or replace function public.shares_league_with(other_user uuid) returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.league_members mine
    join public.league_members theirs on theirs.league_id = mine.league_id
    where mine.user_id = (select auth.uid())
      and mine.removed_at is null
      and theirs.user_id = other_user
      and theirs.removed_at is null
  )
$$;

create or replace function public.portfolio_access(target_member uuid) returns text
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
          where v.league_id = m.league_id
            and v.user_id = (select auth.uid())
            and v.removed_at is null
        ),
        m.user_id = (select auth.uid())
      )
      from public.league_members m
      join public.leagues l on l.id = m.league_id
      where m.id = target_member
        and m.removed_at is null
    ),
    'none'
  )
$$;

-- removed_at is not part of a portfolio; members may see who is still in the league.
grant select (removed_at) on public.league_members to authenticated;
