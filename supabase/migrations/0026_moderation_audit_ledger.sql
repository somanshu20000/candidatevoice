-- CandidateVoice migration: moderation audit ledger (M4.2)
--
-- WHY THIS EXISTS
-- Migration 0001 is misleadingly named "rate_limit_and_moderation_audit" but
-- only ever added rejected_at — there has never been an actual ledger of who
-- moderated what, when, and what state it moved between. This is that
-- ledger, for hiring_submissions specifically (the M4 scope; external_reports
-- already carries its own verification_status/reviewed_at and is out of
-- scope here).
--
-- WHY A TRIGGER, NOT APPLICATION CODE
-- If logging were left to the approve/reject routes remembering to insert a
-- row, a future route (or a bug in an existing one) could silently skip it.
-- Recording the transition as a side effect of the UPDATE itself — reusing
-- the same "the database enforces it, not application discipline" principle
-- 0025's immutability triggers already apply — makes "every moderation
-- action produces an audit event" a structural guarantee, not a convention.
--
-- WHO. This app has no per-admin identity — a single shared ADMIN_SECRET
-- gates every moderation action (src/app/api/admin/_utils.ts), a fact
-- migration 0023 already documented for hiring_events' actor_type. `actor`
-- is therefore recorded as the literal string 'admin', not a fabricated
-- per-user identity the system does not have. `reason` is nullable: no admin
-- UI currently collects one (out of scope here — a UI change, not a
-- database-transparency one); the column exists so a future reason-capture
-- UI needs no migration.
--
-- Run order: after 0025 (reads hiring_submissions' shape, not required, but
-- keeps the two halves of M4 together).

-- ---------------------------------------------------------------------------
-- 1. The ledger table.
-- ---------------------------------------------------------------------------
create table if not exists moderation_audit_log (
  id             uuid primary key default gen_random_uuid(),
  submission_id  uuid not null references hiring_submissions(id),
  action         text not null check (action in ('approve', 'reject', 'reset_to_pending')),
  previous_state text not null check (previous_state in ('pending', 'approved', 'rejected')),
  new_state      text not null check (new_state in ('pending', 'approved', 'rejected')),
  actor          text not null default 'admin',
  reason         text,
  created_at     timestamptz not null default now()
);

create index if not exists moderation_audit_log_submission_idx
  on moderation_audit_log (submission_id, created_at desc);

-- Service-role only — no anon/authenticated policy, matching
-- rate_limit_counters' own reasoning (migration 0001): this is moderation
-- tooling — who/when/why a row was moderated — never a public surface. The
-- Evidence Inspector (M4.3, src/lib/evidence/inspector.ts) explains a
-- claim's evidence strength from EvidenceBase, which already excludes this
-- table entirely; it never queries moderation_audit_log.
alter table moderation_audit_log enable row level security;

-- ---------------------------------------------------------------------------
-- 2. Auto-log trigger — fires only when a moderation-relevant column
--    (is_approved / rejected_at) actually changes, so an organization_id
--    re-resolution (0025's third mutable column) never produces a spurious
--    ledger row: re-resolving the employer is not a moderation decision.
-- ---------------------------------------------------------------------------
create or replace function hiring_submissions_state(p_is_approved boolean, p_rejected_at timestamptz)
returns text
language sql
immutable
as $$
  select case
    when p_rejected_at is not null then 'rejected'
    when p_is_approved then 'approved'
    else 'pending'
  end;
$$;

create or replace function hiring_submissions_log_moderation()
returns trigger
language plpgsql
as $$
declare
  v_previous text;
  v_new      text;
  v_action   text;
begin
  if new.is_approved is distinct from old.is_approved
     or new.rejected_at is distinct from old.rejected_at
  then
    v_previous := hiring_submissions_state(old.is_approved, old.rejected_at);
    v_new      := hiring_submissions_state(new.is_approved, new.rejected_at);
    v_action   := case
      when v_new = 'approved' then 'approve'
      when v_new = 'rejected' then 'reject'
      else 'reset_to_pending'
    end;
    insert into moderation_audit_log (submission_id, action, previous_state, new_state, actor)
    values (new.id, v_action, v_previous, v_new, 'admin');
  end if;
  return new;
end;
$$;

-- AFTER UPDATE: fires only once 0025's immutability trigger has already let
-- the update through, so a rejected (blocked) write to a locked column never
-- produces a ledger row — only a write that actually happened is logged.
drop trigger if exists hiring_submissions_log_moderation on hiring_submissions;
create trigger hiring_submissions_log_moderation
  after update on hiring_submissions
  for each row execute function hiring_submissions_log_moderation();

-- ---------------------------------------------------------------------------
-- 3. Ledger immutability — the audit trail cannot itself be edited or
--    erased. Reuses hiring_events_guard_immutable's exact shape (0023): one
--    function, unconditional raise, wired to both BEFORE UPDATE and
--    BEFORE DELETE.
-- ---------------------------------------------------------------------------
create or replace function moderation_audit_log_guard_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'moderation_audit_log rows are immutable and append-only';
  return old; -- unreachable; satisfies the plpgsql return requirement
end;
$$;

drop trigger if exists moderation_audit_log_no_update on moderation_audit_log;
create trigger moderation_audit_log_no_update
  before update on moderation_audit_log
  for each row execute function moderation_audit_log_guard_immutable();

drop trigger if exists moderation_audit_log_no_delete on moderation_audit_log;
create trigger moderation_audit_log_no_delete
  before delete on moderation_audit_log
  for each row execute function moderation_audit_log_guard_immutable();

-- Rollback:
--   drop trigger if exists moderation_audit_log_no_delete on moderation_audit_log;
--   drop trigger if exists moderation_audit_log_no_update on moderation_audit_log;
--   drop function if exists moderation_audit_log_guard_immutable();
--   drop trigger if exists hiring_submissions_log_moderation on hiring_submissions;
--   drop function if exists hiring_submissions_log_moderation();
--   drop function if exists hiring_submissions_state(boolean, timestamptz);
--   drop table if exists moderation_audit_log;
