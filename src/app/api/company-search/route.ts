import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/client-ip";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import { searchOrganizationsRanked } from "@/lib/company-intelligence/resolve";

/**
 * Ranked company search for the submit-flow confirmation UI (migration 0021).
 * Read-only public reference data — same trust class as /companies' own
 * search (directory.ts), so the anon client is correct here, same as there.
 *
 * Deliberately returns a RANKED LIST, never a single winner: this route's
 * result is advisory. The only place an organization_id becomes load-bearing
 * is /api/submit, which re-verifies it server-side regardless of what this
 * route returned.
 */

const MAX_SEARCHES_PER_HOUR = 120; // generous — a user typing, not a bot

export async function GET(req: NextRequest) {
  const ip = getClientIp(req);
  const limited = await checkAndRecordRateLimit("company_search", ip, MAX_SEARCHES_PER_HOUR, 60 * 60 * 1000);
  if (limited) {
    return NextResponse.json({ error: "Too many searches. Please slow down." }, { status: 429 });
  }

  const q = req.nextUrl.searchParams.get("q") ?? "";
  if (!q.trim()) return NextResponse.json({ candidates: [] });

  const supabase = createClient() as unknown as SupabaseClient;
  try {
    const candidates = await searchOrganizationsRanked(supabase, q, 8);
    return NextResponse.json({ candidates });
  } catch {
    return NextResponse.json({ error: "Search is temporarily unavailable." }, { status: 500 });
  }
}
