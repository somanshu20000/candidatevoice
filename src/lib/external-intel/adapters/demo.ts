/**
 * Demo adapter — exercises the FULL pipeline (discovery -> eligibility ->
 * acquire -> extract -> validate -> dedupe -> moderation queue) without any
 * credential, network dependency, or external ToS surface. Needed because a
 * real source can be credential-gated (Reddit, today) or ToS-gated (Q-2), and
 * the surrounding pipeline must be provably correct independent of either.
 *
 * SAFETY, mirroring scripts/demo-seed.ts's already-established convention
 * (D-013 — "demo data stays local-only, never mistaken for real
 * acquisition"): every `source_url` points at example.com (IANA's reserved
 * documentation domain), `extraction_version` is tagged 'demo-v1', and the
 * `external_sources` row this adapter is registered under
 * (migration 0031, key='demo') ships permanently `enabled=false` — a demo
 * record can NEVER reach public_external_reports regardless of moderation
 * status, structurally, the same guarantee migration 0030's QA source has.
 *
 * Deterministic, not random (Math.random()/Date.now() aren't just
 * discouraged here, they'd make the record non-reproducible) — the same
 * companyName always produces the same content_hash, so a second run is
 * provably a duplicate rather than a new row, proving the pipeline's
 * dedupe on a controllable input.
 */

import type { AcquisitionAdapter, RawExternalReport } from "../../hiring-intel/types";

export interface DemoAdapterInput {
  companyName: string;
  /** Deterministic seed for which canned outcome to emit — lets a test or a
   *  live-verification run exercise more than one fixed shape on demand. */
  variant?: "rejected" | "offer" | "no_response";
}

const VARIANTS: Record<NonNullable<DemoAdapterInput["variant"]>, Partial<RawExternalReport>> = {
  rejected: { stage: "technical", outcome: "rejected", response_time_bucket: "8-14" },
  offer: { stage: "final", outcome: "offer", response_time_bucket: "4-7" },
  no_response: { stage: "screening", outcome: "no_response" },
};

export const demoAdapter: AcquisitionAdapter = {
  key: "demo",
  displayName: "Local Demo Source",
  async load(input: unknown): Promise<RawExternalReport[]> {
    const { companyName, variant = "rejected" } = (input ?? {}) as DemoAdapterInput;
    if (!companyName || !companyName.trim()) return [];

    const slugSafe = companyName.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-");
    const shape = VARIANTS[variant];

    const record: RawExternalReport = {
      company: companyName.trim(),
      source_url: `https://example.com/demo-source/${slugSafe}/${variant}`,
      external_ref: `demo-${slugSafe}-${variant}`,
      role: "Software Engineer",
      reported_month: "2026-06",
      extraction_version: "demo-v1",
      extraction_confidence: 1.0,
      ...shape,
    };
    return [record];
  },
};
