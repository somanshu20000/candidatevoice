-- CandidateVoice migration: provision the company-logos Storage bucket
--
-- WHY THIS EXISTS
-- migration 0005 created the company_logos TABLE and
-- src/app/api/logo/[slug]/route.ts has read from a Storage bucket named
-- "company-logos" since it was written — but no migration ever created the
-- bucket itself. Every write attempt (src/lib/company-intelligence/logo.ts,
-- added alongside this migration) failed with "Bucket not found", confirmed
-- live before writing this file. This is the missing provisioning step, not
-- a new capability — the table, the CHECK constraints, and the read route
-- were all already designed around this bucket existing.
--
-- PRIVATE, not public. The only reader is /api/logo/[slug], which always uses
-- the service-role client (createAdminClient()) to proxy bytes same-origin —
-- see that route's own "WHY A ROUTE AND NOT A DIRECT URL" comment. A public
-- bucket would add a second, unproxied way to reach the same files for no
-- benefit, and would defeat the CSP-driven reason the route exists at all.
--
-- file_size_limit and allowed_mime_types mirror company_logos' own
-- company_logos_byte_size CHECK (1..2097152) and mime_type CHECK
-- ('image/png','image/svg+xml','image/webp','image/jpeg') — defense in depth
-- at the Storage layer, not just the table layer.
--
-- Run order: after 0015.

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'company-logos',
  'company-logos',
  false,
  2097152,
  array['image/png', 'image/svg+xml', 'image/webp', 'image/jpeg']
)
on conflict (id) do nothing;

-- Rollback:
--   delete from storage.buckets where id = 'company-logos';
--   (only safe once company_logos.storage_path is null for every row, or the
--   objects it references become orphaned)
