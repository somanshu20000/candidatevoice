-- CandidateVoice migration: external report provenance, explainability, and
-- an immutability guarantee.
--
-- WHY THIS EXISTS
-- An external report must not be an opaque blob of extracted fields. To improve
-- extraction over time without re-litigating every stored row, each report
-- carries an EXPLAINABILITY TRAIL — which extractor version produced it, how
-- confident that extraction was, which fields it managed to fill, and what the
-- validator warned about. And because the whole trust model depends on a
-- report's provenance meaning what it says, provenance and content are made
-- IMMUTABLE after import: only moderation state and employer re-resolution may
-- ever change.
--
-- Run order: after 0008.

-- ---------------------------------------------------------------------------
-- 1. Explainability trail
-- ---------------------------------------------------------------------------
--    extraction_version  — the adapter + extractor revision, e.g. "reddit-v1".
--                          Lets us find and re-extract everything a buggy
--                          version produced, without touching good rows.
--    extraction_confidence — the adapter's own 0..1 estimate of how sure it is.
--    fields_extracted    — which structured fields it actually filled (a JSON
--                          array of field names). "founded on evidence, not a
--                          guess" made queryable.
--    validation_warnings — what the core's validator flagged (dropped enum
--                          values, coercions). The audit trail for data quality.
alter table external_reports add column if not exists extraction_version   text;
alter table external_reports add column if not exists extraction_confidence numeric;
alter table external_reports add column if not exists fields_extracted      jsonb not null default '[]'::jsonb;
alter table external_reports add column if not exists validation_warnings   jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'external_reports_extraction_confidence_range') then
    alter table external_reports add constraint external_reports_extraction_confidence_range
      check (extraction_confidence is null or (extraction_confidence >= 0 and extraction_confidence <= 1));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'external_reports_extraction_version_len') then
    alter table external_reports add constraint external_reports_extraction_version_len
      check (extraction_version is null or char_length(extraction_version) <= 60);
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 2. Moderation states — add 'archived'
-- ---------------------------------------------------------------------------
--    pending → approved / rejected, and either can later be archived (removed
--    from view without deleting the audit row). The public read policy still
--    shows ONLY 'approved', so archived rows disappear from the site while
--    remaining for provenance/history.
alter table external_reports drop constraint if exists external_reports_verification_status_check;
alter table external_reports add constraint external_reports_verification_status_check
  check (verification_status in ('pending','approved','rejected','archived'));

-- ---------------------------------------------------------------------------
-- 3. Immutability
-- ---------------------------------------------------------------------------
--    A report's content and provenance are fixed at import. The ONLY columns a
--    later UPDATE may change are its moderation state (verification_status,
--    reviewed_at) and its resolved employer (organization_id — re-resolution as
--    the alias table improves is legitimate and is not provenance). Any attempt
--    to alter an extracted value, a source, a hash, or the explainability trail
--    is rejected at the database, so "immutable" is enforced, not merely
--    promised.
create or replace function external_reports_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.company              is distinct from old.company
     or new.role              is distinct from old.role
     or new.source_id         is distinct from old.source_id
     or new.source_url        is distinct from old.source_url
     or new.external_ref      is distinct from old.external_ref
     or new.content_hash      is distinct from old.content_hash
     or new.experience_bucket is distinct from old.experience_bucket
     or new.stage             is distinct from old.stage
     or new.outcome           is distinct from old.outcome
     or new.response_time_bucket is distinct from old.response_time_bucket
     or new.last_interaction_gap is distinct from old.last_interaction_gap
     or new.reason            is distinct from old.reason
     or new.payment_flag      is distinct from old.payment_flag
     or new.reported_month    is distinct from old.reported_month
     or new.extraction_version    is distinct from old.extraction_version
     or new.extraction_confidence is distinct from old.extraction_confidence
     or new.fields_extracted  is distinct from old.fields_extracted
     or new.validation_warnings is distinct from old.validation_warnings
     or new.ingested_at       is distinct from old.ingested_at
  then
    raise exception 'external_reports rows are immutable except verification_status, reviewed_at and organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists external_reports_immutable on external_reports;
create trigger external_reports_immutable
  before update on external_reports
  for each row execute function external_reports_guard_immutable();

-- ---------------------------------------------------------------------------
-- 4. Extend the public view with the explainability the UI can safely show
-- ---------------------------------------------------------------------------
--    extraction_confidence and the source trust_weight let the UI render "how
--    much this counts" honestly. The raw validation_warnings / fields_extracted
--    stay internal (moderation tooling), not in the public surface.
drop view if exists public_external_reports;
create view public_external_reports
with (security_invoker = on)
as
select
  r.id, r.organization_id, r.company, r.role,
  s.key as source_key, s.display_name as source_name, s.trust_weight,
  r.source_url, r.experience_bucket, r.stage, r.outcome,
  r.response_time_bucket, r.last_interaction_gap, r.reason, r.payment_flag,
  r.reported_month, r.extraction_confidence
from external_reports r
join external_sources s on s.id = r.source_id
where r.verification_status = 'approved' and s.enabled = true;

grant select on public_external_reports to anon, authenticated;

-- Rollback:
--   drop trigger if exists external_reports_immutable on external_reports;
--   drop function if exists external_reports_guard_immutable();
--   alter table external_reports drop column if exists validation_warnings;
--   alter table external_reports drop column if exists fields_extracted;
--   alter table external_reports drop column if exists extraction_confidence;
--   alter table external_reports drop column if exists extraction_version;
--   (restore the 3-state verification_status check)
