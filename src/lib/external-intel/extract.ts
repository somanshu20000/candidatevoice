/**
 * Case 1 — step 2: turn a permitted, already-discovered source into
 * RawExternalReport[] (hiring-intel/types.ts's existing contract), so the
 * output feeds the EXISTING normalize→validate→moderate pipeline
 * (hiring-intel/importer.ts) unchanged — this module produces the contract,
 * it never persists anything itself.
 *
 * HONEST ABOUT WHAT IT CAN DO TODAY: PixelRAG's hosted API has no render
 * endpoint (pixelrag.ts's own comment), so pixelragRender() is a stub unless
 * PIXELRAG_RENDER_URL points at a self-hosted instance. Structured extraction
 * from rendered text into RawExternalReport fields is a real, non-trivial
 * step this codebase has never had a labelled example to build against — so
 * rather than guess at a parser nothing can verify, this returns an empty
 * array with a clear reason whenever rendering did not produce anything to
 * extract from. That is a documented gap, not a silent failure: the reason is
 * always surfaced to the caller (seed-pipeline.ts) and never swallowed.
 */

import type { DiscoveredSource } from "./web-discovery";
import type { RawExternalReport } from "../hiring-intel/types";
import { pixelragRender, isPixelragRenderConfigured } from "./pixelrag";

export interface ExtractionResult {
  reports: RawExternalReport[];
  reason: string | null;
}

export async function extractReportsFromSource(
  source: DiscoveredSource,
  companyName: string
): Promise<ExtractionResult> {
  if (!isPixelragRenderConfigured()) {
    return {
      reports: [],
      reason:
        `PIXELRAG_RENDER_URL is not set — rendering "${source.key}" content requires a ` +
        "self-hosted PixelRAG instance (the hosted API has no render endpoint). Set " +
        "PIXELRAG_RENDER_URL once one is deployed.",
    };
  }

  // A source-specific URL to render still needs to come from that source's
  // OWN permitted discovery mechanism (e.g. Reddit's own search API) — this
  // module never guesses a URL. Until that per-source discovery step exists
  // for a source that is actually acquisition_enabled, there is nothing to
  // hand pixelragRender().
  void companyName;
  void pixelragRender;
  return {
    reports: [],
    reason:
      `no per-source URL-discovery mechanism is implemented for "${source.key}" yet — ` +
      "web-discovery.ts finds a PERMITTED source, but resolving a specific page to render " +
      "for a given company still needs that source's own search/listing API. Implement one " +
      "when acquisition_enabled is actually true for this source.",
  };
}
