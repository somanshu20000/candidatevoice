-- CandidateVoice migration: indexes for the moderation duplicate/related lookup
--
-- WHY THIS EXISTS
-- The moderation queue (src/lib/hiring-intel/moderation.ts) shows a moderator
-- "duplicate matches (if any)" for each pending report: other rows sharing the
-- same content_hash (a likely duplicate, possibly from a different source), and
-- other rows for the same organization_id (related context). Neither existing
-- index serves that access pattern:
--   * (source_id, content_hash) is a composite UNIQUE — usable only when
--     source_id is also known, but duplicate-hunting must span ALL sources.
--   * external_reports_org_idx (migration 0008) is PARTIAL, WHERE
--     verification_status = 'approved' — it exists for the public read path
--     and does not cover pending/rejected/archived rows, which is exactly what
--     the moderation view needs to see.
-- Purely additive; safe on the current empty table and on a populated one.
--
-- Run order: after 0009.

create index if not exists external_reports_content_hash_idx
  on external_reports (content_hash);

create index if not exists external_reports_org_all_idx
  on external_reports (organization_id)
  where organization_id is not null;

-- Rollback:
--   drop index if exists external_reports_org_all_idx;
--   drop index if exists external_reports_content_hash_idx;
