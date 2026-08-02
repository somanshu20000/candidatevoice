-- CandidateVoice migration: two candidate-knowable process-clarity facets
--
-- WHY THIS EXISTS
-- "Family B" as first imagined (salary satisfaction, WLB, growth, burnout…) is
-- mostly UNBUILDABLE from candidate evidence: a candidate who interviewed —
-- and may never have been hired — has no first-hand basis to report life AT the
-- company. Only an employee does, and employee-sourced evidence is deliberately
-- out of scope (docs/adr-0001; taxonomy.ts's own comment cites the sharper
-- re-identification and defamation profile). See the `leadership`/`work_culture`
-- dimensions, which exist but are marked sourceType 'employee' and awaiting_source.
--
-- These two facets are the narrow, honest exception: things a candidate GENUINELY
-- LEARNS DURING INTERVIEWING, so they are first-hand candidate evidence, not
-- employee hearsay:
--   - whether the pay range was disclosed during the process
--   - whether the work arrangement (remote/hybrid/onsite) was made clear
--
-- They belong to the existing `hiring_process` dimension (candidate-sourced,
-- likert) and flow through the EXISTING write path unchanged: facet_key FKs into
-- fingerprint_facets, the submit RPC and route validate against FACET_KEYS from
-- taxonomy.ts. No new reporter_type, no schema change beyond two seed rows.
--
-- taxonomy.ts is the TypeScript mirror and MUST match (tests/fingerprint-taxonomy
-- .test.ts parses this migration and asserts parity); it is updated in the same
-- change. Idempotent: `on conflict (key) do update`, safe to re-run.
--
-- Run order: after 0016.

insert into fingerprint_facets (key, dimension_key, label, prompt, anchor_low, anchor_high, display_order) values
  ('compensation_clarity',    'hiring_process', 'Pay transparency',     'Was the pay range disclosed during the process?',                  'Never disclosed or evasive',   'Disclosed early and clearly', 5),
  ('work_arrangement_clarity','hiring_process', 'Work arrangement',     'Was the work arrangement (remote, hybrid or onsite) made clear?',   'Vague or kept changing',       'Clear from the start',        6)
on conflict (key) do update set
  dimension_key = excluded.dimension_key,
  label = excluded.label,
  prompt = excluded.prompt,
  anchor_low = excluded.anchor_low,
  anchor_high = excluded.anchor_high,
  display_order = excluded.display_order;

-- Rollback:
--   delete from fingerprint_facets where key in ('compensation_clarity', 'work_arrangement_clarity');
--   (submission_ratings rows referencing them, if any, must be removed first — FK on delete restrict.)
