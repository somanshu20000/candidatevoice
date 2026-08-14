-- CandidateVoice migration: hiring_submissions immutability (M4.1)
--
-- WHY THIS EXISTS
-- external_reports has been immutable since migration 0009
-- (external_reports_guard_immutable): content and provenance are locked at
-- import, only verification_status/reviewed_at/organization_id may change.
-- hiring_submissions — the FIRST-PARTY half of the same trust model — has
-- never had the equivalent guarantee. Nothing today stops a bug, a bad
-- migration, or direct table access from silently rewriting an approved
-- candidate's reported facts after the fact. This closes that parity gap by
-- reusing the exact same two proven patterns already shipped in this
-- codebase (migrations 0009 and 0023), not inventing a third.
--
-- WHAT CAN STILL CHANGE
-- Same three columns external_reports allows, by the same reasoning:
--   is_approved, rejected_at — moderation state. Legitimate; see M4.2, which
--     turns every such transition into an audit-ledger row.
--   organization_id          — re-resolution as the alias table (M3.2)
--     improves. Not a provenance change — the row still says what the
--     candidate reported, just resolved to a more correct employer.
-- Every other column — company, role, stage, outcome, experience_bucket,
-- response_time_bucket, last_interaction_gap, call_duration,
-- first_interaction_outcome, reason, payment_flag, created_at,
-- reporter_type, application_channel, the salary/exit/tenure/conduct
-- columns — is locked the instant the row is inserted.
--
-- DELETE is blocked outright, with no exception, mirroring
-- hiring_events_guard_immutable (migration 0023) exactly. The existing
-- reject workflow already never deletes on the happy path (it soft-deletes
-- via rejected_at — migration 0001); the one remaining hard-delete
-- fallback in src/app/api/admin/reject/route.ts only fires if that update
-- itself fails, and after this migration it will correctly fail loudly
-- (a caught error, "Unable to reject submission") instead of silently
-- succeeding. No administrator bypass is added — there is no superuser
-- escape hatch here, exactly as external_reports and hiring_events have none.
--
-- Run order: after 0024.

-- ---------------------------------------------------------------------------
-- 1. UPDATE guard — locks every column except the three moderation/
--    re-resolution fields. Structurally identical to
--    external_reports_guard_immutable (0009); the column list is this
--    table's own.
-- ---------------------------------------------------------------------------
create or replace function hiring_submissions_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  if new.company                    is distinct from old.company
     or new.role                    is distinct from old.role
     or new.experience_bucket       is distinct from old.experience_bucket
     or new.stage                   is distinct from old.stage
     or new.outcome                 is distinct from old.outcome
     or new.response_time_bucket    is distinct from old.response_time_bucket
     or new.last_interaction_gap    is distinct from old.last_interaction_gap
     or new.call_duration           is distinct from old.call_duration
     or new.first_interaction_outcome is distinct from old.first_interaction_outcome
     or new.reason                  is distinct from old.reason
     or new.payment_flag            is distinct from old.payment_flag
     or new.created_at              is distinct from old.created_at
     or new.reporter_type           is distinct from old.reporter_type
     or new.application_channel     is distinct from old.application_channel
     or new.salary_history_stage    is distinct from old.salary_history_stage
     or new.salary_proof_type       is distinct from old.salary_proof_type
     or new.salary_proof_stage      is distinct from old.salary_proof_stage
     or new.salary_range_disclosed  is distinct from old.salary_range_disclosed
     or new.exit_experience_letter  is distinct from old.exit_experience_letter
     or new.exit_settlement         is distinct from old.exit_settlement
     or new.exit_documentation      is distinct from old.exit_documentation
     or new.would_recommend         is distinct from old.would_recommend
     or new.tenure_bucket           is distinct from old.tenure_bucket
     or new.conduct_environment     is distinct from old.conduct_environment
  then
    raise exception 'hiring_submissions rows are immutable except is_approved, rejected_at and organization_id';
  end if;
  return new;
end;
$$;

drop trigger if exists hiring_submissions_immutable on hiring_submissions;
create trigger hiring_submissions_immutable
  before update on hiring_submissions
  for each row execute function hiring_submissions_guard_immutable();

-- ---------------------------------------------------------------------------
-- 2. DELETE guard — total block, no exception. Reuses hiring_events'
--    "raise unconditionally" shape (migration 0023); a submission is
--    withdrawn from public view via rejected_at (already true today), never
--    removed from the table.
-- ---------------------------------------------------------------------------
create or replace function hiring_submissions_guard_no_delete()
returns trigger
language plpgsql
as $$
begin
  raise exception 'hiring_submissions rows cannot be deleted — reject via rejected_at instead';
  return old; -- unreachable; satisfies the plpgsql return requirement
end;
$$;

drop trigger if exists hiring_submissions_no_delete on hiring_submissions;
create trigger hiring_submissions_no_delete
  before delete on hiring_submissions
  for each row execute function hiring_submissions_guard_no_delete();

-- Rollback:
--   drop trigger if exists hiring_submissions_no_delete on hiring_submissions;
--   drop function if exists hiring_submissions_guard_no_delete();
--   drop trigger if exists hiring_submissions_immutable on hiring_submissions;
--   drop function if exists hiring_submissions_guard_immutable();
