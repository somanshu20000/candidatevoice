-- CandidateVoice migration: close the hiring-opportunity exact-timestamp leak
-- (M5.6 / V1.1 — plan item D-016 / open question Q-5)
--
-- WHY THIS EXISTS
-- hiring-intent/analytics.ts already SAYS the right thing:
--   "exact timestamps are used INTERNALLY only... a single-report
--    opportunity's submission time is never derivable from anything this
--    module returns."
-- That was true of the application code, but never enforced at the database
-- layer. Migration 0023 gave `hiring_opportunities`/`hiring_events` an
-- UNCONDITIONAL anon/authenticated SELECT policy (`using (true)`) on the BASE
-- TABLES, not just the coarsened `public_*` views. Postgres RLS is row-level
-- only — it cannot hide a column. So the `public_hiring_opportunities` view's
-- own projection was never a real privacy boundary: any holder of the public
-- anon key (shipped in every browser bundle as NEXT_PUBLIC_SUPABASE_ANON_KEY)
-- could bypass the view entirely and `select first_observed_at from
-- hiring_opportunities` directly. For a company with exactly one candidate
-- report, that IS that candidate's exact submission time — an n=1
-- de-anonymization vector, exactly the class of leak `public_submissions`
-- (0003) was built to close for hiring_submissions.created_at, just never
-- applied here.
--
-- THE FIX — column-level GRANT, not just a view. RLS gates rows; this uses
-- Postgres's separate column-level privilege system to gate COLUMNS: revoke
-- blanket table SELECT from anon/authenticated, then grant SELECT back on
-- only the columns that were never sensitive (id, organization_id, role_key
-- / id, hiring_opportunity_id, actor_type, event_type, payload,
-- reported_month). The exact timestamp columns (first_observed_at,
-- last_activity_at, observation_deadline_at, hiring_events.created_at,
-- hiring_events.submission_id) become genuinely unreadable by anon —  not
-- merely unrendered by the app's own UI, which was the previous, weaker
-- guarantee. This closes the leak for ANY client, not just this codebase's
-- own frontend.
--
-- public_hiring_opportunities is redefined to expose ONLY the coarsened
-- `first_observed_month`/`last_activity_month` (YYYY-MM, mirroring
-- public_submissions.reported_month exactly) and drops
-- `observation_deadline_at` entirely — nothing public needs the raw
-- staleness deadline; staleness itself is already publicly knowable via the
-- existing `system_stale_inference` event in public_hiring_events (reported
-- at month granularity, same as every other event). Since the view's own
-- query must read the now-column-restricted first_observed_at/
-- last_activity_at to compute the coarsened month, it drops
-- `security_invoker = on` (switches to definer/owner-privilege mode) so it
-- can read those columns as its owner regardless of what anon/authenticated
-- are now restricted from. This changes NOTHING about row visibility: the
-- base table's row-level policy stays `using (true)` (every row was already
-- visible to anon at the row level — 0023's own design, unaffected here),
-- so definer-mode returns exactly the same ROWS as before, just fewer/
-- coarser COLUMNS. public_hiring_events keeps `security_invoker = on`
-- unchanged — its own SELECT list never touched the now-restricted columns,
-- so it needs no mode change.
--
-- INTERNAL READS MOVE TO THE ADMIN CLIENT. src/lib/hiring-intent/timeline.ts's
-- loadHiringOpportunities/loadAllHiringOpportunities compute day-precision
-- staleness (stale.ts's computeStaleness) and day-precision analytics
-- (analytics.ts's daysToResolution/observedMonths) — they genuinely need
-- exact timestamps, unlike the Evidence Engine's month-only needs. They now
-- read the BASE TABLES directly via the service-role client (which bypasses
-- RLS and column grants entirely), exactly mirroring how
-- recordStaleInferenceIfDue already writes via the admin client in
-- src/app/company/[slug]/page.tsx — reads and writes are now consistently
-- privileged, closing an asymmetry that existed for no reason.
--
-- Run order: after 0028.

-- ---------------------------------------------------------------------------
-- 1. Column-level lockdown — hiring_opportunities.
-- ---------------------------------------------------------------------------
revoke select on hiring_opportunities from anon, authenticated;
grant select (id, organization_id, role_key) on hiring_opportunities to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. Column-level lockdown — hiring_events.
-- ---------------------------------------------------------------------------
--    submission_id is an internal FK into hiring_submissions — the public
--    view never selected it (provenance/audit only, per 0023's own comment),
--    but the base table's blanket policy let it be read directly regardless.
--    created_at is the same exact-timestamp class of leak as
--    hiring_opportunities' columns above.
revoke select on hiring_events from anon, authenticated;
grant select (id, hiring_opportunity_id, actor_type, event_type, payload, reported_month)
  on hiring_events to anon, authenticated;

-- ---------------------------------------------------------------------------
-- 3. Redefine public_hiring_opportunities — coarsened, definer-mode.
-- ---------------------------------------------------------------------------
drop view if exists public_hiring_opportunities;
create view public_hiring_opportunities
as
select
  id,
  organization_id,
  role_key,
  to_char(date_trunc('month', first_observed_at at time zone 'UTC'), 'YYYY-MM') as first_observed_month,
  to_char(date_trunc('month', last_activity_at at time zone 'UTC'), 'YYYY-MM') as last_activity_month
from hiring_opportunities;

grant select on public_hiring_opportunities to anon, authenticated;

-- public_hiring_events is UNCHANGED — its existing definition already never
-- selected submission_id or created_at, so it needs no redefinition; it
-- keeps working under the new column grants exactly as before.

-- Rollback:
--   drop view if exists public_hiring_opportunities;
--   create view public_hiring_opportunities
--   with (security_invoker = on)
--   as select id, organization_id, role_key, first_observed_at,
--     last_activity_at, observation_deadline_at from hiring_opportunities;
--   grant select on public_hiring_opportunities to anon, authenticated;
--   revoke select (id, hiring_opportunity_id, actor_type, event_type, payload, reported_month)
--     on hiring_events from anon, authenticated;
--   grant select on hiring_events to anon, authenticated;
--   revoke select (id, organization_id, role_key) on hiring_opportunities from anon, authenticated;
--   grant select on hiring_opportunities to anon, authenticated;
