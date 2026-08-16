/**
 * V0.2 — GET /api/verify/health
 *
 * Admin-gated readiness check for the verification envelope. Returns
 * `{ configured: boolean }` — the ONLY thing it discloses about
 * VERIFICATION_SECRET. It never returns the value, its length, or any prefix.
 *
 * WHY THIS EXISTS. The verification HTTP flow (grant → consume → submit) can
 * only work once VERIFICATION_SECRET is a Production env var. An earlier pass
 * inferred readiness from the ABSENCE of a specific error string on the grant
 * endpoint, which produced a false positive (a 429 rate-limit response also
 * lacks that string). This endpoint lets readiness be asserted POSITIVELY — a
 * boolean `true` — without writing anything (unlike /api/verify/grant, which
 * inserts a nonce row and is rate-limited). The authoritative end-to-end proof
 * is still an actual `200 + token` from the grant endpoint; this is the cheap,
 * non-writing pre-check that avoids hammering that rate-limited path.
 *
 * Admin-gated (not public) because whether verification is configured is
 * operational information, not a public product surface.
 */

import { NextRequest, NextResponse } from "next/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { isVerificationConfigured } from "@/lib/verification/token";

export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  return NextResponse.json({ configured: isVerificationConfigured() });
}
