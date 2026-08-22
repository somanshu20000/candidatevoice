-- CandidateVoice migration: live presence (site-wide + per-company active counts)
--
-- WHY THIS EXISTS
-- Social proof — "127 people are exploring CandidateVoice" / "143 people are
-- viewing this company" — refreshed roughly every minute. Deliberately its
-- own tiny subsystem, structurally disjoint from every other graph in this
-- codebase: not evidence, not identity, not moderation, not ranking. It
-- answers exactly one question — "is anyone here right now" — and nothing
-- it stores can ever influence HQS, the fingerprint, search ranking, or any
-- other truth-layer number. It is also disjoint from the anonymous CANDIDATE
-- identity (0015): a presence session_id is generated fresh per browser tab
-- with no persistence beyond that tab, never written to the cv_candidate
-- cookie, and carries no path to candidate_preferences/candidate_saved_companies.
--
-- WHY POSTGRES, NOT REDIS — same reasoning src/lib/rate-limit.ts already
-- established for the identical shape of problem (a short-TTL counter under
-- concurrent writes): this app's actual traffic does not justify a new
-- vendor, credential, and failure domain. One additional table + one atomic
-- upsert function, on the same connection every other write already uses.
-- Revisit only if rate-limit.ts's own documented triggers are ever met
-- (sustained >10k req/day, rate-limit ops becoming a measurable % of DB
-- load, connection-pool contention, or Redis being added for an unrelated
-- reason).
--
-- ONE ROW PER SESSION, UPSERTED, NEVER APPENDED. A session's row is
-- overwritten on every heartbeat (last_seen_at bumped, organization_id
-- updated to wherever the tab currently is) — the table's steady-state size
-- is bounded by concurrent active tabs, not by total heartbeats ever sent.
-- Rows for tabs that stop heartbeating simply stop being touched and age
-- out of the "active" window (last_seen_at within ~2 minutes) automatically
-- for counting purposes; a separate cron (src/app/api/cron/presence-cleanup)
-- hard-deletes rows older than a generous multiple of that window so the
-- table does not grow without bound from abandoned tabs that never send a
-- clean "goodbye" (browsers don't reliably fire one).
--
-- NO PII. session_id is a client-generated random UUID with no relationship
-- to any account, cookie, or IP — it identifies a browser TAB's lifetime,
-- nothing more. No email, no IP, no user-agent, no exact timestamp beyond
-- last_seen_at (which only ever gates a >100 THRESHOLD count, never
-- rendered per-row or per-session to any client).
--
-- Run order: after 0035.

create table if not exists presence_sessions (
  session_id      uuid primary key,
  last_seen_at    timestamptz not null default now(),
  -- Which company page (if any) this tab is currently on. Nullable: a tab on
  -- the homepage/browse/etc. heartbeats with this null and only counts
  -- toward the global figure. Never a FK-cascade risk to evidence — this
  -- column points at organizations(id) only, the one value this migration's
  -- own header (mirroring 0004/0015/0034's precedent) explicitly allows a
  -- non-evidence table to share: an employer, never a person.
  organization_id uuid references organizations(id) on delete set null
);

-- The hot read path: "how many rows have last_seen_at within the window,
-- optionally filtered to one organization." Partial index on the non-null
-- case keeps the company-scoped count cheap without bloating the index with
-- every homepage/browse heartbeat (organization_id is null there).
create index if not exists presence_sessions_last_seen_idx
  on presence_sessions (last_seen_at);
create index if not exists presence_sessions_org_last_seen_idx
  on presence_sessions (organization_id, last_seen_at)
  where organization_id is not null;

-- RLS enabled, NO policy — service-role only, the same "the opaque id a
-- server route already verified is the capability, not a public read/write
-- surface" pattern rate_limit_counters (0001) and candidate_preferences
-- (0015) both use. Clients never touch this table directly; every read and
-- write goes through /api/presence/heartbeat, which is the only place a
-- count is computed and returned.
alter table presence_sessions enable row level security;

-- Atomic upsert — a heartbeat is a single statement, so two concurrent
-- heartbeats for the same session_id (a genuine possibility: a fast client
-- retry, or two tabs briefly sharing a session_id due to a client bug)
-- serialize on Postgres's row lock on the conflict target, exactly like
-- rate_limit_increment (0001) already does for the identical concurrency
-- shape.
create or replace function presence_heartbeat(
  p_session_id uuid,
  p_organization_id uuid
) returns void
language plpgsql
as $$
begin
  insert into presence_sessions (session_id, last_seen_at, organization_id)
  values (p_session_id, now(), p_organization_id)
  on conflict (session_id) do update
    set last_seen_at = now(),
        organization_id = p_organization_id;
end;
$$;

-- One round trip returns both figures the heartbeat response needs.
-- p_organization_id may be null (a global-only page) — the company_count
-- subquery then legitimately matches nothing and returns 0, which the
-- >100 threshold already renders as "don't show," so no special-casing is
-- needed at the call site.
create or replace function presence_counts(
  p_organization_id uuid,
  p_window_seconds integer default 120
) returns table (global_count integer, company_count integer)
language sql
stable
as $$
  select
    (select count(*)::integer from presence_sessions
       where last_seen_at > now() - make_interval(secs => p_window_seconds)) as global_count,
    (select count(*)::integer from presence_sessions
       where organization_id = p_organization_id
         and last_seen_at > now() - make_interval(secs => p_window_seconds)) as company_count;
$$;

-- Rollback:
--   drop function if exists presence_counts(uuid, integer);
--   drop function if exists presence_heartbeat(uuid, uuid);
--   drop table if exists presence_sessions;
