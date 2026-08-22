import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { cleanupStalePresence, PRESENCE_CLEANUP_AFTER_SECONDS } from "@/lib/presence/store";

/**
 * Scheduled presence cleanup — same shared-secret pattern as
 * /api/cron/acquire-external: Vercel Cron sends
 * `Authorization: Bearer $CRON_SECRET` automatically on the schedule in
 * vercel.json. Exists purely so presence_sessions does not grow without
 * bound from tabs that never send a clean "goodbye" (browsers don't
 * reliably fire one on close/navigate-away) — correctness of the active
 * COUNT never depends on this route running (that's governed entirely by
 * the last_seen_at window filter at read time); this only bounds table size.
 */
export const runtime = "nodejs";

function isAuthorizedCron(req: NextRequest): { ok: boolean; error?: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: "CRON_SECRET is not configured." };
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) return { ok: false, error: "Unauthorized." };
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.error?.includes("not configured") ? 500 : 401 });
  }

  const supabase = createAdminClient() as unknown as SupabaseClient;
  const deleted = await cleanupStalePresence(supabase);
  if (deleted === null) {
    return NextResponse.json({ ok: false, error: "cleanup query failed" }, { status: 500 });
  }
  return NextResponse.json({ ok: true, deleted, olderThanSeconds: PRESENCE_CLEANUP_AFTER_SECONDS });
}
