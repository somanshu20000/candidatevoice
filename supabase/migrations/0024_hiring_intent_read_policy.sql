-- CandidateVoice migration: fix — hiring_opportunities/hiring_events had no
-- public SELECT policy
--
-- WHY THIS EXISTS
-- 0023 enabled RLS on hiring_opportunities and hiring_events but never added
-- a SELECT policy for anon/authenticated (unlike hiring_submissions, which
-- has an explicit is_approved-scoped read policy). RLS enabled + zero
-- policies means DENY-ALL for every role except the table owner/service-role.
-- Because public_hiring_opportunities/public_hiring_events are declared
-- `security_invoker = on`, they run as the INVOKING role — so anon querying
-- through the view inherited that deny-all and silently returned zero rows,
-- with no error. Caught live: a company page load never recorded a due
-- system_stale_inference event because the read path itself returned nothing.
--
-- Read is intentionally UNRESTRICTED (no is_approved-style gate): unlike
-- hiring_submissions, hiring_events carries no free text and no unmoderated
-- content — every row is a closed-enum, server-constructed event (see
-- src/lib/hiring-intent/events.ts). There is nothing here that needs
-- moderation before becoming public. Write access is UNCHANGED: still no
-- anon/authenticated INSERT/UPDATE/DELETE policy on either table — only the
-- service-role client (which bypasses RLS entirely) can write, exactly as
-- 0023 intended.
--
-- Run order: after 0023.

create policy hiring_opportunities_public_read on hiring_opportunities
  for select to anon, authenticated using (true);

create policy hiring_events_public_read on hiring_events
  for select to anon, authenticated using (true);

-- Rollback:
--   drop policy if exists hiring_events_public_read on hiring_events;
--   drop policy if exists hiring_opportunities_public_read on hiring_opportunities;
