import "server-only";
import { cookies } from "next/headers";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { CANDIDATE_COOKIE_NAME, decodeCandidateCookie } from "./cookie";
import { loadPreferences } from "./store";
import { isPreferenceDimension } from "@/lib/advisor";
import type { PreferenceVector } from "@/lib/advisor";

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
    const id = decodeCandidateCookie(cookies().get(CANDIDATE_COOKIE_NAME)?.value);
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

/** True when the visitor has at least one saved preference. */
export function hasPreferences(vector: PreferenceVector): boolean {
  return Object.keys(vector).length > 0;
}
