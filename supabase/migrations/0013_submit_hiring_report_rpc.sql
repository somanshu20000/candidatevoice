-- CandidateVoice migration: submit_hiring_report RPC (atomic write path)
--
-- WHY THIS EXISTS
-- The submit route inserts into hiring_submissions today; Family B
-- (submission_ratings, submission_emotions) has no write path at all —
-- the blueprint calls it out as Blocker B1: "a fully-tested 530-line engine
-- sits over two permanently empty tables." This RPC gives the API one call
-- that lands the submission and its ratings/emotions in ONE transaction.
--
-- If the ratings insert fails, the submission does NOT persist. That is the
-- whole point: a submission that half-succeeded (row in, ratings not) would
-- silently teach the Fingerprint that this candidate had no rating for the
-- facets they picked, which is not the same thing as "the write failed."
--
-- SHAPE
-- Takes three JSONB blobs to keep the signature stable as the submission
-- shape evolves — every enum/CHECK constraint in hiring_submissions still
-- fires because the INSERT is against the base table. p_ratings and
-- p_emotions default to empty arrays so the caller pays nothing for opting
-- out (which the current UI does; the emotion/rating pickers ship later).
--
-- Returns the new submission id so the API can log/audit/echo without a
-- second round trip.
--
-- SECURITY
-- Security invoker (default). Called by the API through the service-role
-- client, which already bypasses RLS. Not exposed to anon: if a future UI
-- surface needs it, we grant explicitly then, and only then.
--
-- Idempotent to define: `create or replace`. Idempotent to invoke: no.
-- Two calls insert two submissions, exactly like the raw INSERT it replaces.

create or replace function submit_hiring_report(
  p_submission jsonb,
  p_ratings jsonb default '[]'::jsonb,
  p_emotions jsonb default '[]'::jsonb
) returns uuid
language plpgsql
as $$
declare
  v_submission_id uuid;
begin
  -- The submission itself. Every enum column comes through as text and is
  -- checked by the base table's own CHECK constraints — no duplicated
  -- validation here. organization_id is the M0 resolution result and may
  -- legitimately be NULL (fail-open, per api/submit/route.ts).
  insert into hiring_submissions (
    company, role, organization_id, experience_bucket, stage, outcome,
    response_time_bucket, last_interaction_gap, call_duration,
    first_interaction_outcome, reason, payment_flag, is_approved, reporter_type
  ) values (
    p_submission->>'company',
    p_submission->>'role',
    nullif(p_submission->>'organization_id', '')::uuid,
    p_submission->>'experience_bucket',
    p_submission->>'stage',
    p_submission->>'outcome',
    p_submission->>'response_time_bucket',
    p_submission->>'last_interaction_gap',
    p_submission->>'call_duration',
    p_submission->>'first_interaction_outcome',
    p_submission->>'reason',
    coalesce((p_submission->>'payment_flag')::boolean, false),
    coalesce((p_submission->>'is_approved')::boolean, false),
    coalesce(p_submission->>'reporter_type', 'candidate')
  )
  returning id into v_submission_id;

  -- Ratings. facet_key FKs into fingerprint_facets; rating is bounded 1..5
  -- by the submission_ratings CHECK constraint. Either insert both cleanly
  -- or the entire transaction rolls back — atomicity is the whole point.
  if jsonb_array_length(p_ratings) > 0 then
    insert into submission_ratings (submission_id, facet_key, rating)
    select v_submission_id, (elem->>'facet_key'), (elem->>'rating')::smallint
    from jsonb_array_elements(p_ratings) as elem;
  end if;

  -- Emotions. Duplicates within a submission are prevented by the composite
  -- PK — a repeated emotion_key errors, so the caller must de-dupe up front
  -- (a legitimate UX signal that the picker misbehaved, not something to
  -- silently swallow).
  if jsonb_array_length(p_emotions) > 0 then
    insert into submission_emotions (submission_id, emotion_key)
    select v_submission_id, (elem->>'emotion_key')
    from jsonb_array_elements(p_emotions) as elem;
  end if;

  return v_submission_id;
end;
$$;

-- No explicit grants: service_role inherits execute on functions by default,
-- and that is the only caller today. Adding a grant to anon would open a
-- write path we haven't scoped.

-- Rollback:
--   drop function if exists submit_hiring_report(jsonb, jsonb, jsonb);
