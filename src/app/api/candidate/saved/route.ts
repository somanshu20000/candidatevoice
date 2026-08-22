import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/client-ip";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import {
  CANDIDATE_COOKIE_NAME,
  decodeCandidateCookie,
  encodeCandidateCookie,
  getCandidateCookieOptions,
} from "@/lib/candidate/cookie";
import { createCandidateProfile, candidateProfileExists } from "@/lib/candidate/store";
import { loadSavedCompanies, saveCompany, unsaveCompany } from "@/lib/candidate/saved";

/**
 * Save/unsave a company for the anonymous candidate identity (Phase 2,
 * product-experience audit). Mirrors /api/advisor/preferences exactly: same
 * cookie, same mint-on-first-write, same rate limiting, same "this route and
 * candidate/saved.ts are the ONLY path to candidate_saved_companies" shape.
 *
 * Touches candidate_profiles / candidate_saved_companies / organizations
 * (existence check only) and NOTHING in the evidence graph — saving a company
 * can never read or write a hiring report.
 */

export const runtime = "nodejs";

const MAX_WRITES_PER_HOUR = 60; // a few dozen saves in a session is normal browsing, not abuse
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Body {
  organization_id?: unknown;
}

function parseOrganizationId(body: Body): { ok: true; value: string } | { ok: false; error: string } {
  const raw = body.organization_id;
  if (typeof raw !== "string" || !UUID_RE.test(raw)) {
    return { ok: false, error: "organization_id must be a valid id" };
  }
  return { ok: true, value: raw };
}

async function verifyOrganizationId(client: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await client.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  return !error && data !== null;
}

/** GET — the current candidate's saved organization ids (empty if no profile yet). */
export async function GET(req: NextRequest) {
  const cookieId = decodeCandidateCookie(req.cookies.get(CANDIDATE_COOKIE_NAME)?.value);
  if (!cookieId) return NextResponse.json({ organizationIds: [] });

  const supabase = createAdminClient() as unknown as SupabaseClient;
  const entries = await loadSavedCompanies(supabase, cookieId);
  return NextResponse.json({ organizationIds: entries.map((e) => e.organizationId) });
}

/** POST — save a company, minting a candidate profile on first save. */
export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limited = await checkAndRecordRateLimit("candidate_saved_write", ip, MAX_WRITES_PER_HOUR, RATE_LIMIT_WINDOW_MS);
  if (limited) {
    return NextResponse.json({ error: "Too many updates. Please try again later." }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const parsed = parseOrganizationId(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const supabase = createAdminClient() as unknown as SupabaseClient;

  const orgValid = await verifyOrganizationId(supabase, parsed.value);
  if (!orgValid) return NextResponse.json({ error: "That company could not be verified." }, { status: 400 });

  // Same mint-on-first-write shape as /api/advisor/preferences.
  let candidateId = decodeCandidateCookie(req.cookies.get(CANDIDATE_COOKIE_NAME)?.value);
  let mintedNew = false;
  if (candidateId) {
    const exists = await candidateProfileExists(supabase, candidateId);
    if (!exists) candidateId = null;
  }
  if (!candidateId) {
    candidateId = await createCandidateProfile(supabase);
    mintedNew = true;
    if (!candidateId) {
      return NextResponse.json({ error: "Unable to save right now." }, { status: 500 });
    }
  }

  const saved = await saveCompany(supabase, candidateId, parsed.value);
  if (!saved) return NextResponse.json({ error: "Unable to save right now." }, { status: 500 });

  const res = NextResponse.json({ ok: true, saved: true });
  if (mintedNew) {
    const encoded = encodeCandidateCookie(candidateId);
    if (!encoded) {
      return NextResponse.json({ error: "COOKIE_SECRET is not configured." }, { status: 500 });
    }
    res.cookies.set(CANDIDATE_COOKIE_NAME, encoded, getCandidateCookieOptions());
  }
  return res;
}

/** DELETE — unsave a company. No-op success if there was no candidate cookie or no saved row. */
export async function DELETE(req: NextRequest) {
  const ip = getClientIp(req);
  const limited = await checkAndRecordRateLimit("candidate_saved_write", ip, MAX_WRITES_PER_HOUR, RATE_LIMIT_WINDOW_MS);
  if (limited) {
    return NextResponse.json({ error: "Too many updates. Please try again later." }, { status: 429 });
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const parsed = parseOrganizationId(body);
  if (!parsed.ok) return NextResponse.json({ error: parsed.error }, { status: 400 });

  const cookieId = decodeCandidateCookie(req.cookies.get(CANDIDATE_COOKIE_NAME)?.value);
  if (!cookieId) return NextResponse.json({ ok: true, saved: false });

  const supabase = createAdminClient() as unknown as SupabaseClient;
  const removed = await unsaveCompany(supabase, cookieId, parsed.value);
  if (!removed) return NextResponse.json({ error: "Unable to remove right now." }, { status: 500 });

  return NextResponse.json({ ok: true, saved: false });
}
