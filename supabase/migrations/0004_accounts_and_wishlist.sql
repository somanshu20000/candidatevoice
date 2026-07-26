-- CandidateVoice migration: accounts, wishlist, saved comparisons
--
-- WHY THIS EXISTS
-- Wishlist and profile need durable per-person state, which the platform has
-- never had — there is no auth system at all today, only an anonymous
-- HMAC-signed unlock cookie.
--
-- ============================================================================
-- THE INVARIANT THIS MIGRATION MUST NOT BREAK
-- ============================================================================
-- docs/adr-0001-evidence-model.md §4.3:
--   "candidate_id / candidate hash / pseudonym — even a hash is a linkage key
--    that correlates one person's reports = de-anonymization. Never."
-- .github/pull_request_template.md blocks merge on:
--   "No de-anonymization features added (no user identity linkable to
--    submissions)"
--
-- Therefore: NOTHING in this migration references hiring_submissions,
-- submission_ratings or submission_emotions. Not by foreign key, not by a
-- nullable id column, not by a hash, not by a timestamp precise enough to
-- correlate. The account graph and the evidence graph share exactly one kind of
-- value — organization_id, which points at an employer, never at a person.
--
-- The practical consequence, and it is deliberate: a signed-in user CANNOT be
-- shown "my submitted reports". That list is the linkage key. A profile shows
-- what the account itself owns — wishlist, saved comparisons — and nothing that
-- would let anyone, including us, attribute a report to an account.
--
-- tests/account-evidence-disjointness.test.ts asserts this by parsing the
-- migration files, so a future column that violates it fails CI rather than
-- review.
-- ============================================================================
--
-- Run order: after 0004. Requires Supabase Auth (auth.users) to be enabled.

-- ---------------------------------------------------------------------------
-- 1. Profile
-- ---------------------------------------------------------------------------
--    A thin extension of auth.users. Email lives in auth.users and is never
--    copied here — one authoritative location for the only PII the platform
--    holds, so a deletion request has exactly one place to act on.
create table if not exists profiles (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  -- Career interests, used to order and suggest wishlist entries.
  preferred_roles      text[] not null default '{}',
  preferred_industries text[] not null default '{}',
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint profiles_display_name_length check (
    display_name is null or char_length(display_name) between 1 and 60
  ),
  -- Bound the arrays so a client cannot write unbounded data into a row it owns.
  constraint profiles_preferred_roles_bound check (array_length(preferred_roles, 1) is null or array_length(preferred_roles, 1) <= 20),
  constraint profiles_preferred_industries_bound check (array_length(preferred_industries, 1) is null or array_length(preferred_industries, 1) <= 20)
);

-- ---------------------------------------------------------------------------
-- 2. Wishlist
-- ---------------------------------------------------------------------------
create table if not exists wishlist_items (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references auth.users(id) on delete cascade,
  organization_id uuid not null references organizations(id) on delete cascade,

  desired_role     text,
  desired_location text,
  -- A band, not a figure. This is private planning data that is never
  -- aggregated and never published, but an exact expected salary is a needless
  -- precision to hold, and bands sort just as well. INR-denominated, matching
  -- the product's actual market.
  expected_salary_band text not null default 'not_specified'
    check (expected_salary_band in ('under_5l','5_10l','10_20l','20_40l','40l_plus','not_specified')),

  interest_level text not null default 'medium'
    check (interest_level in ('low','medium','high')),
  is_dream boolean not null default false,

  application_status text not null default 'not_applied'
    check (application_status in ('not_applied','preparing','applied','interviewing','offer','rejected','withdrawn')),

  -- Private planning note. Owner-only under RLS, never surfaced anywhere
  -- public, never aggregated, and capped.
  notes            text,
  target_date      date,
  priority         smallint not null default 3 check (priority between 1 and 5),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint wishlist_items_unique_org_per_user unique (user_id, organization_id),
  constraint wishlist_items_desired_role_length check (desired_role is null or char_length(desired_role) <= 120),
  constraint wishlist_items_location_length check (desired_location is null or char_length(desired_location) <= 120),
  constraint wishlist_items_notes_length check (notes is null or char_length(notes) <= 2000)
);

create index if not exists wishlist_items_user_idx
  on wishlist_items (user_id, priority, created_at desc);

-- ---------------------------------------------------------------------------
-- 3. Saved comparisons
-- ---------------------------------------------------------------------------
create table if not exists saved_comparisons (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references auth.users(id) on delete cascade,
  name             text not null,
  -- 2-4 organizations, matching what the comparison UI renders. Stored as an
  -- array rather than a join table because it is an ordered, bounded, private
  -- list with no independent identity of its own.
  organization_ids uuid[] not null,
  created_at       timestamptz not null default now(),

  constraint saved_comparisons_name_length check (char_length(name) between 1 and 80),
  constraint saved_comparisons_size check (
    array_length(organization_ids, 1) between 2 and 4
  )
);

create index if not exists saved_comparisons_user_idx
  on saved_comparisons (user_id, created_at desc);

-- ---------------------------------------------------------------------------
-- 4. RLS — owner-only on every account-owned table
-- ---------------------------------------------------------------------------
--    `using` governs which rows are visible to reads/updates/deletes;
--    `with check` governs what may be written. Both are required — `using`
--    alone would let an authenticated user INSERT a row owned by someone else.
alter table profiles          enable row level security;
alter table wishlist_items    enable row level security;
alter table saved_comparisons enable row level security;

drop policy if exists profiles_owner_all on profiles;
create policy profiles_owner_all
  on profiles for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists wishlist_items_owner_all on wishlist_items;
create policy wishlist_items_owner_all
  on wishlist_items for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists saved_comparisons_owner_all on saved_comparisons;
create policy saved_comparisons_owner_all
  on saved_comparisons for all
  to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Note the absence of any policy granting `anon` access to these tables. With
-- RLS enabled and no permissive policy, signed-out visitors cannot read them at
-- all — a wishlist is private by construction, not by filtering.

-- ---------------------------------------------------------------------------
-- 5. Auto-create a profile row on signup
-- ---------------------------------------------------------------------------
create or replace function handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (user_id)
  values (new.id)
  on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_user();

-- ---------------------------------------------------------------------------
-- 6. updated_at maintenance
-- ---------------------------------------------------------------------------
create or replace function touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on profiles;
create trigger profiles_touch_updated_at
  before update on profiles
  for each row execute function touch_updated_at();

drop trigger if exists wishlist_items_touch_updated_at on wishlist_items;
create trigger wishlist_items_touch_updated_at
  before update on wishlist_items
  for each row execute function touch_updated_at();

-- Rollback:
--   drop trigger if exists on_auth_user_created on auth.users;
--   drop function if exists handle_new_user();
--   drop table if exists saved_comparisons;
--   drop table if exists wishlist_items;
--   drop table if exists profiles;
--   drop function if exists touch_updated_at();
