-- CandidateVoice migration: QA-only external source for pipeline verification
--
-- WHY THIS EXISTS
-- M6's external-reports pipeline (migration 0008) has never been exercised
-- end-to-end against production with a real write -> approve -> weight ->
-- reject cycle, because doing that with the 'reddit' source would mix test
-- rows into the same source real acquisition data will eventually use. This
-- migration adds a SEPARATE, permanently-unpublishable source dedicated to
-- that verification, mirroring the existing QA organization pattern
-- (m54-qa-verification-test, D-024) on the source-registry side.
--
-- enabled = false PERMANENTLY. Unlike 'reddit' (disabled only until reviewed),
-- this source is never meant to be enabled — public_external_reports' own
-- WHERE clause (`s.enabled = true`) means a row attributed to this source can
-- NEVER appear on any public surface, regardless of verification_status. That
-- is what makes it safe to approve/reject rows against in production: there is
-- no code path from here to anything a visitor sees.
--
-- acquisition_enabled = true so the existing importer (runExternalImport)
-- accepts writes attributed to it without any special-casing — the whole
-- point is to exercise the REAL pipeline, not a parallel one.
--
-- Run order: after 0029.

insert into external_sources (
  key, display_name, kind, homepage_url, terms_url, license,
  attribution_required, enabled, acquisition_enabled, trust_weight, notes
)
values (
  'qa_external_verification',
  '(QA TEST — external pipeline verification, safe to ignore)',
  'curated',
  null,
  null,
  'internal-qa-fixture',
  false,
  false,  -- permanently unpublishable — see comment above
  true,
  0.01,
  'Internal QA-only source for verifying the external-report pipeline end-to-end (import -> moderate -> weight -> reject/cleanup) without touching real acquisition data. enabled=false permanently. Fixtures attributed to this source target the existing QA organization (m54-qa-verification-test, id b77ee3bd-f7f7-4e59-b67d-3eacf08c1597) so no new organization is created. See scripts/qa-verify-external-pipeline.ts.'
)
on conflict (key) do nothing;

-- Rollback:
--   delete from external_sources where key = 'qa_external_verification';
