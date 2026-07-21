/**
 * CandidateVoice — Durable, atomic rate limiting
 *
 * Replaces the in-memory counter previously used in src/app/api/submit/route.ts,
 * which did not survive across Vercel serverless invocations and was therefore
 * not reliably enforced. Backed by a small Postgres table + function (see
 * supabase/migrations/0001_rate_limit_and_moderation_audit.sql) via the
 * existing Supabase connection — no new infrastructure vendor.
 *
 * The increment itself (checkAndRecordRateLimit / recordFailedAttempt) goes
 * through a single atomic `rate_limit_increment` Postgres function — an
 * earlier version of this module did a separate count-then-insert from the
 * client, which was a real check-then-act race under concurrent requests
 * from the same identifier. The atomic upsert closes that: concurrent
 * callers for the same (scope, identifier) are serialized by Postgres's row
 * lock on the conflict target.
 *
 * Fails open: if the migration hasn't been applied yet (table/function don't
 * exist), calls log a warning and behave as if the caller is not
 * rate-limited, so deploying this code before running the migration cannot
 * break submissions or admin access.
 *
 * Identifiers (IPs) are HMAC-hashed before storage, consistent with how
 * unlock-cookie.ts already treats visitor data — no raw IP is ever persisted.
 *
 * ── Why Postgres, not Redis/Vercel KV/Upstash ────────────────────────────
 * A purpose-built KV store gives native INCR+EXPIRE and no cleanup job, and
 * is the standard tool for this access pattern in general — that's a real
 * trade-off, not dismissed. But it would add a new vendor, a new credential,
 * a new dependency, and a new failure domain for a workload the existing
 * Postgres connection already handles at this app's actual traffic, with no
 * latency win guaranteed (Upstash's serverless client is also a network
 * round trip, not automatically faster than a same-region Postgres call).
 * Reconsider this choice — specifically, migrate this counter (not the core
 * app data) to Redis/Upstash — when ANY of the following occur:
 *   - sustained traffic exceeds ~10k requests/day,
 *   - rate-limit operations become a measurable percentage of database load,
 *   - connection-pool contention is observed,
 *   - another low-latency infrastructure component (Redis/KV) is introduced
 *     for unrelated reasons (at which point reusing it here is free).
 * None of these apply today. The client-IP trust boundary (client-ip.ts) is
 * unaffected by this decision either way — it stays correct regardless of
 * which store backs the counter.
 */

import crypto from "crypto";
import { createAdminClient } from "@/lib/supabase/server";

const COUNTER_TABLE = "rate_limit_counters";
const INCREMENT_FN = "rate_limit_increment";

function hashIdentifier(identifier: string): string {
  const secret = process.env.COOKIE_SECRET ?? "";
  return crypto.createHmac("sha256", secret).update(identifier).digest("hex");
}

/**
 * Atomically increments the (scope, identifierHash) counter — resetting it
 * first if the previous window has expired — and returns the new count.
 * Returns null (rather than throwing) if the migration hasn't been applied
 * yet, so callers can fail open.
 */
async function incrementCounter(
  scope: string,
  identifierHash: string,
  windowSeconds: number
): Promise<number | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await (supabase.rpc as any)(INCREMENT_FN, {
      p_scope: scope,
      p_identifier_hash: identifierHash,
      p_window_seconds: windowSeconds,
    });
    if (error) throw error;
    return typeof data === "number" ? data : null;
  } catch (err) {
    console.warn(
      `[rate-limit] falling back to "not limited" for scope "${scope}" — has supabase/migrations/0001_rate_limit_and_moderation_audit.sql been applied?`,
      err
    );
    return null;
  }
}

/**
 * Reads the current count for (scope, identifierHash) without incrementing —
 * used for a fail-fast pre-check where only failures should count toward the
 * limit (e.g. admin auth). Approximate under heavy concurrency (this read
 * isn't part of the same atomic operation as the increment), which is
 * acceptable for a pre-check: the actual increment on the failure path is
 * still atomic via incrementCounter above.
 */
async function readCurrentCount(
  scope: string,
  identifierHash: string,
  windowSeconds: number
): Promise<number | null> {
  try {
    const supabase = createAdminClient();
    const { data, error } = await (supabase.from(COUNTER_TABLE) as any)
      .select("count, window_start")
      .eq("scope", scope)
      .eq("identifier_hash", identifierHash)
      .maybeSingle();
    if (error) throw error;
    if (!data) return 0;

    const windowStart = new Date(data.window_start).getTime();
    const expired = Date.now() - windowStart > windowSeconds * 1000;
    return expired ? 0 : data.count;
  } catch (err) {
    console.warn(
      `[rate-limit] falling back to "not limited" for scope "${scope}" — has supabase/migrations/0001_rate_limit_and_moderation_audit.sql been applied?`,
      err
    );
    return null;
  }
}

/**
 * Atomically checks-and-records one attempt for `identifier` under `scope`.
 * Use for endpoints where every request (successful or not) should count —
 * e.g. anonymous submission. Returns true if the caller should be rejected
 * as rate-limited (this attempt is still recorded either way, matching the
 * behavior of the in-memory limiter it replaces).
 */
export async function checkAndRecordRateLimit(
  scope: string,
  identifier: string,
  maxEvents: number,
  windowMs: number
): Promise<boolean> {
  const count = await incrementCounter(scope, hashIdentifier(identifier), Math.round(windowMs / 1000));
  if (count === null) return false; // fail open
  return count > maxEvents;
}

/**
 * Checks whether `identifier` is currently locked out for `scope`, without
 * recording anything itself. Pair with recordFailedAttempt below, called
 * only on the failure path, so legitimate repeated use is never penalized.
 */
export async function isLockedOut(
  scope: string,
  identifier: string,
  maxEvents: number,
  windowMs: number
): Promise<boolean> {
  const count = await readCurrentCount(scope, hashIdentifier(identifier), Math.round(windowMs / 1000));
  if (count === null) return false; // fail open
  return count >= maxEvents;
}

/** Atomically records a failed attempt for `identifier` under `scope`. */
export async function recordFailedAttempt(
  scope: string,
  identifier: string,
  windowMs: number
): Promise<void> {
  await incrementCounter(scope, hashIdentifier(identifier), Math.round(windowMs / 1000));
}
