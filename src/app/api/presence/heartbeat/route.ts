import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/client-ip";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import { isLikelyBot } from "@/lib/presence/bot-detection";
import { recordHeartbeatAndCount } from "@/lib/presence/store";
import { shouldShowPresence } from "@/lib/presence/threshold";

/**
 * Live presence heartbeat — the ONLY write path to presence_sessions.
 *
 * Structurally cannot let a client submit an arbitrary count: the request
 * body carries only a session id and an optional company slug, never a
 * number. Every count returned is computed server-side from actual row
 * counts in the same call that records this heartbeat.
 *
 * Bot/tooling exclusion (User-Agent denylist), IP rate limiting (reuses the
 * exact same atomic Postgres-backed limiter every other route in this app
 * uses — no new infrastructure), and session_id format validation all run
 * BEFORE anything touches the database. Never bumps the fail path into an
 * error the client has to handle specially — every rejection just means
 * "no counts this tick," which the client already treats as "show nothing."
 */

export const runtime = "nodejs";

const MAX_HEARTBEATS_PER_WINDOW = 40; // generous: several tabs behind a shared/NAT IP, one heartbeat each per tick
const RATE_LIMIT_WINDOW_MS = 60 * 1000;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface HeartbeatBody {
  session_id?: unknown;
  /** Company slug, never a raw organization_id — resolved server-side via
   *  the existing resolve_organization RPC, same as every other route that
   *  accepts a slug from the client. */
  company_slug?: unknown;
}

interface HeartbeatResponse {
  show_global: boolean;
  global_count: number | null;
  show_company: boolean;
  company_count: number | null;
}

const HIDDEN_RESPONSE: HeartbeatResponse = {
  show_global: false, global_count: null, show_company: false, company_count: null,
};

export async function POST(req: NextRequest) {
  // Bot/tooling exclusion — checked first, cheapest rejection, no DB touch.
  if (isLikelyBot(req.headers.get("user-agent"))) {
    return NextResponse.json(HIDDEN_RESPONSE);
  }

  const ip = getClientIp(req);
  const limited = await checkAndRecordRateLimit("presence_heartbeat", ip, MAX_HEARTBEATS_PER_WINDOW, RATE_LIMIT_WINDOW_MS);
  if (limited) {
    return NextResponse.json(HIDDEN_RESPONSE, { status: 429 });
  }

  let body: HeartbeatBody;
  try {
    body = (await req.json()) as HeartbeatBody;
  } catch {
    return NextResponse.json(HIDDEN_RESPONSE, { status: 400 });
  }

  const sessionId = typeof body.session_id === "string" ? body.session_id : "";
  if (!UUID_RE.test(sessionId)) {
    return NextResponse.json(HIDDEN_RESPONSE, { status: 400 });
  }

  const supabase = createAdminClient() as unknown as SupabaseClient;

  let organizationId: string | null = null;
  const companySlug = typeof body.company_slug === "string" ? body.company_slug.trim() : "";
  if (companySlug) {
    // Re-resolved server-side, exactly like every other route that accepts
    // a slug from the client (submit, generateMetadata) — never trusts a
    // client-asserted id, and a slug that doesn't resolve just means "not
    // company-scoped this tick," never an error.
    const { data: orgId } = await supabase.rpc("resolve_organization", { p_slug: companySlug });
    organizationId = typeof orgId === "string" ? orgId : null;
  }

  const counts = await recordHeartbeatAndCount(supabase, sessionId, organizationId);
  if (!counts) {
    // Fail open/silent — migration not applied yet, transient DB error,
    // whatever the cause, the visitor never sees an error: just no counts.
    return NextResponse.json(HIDDEN_RESPONSE);
  }

  const response: HeartbeatResponse = {
    show_global: shouldShowPresence(counts.globalCount),
    global_count: counts.globalCount,
    show_company: organizationId !== null && shouldShowPresence(counts.companyCount),
    company_count: organizationId !== null ? counts.companyCount : null,
  };
  return NextResponse.json(response);
}
