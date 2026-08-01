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
import {
  createCandidateProfile,
  candidateProfileExists,
  loadPreferences,
  savePreferences,
  type PreferenceEntry,
} from "@/lib/candidate/store";
import { isPreferenceDimension } from "@/lib/advisor";

/**
 * The preference-vector API — read and write the anonymous candidate's
 * priorities. This is the ONLY write path to the candidate tables (RLS blocks
 * everyone but the service role; the opaque cookie id is the capability).
 *
 * It touches candidate_profiles / candidate_preferences and NOTHING in the
 * evidence graph — setting preferences can never read or write a hiring report,
 * which is what keeps the two anonymous identities uncorrelated.
 */

export const runtime = "nodejs";

const MAX_WRITES_PER_HOUR = 40; // generous — a user tuning sliders, not a bot
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;
const MAX_DIMENSIONS = 32; // the vocabulary is 13 today; a loose DoS cap

interface PutBody {
  preferences?: unknown;
}

/**
 * Validate the submitted preference map into clean (dimension, weight) entries,
 * or a message naming what was wrong. Unknown dimensions and out-of-range
 * weights are rejected rather than silently dropped, so the client and server
 * never disagree about what was stored.
 */
function validatePreferences(raw: unknown): { ok: true; value: PreferenceEntry[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "preferences must be an object of dimension → weight" };

  const entries: PreferenceEntry[] = [];
  for (const [dimension, weightRaw] of Object.entries(raw as Record<string, unknown>)) {
    if (!isPreferenceDimension(dimension)) return { ok: false, error: `unknown preference dimension: ${dimension}` };
    const weight = Number(weightRaw);
    if (!Number.isInteger(weight) || weight < 1 || weight > 5) {
      return { ok: false, error: `weight for ${dimension} must be an integer 1-5` };
    }
    entries.push({ dimension, weight });
  }
  if (entries.length > MAX_DIMENSIONS) return { ok: false, error: `too many dimensions (max ${MAX_DIMENSIONS})` };
  return { ok: true, value: entries };
}

/** GET — return the current candidate's preference vector (empty if no profile yet). */
export async function GET(req: NextRequest) {
  const cookieId = decodeCandidateCookie(req.cookies.get(CANDIDATE_COOKIE_NAME)?.value);
  if (!cookieId) return NextResponse.json({ preferences: {} });

  const supabase = createAdminClient() as unknown as SupabaseClient;
  const entries = await loadPreferences(supabase, cookieId);
  const preferences: Record<string, number> = {};
  for (const e of entries) preferences[e.dimension] = e.weight;
  return NextResponse.json({ preferences });
}

/** PUT — replace the candidate's preference vector, minting a profile on first save. */
export async function PUT(req: NextRequest) {
  const ip = getClientIp(req);
  const limited = await checkAndRecordRateLimit("advisor_preferences", ip, MAX_WRITES_PER_HOUR, RATE_LIMIT_WINDOW_MS);
  if (limited) {
    return NextResponse.json({ error: "Too many updates. Please try again later." }, { status: 429 });
  }

  let body: PutBody;
  try {
    body = (await req.json()) as PutBody;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }

  const validation = validatePreferences(body.preferences);
  if (!validation.ok) return NextResponse.json({ error: validation.error }, { status: 400 });

  const supabase = createAdminClient() as unknown as SupabaseClient;

  // Resolve — or mint — the candidate identity. A cookie id that no longer
  // names a real row (profile deleted, secret rotated) is treated as absent.
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
      return NextResponse.json({ error: "Unable to save preferences right now." }, { status: 500 });
    }
  }

  const saved = await savePreferences(supabase, candidateId, validation.value);
  if (!saved) return NextResponse.json({ error: "Unable to save preferences right now." }, { status: 500 });

  const res = NextResponse.json({ ok: true, count: validation.value.length });

  // Set the cookie whenever we minted a new id. (Re-setting an existing id is
  // harmless but unnecessary.) The signed value carries only the opaque id.
  if (mintedNew) {
    const encoded = encodeCandidateCookie(candidateId);
    if (!encoded) {
      // No COOKIE_SECRET configured — the write succeeded but the visitor won't
      // keep their id. Report it rather than pretending the round-trip worked.
      return NextResponse.json({ error: "COOKIE_SECRET is not configured." }, { status: 500 });
    }
    res.cookies.set(CANDIDATE_COOKIE_NAME, encoded, getCandidateCookieOptions());
  }
  return res;
}
