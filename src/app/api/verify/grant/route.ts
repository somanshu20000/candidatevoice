/**
 * M5.2a — POST /api/verify/grant
 *
 * SCAFFOLDING ONLY. No email exists in this codebase (M5.2b, gated on a
 * separate vendor/legal decision — see DECISIONS.md). This endpoint issues a
 * signed grant token directly in its response, rather than emailing it,
 * because there is nowhere else for it to go yet. Returning the token
 * directly means the caller is simply asserting the tier it wants — nothing
 * here checks that the caller actually controls any inbox at the claimed
 * organization's domain. THIS ENDPOINT DOES NOT VERIFY EMPLOYMENT, FORMER
 * EMPLOYMENT, OR CANDIDATE INTERACTION. It exists to exercise and test the
 * grant/token plumbing end-to-end over HTTP. M5.2b's job is to insert a real
 * proof step (a domain-matched emailed link) BEFORE a token is ever handed
 * to a caller — at which point this route's shape, not its trust model,
 * is what carries forward.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";
import { organizationExists } from "@/lib/company-intelligence/resolve";
import { generateNonce, signGrant, GRANTABLE_TIERS, type VerificationTier } from "@/lib/verification/token";
import { issueGrant } from "@/lib/verification/grants";

const GRANT_TTL_SECONDS = 15 * 60; // 15 minutes
const MAX_GRANTS_PER_HOUR = 10;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

export async function POST(req: NextRequest) {
  const ip = getClientIp(req);
  const limited = await checkAndRecordRateLimit("verify_grant", ip, MAX_GRANTS_PER_HOUR, RATE_LIMIT_WINDOW_MS);
  if (limited) {
    return NextResponse.json({ error: "Too many verification attempts. Please try again later." }, { status: 429 });
  }

  const body = (await req.json().catch(() => null)) as { organizationId?: string; tier?: string } | null;
  const organizationId = body?.organizationId?.trim();
  const tier = body?.tier;

  if (!organizationId) {
    return NextResponse.json({ error: "Missing organizationId." }, { status: 400 });
  }
  if (typeof tier !== "string" || !(GRANTABLE_TIERS as readonly string[]).includes(tier)) {
    return NextResponse.json(
      { error: `Invalid tier. Must be one of: ${GRANTABLE_TIERS.join(", ")}.` },
      { status: 400 }
    );
  }

  const supabase = createAdminClient() as unknown as SupabaseClient;

  const exists = await organizationExists(supabase, organizationId);
  if (!exists) {
    return NextResponse.json({ error: "Unknown organization." }, { status: 404 });
  }

  const nonce = generateNonce();
  const exp = Math.floor(Date.now() / 1000) + GRANT_TTL_SECONDS;
  const expiresAt = new Date(exp * 1000);

  try {
    await issueGrant(supabase, nonce, expiresAt);
  } catch (err) {
    console.error("[verify/grant]", err);
    return NextResponse.json({ error: "Unable to issue verification grant." }, { status: 500 });
  }

  let token: string;
  try {
    token = signGrant({ nonce, organizationId, tier: tier as VerificationTier, exp });
  } catch (err) {
    console.error("[verify/grant] signing failed — is VERIFICATION_SECRET configured?", err);
    return NextResponse.json({ error: "Verification is not configured." }, { status: 500 });
  }

  return NextResponse.json({ token, expiresAt: expiresAt.toISOString() });
}
