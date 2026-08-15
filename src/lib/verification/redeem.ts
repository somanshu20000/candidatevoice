/**
 * M5.2a — redeemGrant: the single entry point that combines token
 * verification (token.ts) with atomic consumption (grants.ts). Nothing
 * outside this module should call consumeGrant directly for a caller-
 * supplied token — this is what makes "verify, then optionally check the
 * expected organization, then consume" one coherent, safe operation.
 *
 * ORGANIZATION-MISMATCH NEVER CONSUMES. If `expectedOrganizationId` is
 * supplied and does not match the token's bound organization, the
 * underlying nonce is left untouched — a caller who made an honest mistake
 * (or a client bug) can still redeem the SAME token correctly afterward.
 * Only a successful redemption, or an already-expired/replayed nonce,
 * changes the grants table.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { verifyGrant, type VerificationTier } from "./token";
import { consumeGrant } from "./grants";

export type RedeemFailureReason = "invalid_or_expired" | "organization_mismatch" | "already_used";

export type RedeemResult =
  | { ok: true; organizationId: string; tier: VerificationTier }
  | { ok: false; error: RedeemFailureReason };

export async function redeemGrant(
  supabase: SupabaseClient,
  token: string,
  expectedOrganizationId?: string
): Promise<RedeemResult> {
  const payload = verifyGrant(token);
  if (!payload) return { ok: false, error: "invalid_or_expired" };

  if (expectedOrganizationId && payload.organizationId !== expectedOrganizationId) {
    return { ok: false, error: "organization_mismatch" };
  }

  const consumed = await consumeGrant(supabase, payload.nonce);
  if (!consumed) return { ok: false, error: "already_used" };

  return { ok: true, organizationId: payload.organizationId, tier: payload.tier };
}
