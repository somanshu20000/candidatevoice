-- CandidateVoice migration: let tenure reports omit interview-only fields
--
-- WHY THIS EXISTS
-- 0019 opened the door to employee / former_employee reports. But four columns
-- were NOT NULL from the baseline, when the platform only ever heard from
-- candidates: stage, outcome, response_time_bucket, last_interaction_gap. Those
-- describe an INTERVIEW. A current employee or a leaver has no honest value for
-- "what stage did you reach" — forcing one would fabricate interview evidence.
--
-- THE FIX IS TO ALLOW NULL, AND THE ENGINE ALREADY DOES THE REST. Every
-- behavioural interview metric is eligibility-gated on `field !== null`
-- (see src/lib/fingerprint/behavioural.ts). So a tenure report with these
-- columns null simply does not contribute to ghosting / offer / response-speed /
-- process-depth — exactly correct, with no engine change. Candidate reports are
-- still required to provide them, enforced at the form + route layer (the DB
-- NOT NULL was only ever a backstop for the single-reporter world).
--
-- payment_flag is deliberately NOT touched here: it stays NOT NULL DEFAULT false.
-- Because it can't be null, payment_risk would otherwise count employee rows as
-- "no payment requested" and dilute the interview metric — so payment_risk's
-- eligibility gains an explicit reporter_type = 'candidate' guard in the engine
-- instead. experience_bucket / company / role also stay required: they apply to
-- every reporter, not just candidates.
--
-- Run order: after 0019.

alter table hiring_submissions alter column stage drop not null;
alter table hiring_submissions alter column outcome drop not null;
alter table hiring_submissions alter column response_time_bucket drop not null;
alter table hiring_submissions alter column last_interaction_gap drop not null;

-- Rollback (only safe once no tenure rows with null interview fields exist):
--   alter table hiring_submissions alter column stage set not null;
--   alter table hiring_submissions alter column outcome set not null;
--   alter table hiring_submissions alter column response_time_bucket set not null;
--   alter table hiring_submissions alter column last_interaction_gap set not null;
