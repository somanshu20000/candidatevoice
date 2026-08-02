/**
 * Logo persistence — the missing half of company_logos (migration 0005). The
 * schema, the Storage bucket, and the READ side (src/app/api/logo/[slug])
 * have existed since Company Intelligence shipped; nothing has ever written a
 * row. `normalize.ts` already discovers a `logoUrl` (from Wikidata's P154 via
 * a Commons file URL) on every record that has one — this is purely the
 * download → hash → store step that turns that discovery into a served image.
 *
 * Goes through CompanyStore, never Supabase directly (store.ts:1-12's own
 * rule) — this module only calls resilientFetch (network) and the two new
 * store methods (persistence).
 */

import { createHash } from "crypto";
import { resilientFetch } from "./http";
import type { CompanyStore } from "./store";

/** Matches company_logos_byte_size's CHECK (1..2097152) in migration 0005. */
export const MAX_LOGO_BYTES = 2_097_152;

export type LogoMimeType = "image/png" | "image/svg+xml" | "image/webp" | "image/jpeg";

const MIME_BY_CONTENT_TYPE: Record<string, LogoMimeType> = {
  "image/png": "image/png",
  "image/svg+xml": "image/svg+xml",
  "image/webp": "image/webp",
  "image/jpeg": "image/jpeg",
  "image/jpg": "image/jpeg",
};

/**
 * Map an HTTP Content-Type header value to one of the four stored mime types,
 * or null when it isn't one of them. Strips a charset/parameter suffix and
 * normalizes case first, so `"image/svg+xml; charset=utf-8"` still matches.
 * Pure — exported so the mapping (and its rejection of anything unexpected)
 * is directly testable without a network call.
 */
export function mimeTypeForContentType(contentType: string): LogoMimeType | null {
  const bare = contentType.split(";")[0].trim().toLowerCase();
  return MIME_BY_CONTENT_TYPE[bare] ?? null;
}

export function extensionFor(mimeType: LogoMimeType): string {
  switch (mimeType) {
    case "image/png": return "png";
    case "image/svg+xml": return "svg";
    case "image/webp": return "webp";
    case "image/jpeg": return "jpg";
  }
}

/**
 * Download `sourceUrl`, verify it, and persist it as the organization's
 * current logo — unless nothing has actually changed, in which case this is a
 * no-op that costs one row read and zero network requests.
 *
 * Never throws. A logo is decorative (the route already falls back to a
 * generated monogram); a failure here must never fail the rest of an import
 * that successfully resolved everything else. Every rejection path (wrong
 * type, too large, fetch failure) is a silent skip, exactly like an adapter's
 * own per-record error handling elsewhere in this pipeline.
 */
export async function fetchAndPersistLogo(
  store: CompanyStore,
  organizationId: string,
  sourceUrl: string,
  sourceId: string
): Promise<void> {
  try {
    const current = await store.getCurrentLogo(organizationId);
    // The common case on every re-import: the discovered URL hasn't moved
    // since the last successful fetch, so there is nothing to do.
    if (current?.sourceUrl === sourceUrl && current.contentHash) return;

    const res = await resilientFetch(sourceUrl, { bucket: "web", guardSsrf: true });
    if (!res.ok) return;

    const mimeType = mimeTypeForContentType(res.headers.get("content-type") ?? "");
    if (!mimeType) return; // an unrecognized type is never stored, not coerced to a guess

    const buffer = Buffer.from(await res.arrayBuffer());
    if (buffer.byteLength === 0 || buffer.byteLength > MAX_LOGO_BYTES) return;

    const contentHash = createHash("sha256").update(buffer).digest("hex");
    // Same bytes reachable via a different URL (e.g. a Commons redirect
    // changed) — no new version needed, just not worth a second upload.
    if (current?.contentHash === contentHash) return;

    const storagePath = `${organizationId}/${contentHash}.${extensionFor(mimeType)}`;
    await store.uploadLogoBytes(storagePath, buffer, mimeType);
    await store.upsertLogoRecord({
      organizationId,
      storagePath,
      contentHash,
      mimeType,
      byteSize: buffer.byteLength,
      sourceUrl,
      sourceId,
    });
  } catch (err) {
    console.error(`[logo] failed for org ${organizationId}:`, err instanceof Error ? err.message : err);
  }
}
