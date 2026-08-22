import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { CANDIDATE_COOKIE_NAME, decodeCandidateCookie } from "./cookie";
import { loadPreferences } from "./store";
import { isPreferenceDimension } from "@/lib/advisor";
import type { PreferenceVector } from "@/lib/advisor";
import { pseudonymFor } from "./pseudonym";

/**
 * Read the current visitor's candidate id from the cv_candidate cookie, or
 * null if absent/tampered. Does NOT confirm the row still exists — this is a
 * cheap signature check for display purposes (pseudonym, "do you have saved
 * companies") where a stale id degrades to "nothing to show," never an error.
 * Write paths (save/unsave, preferences PUT) independently re-verify via
 * candidateProfileExists before writing, exactly as the preferences route
 * already does.
 */
export function readCandidateId(): string | null {
  return decodeCandidateCookie(cookies().get(CANDIDATE_COOKIE_NAME)?.value);
}

/**
 * Read the current visitor's preference vector in a Server Component, from the
 * cv_candidate cookie. Returns {} when there is no candidate cookie, the id is
 * tampered/expired, or the read fails — the advisor surfaces then simply don't
 * render, exactly like an unset filter. Never throws.
 *
 * Marked server-only: it uses the service-role client (the candidate tables are
 * RLS-locked to it) and must never be bundled into client code.
 */
export async function readCandidateVector(): Promise<PreferenceVector> {
  try {
    const id = readCandidateId();
    if (!id) return {};

    const supabase = createAdminClient() as unknown as SupabaseClient;
    const entries = await loadPreferences(supabase, id);

    const vector: PreferenceVector = {};
    for (const e of entries) {
      // Defensive: only surface dimensions the advisor still recognises, so a
      // preference stored under a since-removed key can't reach the engine.
      if (isPreferenceDimension(e.dimension)) vector[e.dimension] = e.weight;
    }
    return vector;
  } catch {
    return {};
  }
}

/**
 * The current visitor's display pseudonym, or null if they have no candidate
 * cookie yet (a first-time visitor gets one only once they save a preference
 * or a company — see the save/unsave and preferences routes). Pure — no DB
 * read, since pseudonymFor only needs the id itself (Phase 1 of the
 * product-experience audit).
 */
export function readCandidatePseudonym(): string | null {
  const id = readCandidateId();
  return id ? pseudonymFor(id) : null;
}

/** True when the visitor has at least one saved preference. */
export function hasPreferences(vector: PreferenceVector): boolean {
  return Object.keys(vector).length > 0;
}
