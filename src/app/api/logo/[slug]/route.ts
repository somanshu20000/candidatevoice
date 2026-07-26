/**
 * GET /api/logo/[slug] — serve a company logo SAME-ORIGIN.
 *
 * WHY A ROUTE AND NOT A DIRECT URL
 * next.config.js sets `img-src 'self' data:`. A logo hot-linked from a
 * third-party CDN, or served straight from Supabase Storage (a different
 * origin), is blocked by that policy. Proxying through this route keeps every
 * <img> on the app's own origin, so the CSP stays strict rather than being
 * widened to allow external image hosts.
 *
 * Every company resolves to SOMETHING: a stored logo when one has been
 * imported, otherwise a generated monogram. A page never has a broken image.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeCompanySlug } from "@/lib/company-slug";

const STORAGE_BUCKET = "company-logos";

/** Deterministic warm ink colour from a slug, in the paper palette's register. */
function monogramColor(slug: string): string {
  let hash = 0;
  for (let i = 0; i < slug.length; i++) hash = (hash * 31 + slug.charCodeAt(i)) & 0xffffff;
  const hue = hash % 360;
  // Muted, low-chroma so it sits on paper rather than glowing.
  return `hsl(${hue} 32% 42%)`;
}

/**
 * XML-escape a value before interpolating it into the SVG below.
 *
 * REQUIRED, not defensive. The slug reaching this route is attacker-controlled:
 * normalizeCompanySlug only lowercases, trims and collapses whitespace — it
 * strips no punctuation — so `"><script>…</script>` survives it intact. Because
 * the response is served as image/svg+xml (a scriptable, actively-rendered
 * document) and next.config.js allows `script-src 'self' 'unsafe-inline'`,
 * interpolating unescaped input here is a reflected XSS in the app's own origin,
 * where the HMAC unlock cookie lives. `nosniff` does not mitigate it.
 */
function escapeXml(value: string): string {
  return value.replace(/[&<>"']/g, (ch) =>
    ch === "&" ? "&amp;"
      : ch === "<" ? "&lt;"
        : ch === ">" ? "&gt;"
          : ch === '"' ? "&quot;"
            : "&apos;"
  );
}

/** A same-origin SVG monogram. Deterministic, so it is safely cacheable. */
function fallbackMonogram(slug: string, displayName: string): NextResponse {
  const letter = (displayName.trim()[0] ?? slug[0] ?? "?").toUpperCase();
  // monogramColor emits a fixed hsl() from a numeric hash, so it needs no escaping.
  const color = monogramColor(slug);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="128" height="128" viewBox="0 0 128 128" role="img" aria-label="${escapeXml(displayName)} logo placeholder">
  <rect width="128" height="128" rx="16" fill="#F4F1EA"/>
  <rect x="1" y="1" width="126" height="126" rx="15" fill="none" stroke="#E0DBCE"/>
  <text x="64" y="64" dy="0.35em" text-anchor="middle" font-family="Georgia, 'Times New Roman', serif" font-size="60" fill="${color}">${escapeXml(letter)}</text>
</svg>`;
  return new NextResponse(svg, {
    status: 200,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      // Short cache: a real logo may be imported later, at which point we want
      // the placeholder to stop being served fairly promptly.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}

export async function GET(_req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = normalizeCompanySlug(decodeURIComponent(params.slug));
  if (!slug) return new NextResponse("Not found", { status: 404 });

  // The Company Intelligence tables (organizations, company_logos) and the
  // resolve_organization RPC are not part of the hand-authored Database type in
  // src/types/index.ts, so query them through an untyped client view — the same
  // approach src/lib/company-intelligence/store.ts takes. Casting to the
  // generic SupabaseClient (any schema) is honest: these tables genuinely are
  // not in the typed schema yet.
  let supabase: SupabaseClient;
  try {
    supabase = createAdminClient() as unknown as SupabaseClient;
  } catch {
    // Secrets not configured (e.g. local dev without service role). Still serve
    // a placeholder rather than 500 — the logo is decorative.
    return fallbackMonogram(slug, slug.replace(/-/g, " "));
  }

  // Resolve the employer, then its current logo.
  const { data: orgId } = await supabase.rpc("resolve_organization", { p_slug: slug });
  if (!orgId) return fallbackMonogram(slug, slug.replace(/-/g, " "));

  const { data: org } = await supabase
    .from("organizations")
    .select("display_name")
    .eq("id", orgId)
    .maybeSingle();
  const displayName = org?.display_name ?? slug.replace(/-/g, " ");

  const { data: logo } = await supabase
    .from("company_logos")
    .select("storage_path, mime_type")
    .eq("organization_id", orgId)
    .eq("is_current", true)
    .not("storage_path", "is", null)
    .maybeSingle();

  if (!logo?.storage_path) return fallbackMonogram(slug, displayName);

  const { data: file, error } = await supabase.storage.from(STORAGE_BUCKET).download(logo.storage_path);
  if (error || !file) return fallbackMonogram(slug, displayName);

  const buffer = Buffer.from(await file.arrayBuffer());
  return new NextResponse(buffer, {
    status: 200,
    headers: {
      "Content-Type": logo.mime_type ?? "image/png",
      // Logos are versioned (a replacement writes a new row and flips
      // is_current), and the URL is by slug, so cache generously but allow
      // revalidation when the current logo changes.
      "Cache-Control": "public, max-age=86400, s-maxage=604800",
    },
  });
}
