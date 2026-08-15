/**
 * M5.2a — the verification grant store: the ONLY thing this module persists
 * is `sha256(nonce)` + `expires_at`. No organization, no tier, no address,
 * no consumed-at timestamp, no created-at timestamp — see migration
 * 0027_submission_verification.sql and the M5.2 architecture decision §4/§7
 * (INV-V) for why. The organization/tier binding lives entirely inside the
 * SIGNED TOKEN (token.ts), never in this table — so this table alone can
 * never answer "who verified for which company."
 *
 * CONSUMPTION IS ATOMIC. `consumeGrant` issues a single
 * `DELETE ... WHERE grant_hash = $1 AND expires_at > now() RETURNING …`.
 * Postgres serializes concurrent statements against the same row via its own
 * row-locking — there is no separate check-then-delete step, so two
 * concurrent callers racing the same nonce cannot both succeed: exactly one
 * DELETE matches and returns a row, the other's WHERE clause matches
 * nothing (the row is already gone) and returns zero rows. This is the
 * "prefer an atomic database operation" requirement, satisfied by a single
 * statement rather than an explicit transaction wrapper.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";

function hashNonce(nonce: string): string {
  return crypto.createHash("sha256").update(nonce).digest("hex");
}

/** Records that a nonce exists and when it expires. Called once, at grant
 *  issuance, alongside signGrant() — the DB row and the signed token are
 *  created together but are independent artifacts (see redeemGrant). */
export async function issueGrant(supabase: SupabaseClient, nonce: string, expiresAt: Date): Promise<void> {
  const { error } = await supabase
    .from("verification_grants")
    .insert({ grant_hash: hashNonce(nonce), expires_at: expiresAt.toISOString() });
  if (error) throw new Error(`issueGrant: ${error.message}`);
}

/**
 * Attempts to consume a nonce. Returns true exactly once per nonce — every
 * subsequent call (replay, or a losing concurrent racer) returns false. Also
 * enforces expiry independently of the token's own embedded `exp` (defense
 * in depth): an expired-but-unpurged row is not matched by the
 * `expires_at > now()` filter, so it fails closed even if a cleanup job
 * hasn't run yet.
 */
export async function consumeGrant(supabase: SupabaseClient, nonce: string): Promise<boolean> {
  const { data, error } = await supabase
    .from("verification_grants")
    .delete()
    .eq("grant_hash", hashNonce(nonce))
    .gt("expires_at", new Date().toISOString())
    .select("grant_hash");
  if (error) throw new Error(`consumeGrant: ${error.message}`);
  return (data?.length ?? 0) > 0;
}

/** Housekeeping only — consumeGrant already fails closed on an expired row
 *  without this ever running. Lets an expired, never-consumed grant's row
 *  not accumulate forever. Safe to call on a schedule or opportunistically;
 *  idempotent. */
export async function purgeExpiredGrants(supabase: SupabaseClient): Promise<number> {
  const { data, error } = await supabase
    .from("verification_grants")
    .delete()
    .lt("expires_at", new Date().toISOString())
    .select("grant_hash");
  if (error) throw new Error(`purgeExpiredGrants: ${error.message}`);
  return data?.length ?? 0;
}
