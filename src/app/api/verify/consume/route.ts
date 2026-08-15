/**
 * M5.2a — POST /api/verify/consume
 *
 * Redeems a grant token issued by /api/verify/grant: verifies its signature
 * and expiry, optionally confirms it is bound to an expected organization,
 * and atomically consumes the underlying nonce so it can never be redeemed
 * again. Returns only { organizationId, tier } on success — no internal
 * identifiers (no grant_hash, no nonce) are ever exposed in the response.
 *
 * This route does not touch hiring_submissions — M5.2a does not wire the
 * submit flow to trust a redeemed grant; that integration, and the actual
 * proof step that makes a tier meaningful, is later work.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { redeemGrant } from "@/lib/verification/redeem";

const STATUS_BY_ERROR: Record<string, number> = {
  invalid_or_expired: 400,
  organization_mismatch: 409,
  already_used: 409,
};

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as { token?: string; organizationId?: string } | null;
  const token = body?.token;
  const organizationId = body?.organizationId?.trim() || undefined;

  if (typeof token !== "string" || !token) {
    return NextResponse.json({ ok: false, error: "Missing token." }, { status: 400 });
  }

  const supabase = createAdminClient() as unknown as SupabaseClient;

  try {
    const result = await redeemGrant(supabase, token, organizationId);
    if (!result.ok) {
      return NextResponse.json({ ok: false, error: result.error }, { status: STATUS_BY_ERROR[result.error] ?? 400 });
    }
    return NextResponse.json({ ok: true, organizationId: result.organizationId, tier: result.tier });
  } catch (err) {
    console.error("[verify/consume]", err);
    return NextResponse.json({ ok: false, error: "Unable to verify grant." }, { status: 500 });
  }
}
