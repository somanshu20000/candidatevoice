-- CandidateVoice migration: register the 'demo' external source
--
-- WHY THIS EXISTS
-- src/lib/external-intel/adapters/demo.ts needs an external_sources row to
-- attribute records to, same as every other source. Distinct in PURPOSE from
-- migration 0030's qa_external_verification (that one exists specifically
-- for scripts/qa-verify-external-pipeline.ts's isolated health-check cycle
-- against the QA organization): this one is the general "exercise the
-- acquisition pipeline against ANY company, with no credential, no network
-- call, no ToS surface" source requirement calls for.
--
-- enabled = false PERMANENTLY, identical safety property to 0030 — a demo
-- record can never reach public_external_reports regardless of moderation
-- status, structurally, by the same `s.enabled = true` clause every source's
-- publication already goes through.
--
-- Run order: after 0031.

insert into external_sources (
  key, display_name, kind, homepage_url, terms_url, license,
  attribution_required, enabled, acquisition_enabled, trust_weight, notes
)
values (
  'demo',
  'Local Demo Source (never public)',
  'curated',
  null,
  null,
  'internal-demo-fixture',
  false,
  false,  -- permanently unpublishable — see comment above
  true,
  0.01,
  'Deterministic, credential-free local source (src/lib/external-intel/adapters/demo.ts) for exercising the acquisition pipeline end-to-end without production credentials or a network dependency. enabled=false permanently. Every source_url points at example.com (D-013 convention).'
)
on conflict (key) do nothing;

-- Rollback:
--   delete from external_sources where key = 'demo';
