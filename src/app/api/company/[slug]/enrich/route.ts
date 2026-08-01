/**
 * On-demand company metadata enrichment.
 *
 * The first HTTP trigger for the company-intelligence subsystem, which was
 * otherwise CLI-only. When a visitor lands on a company that resolves to an
 * organization but has no metadata, the page's ProfileEnrichment client
 * component POSTs here; we fetch a PROVISIONAL profile from public sources and
 * the page refreshes to show it.
 *
 * Node runtime is REQUIRED, not incidental: the enrichment path imports
 * company-intelligence/http.ts, which uses `dns/promises` for SSRF checks and
 * is documented as never touching the edge runtime. Route handlers default to
 * Node, but we state it so a future edge migration can't silently break it.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { createSupabaseCompanyStore } from "@/lib/company-intelligence/store";
import { loadCompanyProfile } from "@/lib/company-intelligence/read";
import { enrichCompanyOnDemand } from "@/lib/company-intelligence/enrich";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { normalizeCompanySlug } from "@/lib/company-slug";

export const runtime = "nodejs";
// Paced sequential adapter calls (WDQS alone is ~1.2s/req) need headroom past
// the 10s serverless default.
export const maxDuration = 60;

// Per-IP: a visitor (or bot) cannot trigger many outbound-fetching requests.
const IP_MAX_PER_HOUR = 8;
const IP_WINDOW_MS = 60 * 60 * 1000;
// Per-slug: concurrent viewers of the same new company cause ONE fetch, not N,
// and a company can't be re-enriched in a tight loop.
const SLUG_WINDOW_MS = 10 * 60 * 1000;

export async function POST(req: NextRequest, { params }: { params: { slug: string } }) {
  const slug = normalizeCompanySlug(decodeURIComponent(params.slug));
  if (!slug) {
    return NextResponse.json({ error: "Invalid company." }, { status: 400 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;
  const store = createSupabaseCompanyStore(admin);

  // GUARD 1 — the abuse gate. Only enrich a slug that ALREADY resolves to an
  // organization (reached via search/directory/a real link). An arbitrary
  // invented /company/<anything> slug resolves to nothing → 404 → no outbound
  // fetch is ever made. This is what stops the endpoint being used to make the
  // server fetch attacker-chosen hosts.
  const organizationId = await store.resolveOrganization(slug).catch(() => null);
  if (!organizationId) {
    return NextResponse.json({ error: "Company not found." }, { status: 404 });
  }

  // GUARD 2 — idempotence. If metadata already exists, do nothing, unless an
  // authenticated admin explicitly forces a refresh (?force=1). "Do not
  // re-fetch unless explicitly requested."
  const force = req.nextUrl.searchParams.get("force") === "1";
  const existing = await loadCompanyProfile(admin, slug).catch(() => null);
  if (existing?.hasMetadata && !force) {
    return NextResponse.json({ status: "exists" }, { status: 200 });
  }
  if (force) {
    const auth = await isAuthorizedAdmin(req);
    if (!auth.ok) {
      return NextResponse.json({ error: auth.error }, { status: auth.status });
    }
  }

  // GUARD 3 — per-IP throttle (DB-backed, so it holds across serverless
  // instances; the per-host buckets in http.ts are per-process module state and
  // give no cross-instance pacing).
  const ip = getClientIp(req);
  if (await checkAndRecordRateLimit("company_enrich_ip", ip, IP_MAX_PER_HOUR, IP_WINDOW_MS)) {
    return NextResponse.json({ error: "Rate limit. Try again later." }, { status: 429 });
  }

  // GUARD 4 — per-slug throttle. One enrichment attempt per company per window,
  // regardless of who triggered it, so a page with many concurrent viewers
  // doesn't fan out into many identical fetches. maxEvents=1: the first caller
  // in the window proceeds, the rest short-circuit.
  if (await checkAndRecordRateLimit("company_enrich_slug", slug, 1, SLUG_WINDOW_MS)) {
    return NextResponse.json({ status: "in_progress" }, { status: 202 });
  }

  // Never throws — every source is independently guarded and total failure
  // returns a status the client treats as "leave the empty state alone".
  const result = await enrichCompanyOnDemand(store, existing?.displayName ?? slug.replace(/-/g, " "));

  const httpStatus = result.status === "enriched" ? 200 : result.status === "no_entity" ? 404 : 502;
  return NextResponse.json(
    { status: result.status, sourcesWritten: result.sourcesWritten, created: result.created, updated: result.updated },
    { status: httpStatus }
  );
}
