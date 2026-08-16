/**
 * "Add this company" — the public write path `company_requests` never had
 * (migration 0022's own comment: "no anon/authenticated policy of any kind —
 * every access goes through the service-role client"). Before this route the
 * ONLY way to reach `createCompanyRequest` (resolve.ts) was as a side effect
 * of finishing the entire hiring-report wizard, so a stranger who just wanted
 * to say "this real company isn't listed" had no path shorter than writing a
 * full report. This route is that path, standalone.
 *
 * Reuses M5.1's exact promote-time collision logic (searchOrganizationsRanked
 * + findOrganizationByDomain) at REQUEST-CREATION time too, so a request that
 * would be refused at promotion is refused up front instead of sitting in the
 * queue. Also checks for an existing PENDING request with the same name/
 * domain, so repeat visitors don't spam duplicate queue entries.
 *
 * Best-effort identity enrichment: if the caller didn't supply a domain, try
 * to discover one via the SAME on-demand pipeline enrich.ts uses (Wikidata,
 * with the PixelRAG fallback — DECISIONS.md D-027) so an admin reviewing the
 * queue has more than a bare name to go on. Never blocks or fails the request
 * on enrichment failure — it is purely additive.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { searchOrganizationsRanked, createCompanyRequest, confidenceTier } from "@/lib/company-intelligence/resolve";
import { findOrganizationByDomain } from "@/lib/company-intelligence/requests";
import { resolveVerifiedCompanyEntity, wikidataRecordFromEntity } from "@/lib/company-intelligence/adapters/wikidata";

export const runtime = "nodejs";
export const maxDuration = 30;

const IP_MAX_PER_HOUR = 5;
const IP_WINDOW_MS = 60 * 60 * 1000;
const MAX_NAME_LENGTH = 200;
const MAX_DOMAIN_LENGTH = 200;
const MAX_NOTE_LENGTH = 500;

function normalizeDomain(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
}

/** Best-effort only — a slow/failed lookup never blocks request creation. */
async function tryDiscoverDomain(name: string): Promise<string | null> {
  try {
    const entity = await resolveVerifiedCompanyEntity(name);
    if (!entity) return null;
    const record = wikidataRecordFromEntity(name, entity);
    const site = typeof record.website === "string" ? record.website : null;
    return site ? normalizeDomain(site) : null;
  } catch {
    return null;
  }
}

export async function POST(req: NextRequest) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body." }, { status: 400 });
  }
  const { name, domain, note } = (body ?? {}) as { name?: unknown; domain?: unknown; note?: unknown };

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "Company name is required." }, { status: 400 });
  }
  const requestedName = name.trim().slice(0, MAX_NAME_LENGTH);
  const requestedDomain = typeof domain === "string" && domain.trim() ? domain.trim().slice(0, MAX_DOMAIN_LENGTH) : null;
  const requesterNote = typeof note === "string" && note.trim() ? note.trim().slice(0, MAX_NOTE_LENGTH) : null;

  const ip = getClientIp(req);
  if (await checkAndRecordRateLimit("company_request_create_ip", ip, IP_MAX_PER_HOUR, IP_WINDOW_MS)) {
    return NextResponse.json({ error: "Rate limit. Try again later." }, { status: 429 });
  }

  const admin = createAdminClient() as unknown as SupabaseClient;

  // GUARD 1 — does this already resolve to an existing organization? Reuses
  // the exact ranked search + confidence tier the submit flow itself uses.
  try {
    const candidates = await searchOrganizationsRanked(admin, requestedName, 3);
    const top = candidates[0];
    if (top && confidenceTier(top.score) === "confident") {
      return NextResponse.json(
        {
          error: `"${top.displayName}" already exists — search for it directly instead of requesting it again.`,
          existingSlug: top.slug,
        },
        { status: 409 }
      );
    }
  } catch {
    // Search failing must never block a legitimate request — fall through.
  }

  // GUARD 2 — domain collision, same check promote-time already runs.
  if (requestedDomain) {
    const normalized = normalizeDomain(requestedDomain);
    if (normalized) {
      const existingByDomain = await findOrganizationByDomain(admin, normalized);
      if (existingByDomain) {
        return NextResponse.json(
          { error: "A company with this domain is already listed — search for it directly instead of requesting it again." },
          { status: 409 }
        );
      }
    }
  }

  // GUARD 3 — an identical PENDING request already exists; don't queue a
  // duplicate for admins to review twice.
  const { data: pendingDupes } = await admin
    .from("company_requests")
    .select("id")
    .eq("status", "pending")
    .ilike("requested_name", requestedName)
    .limit(1);
  if ((pendingDupes?.length ?? 0) > 0) {
    return NextResponse.json(
      { error: "This company has already been requested and is awaiting review." },
      { status: 409 }
    );
  }

  // Best-effort identity enrichment — never blocks, never overrides a
  // caller-supplied domain.
  const domainForRequest = requestedDomain ?? (await tryDiscoverDomain(requestedName));

  const result = await createCompanyRequest(admin, {
    requestedName,
    requestedDomain: domainForRequest,
    requesterNote,
  });
  if (!result.ok) {
    return NextResponse.json({ error: "Could not create the request. Please try again." }, { status: 500 });
  }

  return NextResponse.json({ ok: true }, { status: 201 });
}
