-- CandidateVoice migration: durable rate limiting + moderation audit trail
--
-- This is not applied automatically. Run it against your Supabase project via
-- the SQL Editor (https://app.supabase.com -> your project -> SQL Editor) or,
-- if the project is linked, `supabase db push`.
--
-- Safe to run more than once (IF NOT EXISTS / IF EXISTS / OR REPLACE guards
-- throughout). Until this runs, the application code that depends on it
-- degrades gracefully rather than breaking:
--   * src/lib/rate-limit.ts logs a warning and treats every request as
--     not-rate-limited (same effective behavior as the in-memory limiter it
--     replaces, which didn't survive serverless cold starts anyway).
--   * src/app/api/admin/reject/route.ts falls back to hard-delete.
--   * src/app/api/admin/approve/route.ts falls back to not touching
--     rejected_at.
--   * src/app/api/admin/list-pending/route.ts falls back to its previous
--     query (without the rejected_at filter).

-- 1. Durable, atomic rate limiting — replaces the in-memory Map in the old
--    submit/route.ts (didn't survive serverless cold starts) AND an earlier
--    version of this migration that used a plain event-log table with a
--    separate count-then-insert from the client, which was a real
--    check-then-act race under concurrent requests from the same identifier.
--    This design instead keeps one row per (scope, identifier_hash) and
--    increments it atomically in a single statement via rate_limit_increment
--    below, so concurrent callers are serialized by Postgres's row lock on
--    the conflict target — no race window. See src/lib/rate-limit.ts.
create table if not exists rate_limit_counters (
  scope text not null,
  identifier_hash text not null,
  window_start timestamptz not null default now(),
  count integer not null default 1,
  primary key (scope, identifier_hash)
);

alter table rate_limit_counters enable row level security;
-- Deliberately no policies for anon/authenticated: with RLS enabled and no
-- permissive policy, only the service-role key (server-only, see
-- src/lib/supabase/server.ts) can read or write this table directly.

create or replace function rate_limit_increment(
  p_scope text,
  p_identifier_hash text,
  p_window_seconds integer
) returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  insert into rate_limit_counters (scope, identifier_hash, window_start, count)
  values (p_scope, p_identifier_hash, now(), 1)
  on conflict (scope, identifier_hash) do update
    set
      count = case
        when rate_limit_counters.window_start <= now() - make_interval(secs => p_window_seconds)
          then 1
        else rate_limit_counters.count + 1
      end,
      window_start = case
        when rate_limit_counters.window_start <= now() - make_interval(secs => p_window_seconds)
          then now()
        else rate_limit_counters.window_start
      end
  returning count into v_count;

  return v_count;
end;
$$;

-- Supabase/PostgREST auto-exposes every public-schema function as a callable
-- RPC endpoint and grants execute to anon/authenticated by default. Without
-- this revoke, any site visitor could call rate_limit_increment directly
-- with an arbitrary scope/identifier — e.g. to grief another IP's bucket, or
-- pollute the table. Only the service-role client (server-side only) should
-- ever call this.
revoke execute on function rate_limit_increment(text, text, integer) from public;
revoke execute on function rate_limit_increment(text, text, integer) from anon;
revoke execute on function rate_limit_increment(text, text, integer) from authenticated;
grant execute on function rate_limit_increment(text, text, integer) to service_role;

-- 2. Moderation audit trail — replaces hard-delete on reject, which left no
--    record of what was rejected or when. Additive and nullable; existing
--    rows are unaffected. NULL means "not rejected."
alter table hiring_submissions add column if not exists rejected_at timestamptz;

-- Optional, low-cost forward-looking index for the list-pending query
-- pattern (is_approved = false AND rejected_at IS NULL, ordered by
-- created_at). Not urgent at this app's current scale, cheap to have.
create index if not exists hiring_submissions_pending_idx
  on hiring_submissions (is_approved, rejected_at, created_at)
  where is_approved = false;

-- Rollback (nothing here is destructive to existing data if reverted):
--   drop index if exists hiring_submissions_pending_idx;
--   alter table hiring_submissions drop column if exists rejected_at;
--   drop function if exists rate_limit_increment(text, text, integer);
--   drop table if exists rate_limit_counters;
