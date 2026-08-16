/**
 * V3.1 — GET /api/admin/evidence-readiness
 *
 * Admin-gated operations metric: how close is production to having enough
 * genuine first-party evidence for the product to be useful? Runs the SAME
 * engine the /analytics page uses (loadCompanyAnalytics) and reduces it with
 * the pure `evidenceReadiness` — no new aggregation path (D-001). Returns
 * aggregate counts only; nothing here identifies a contributor or a report.
 */

import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { loadCompanyAnalytics } from "@/lib/evidence";
import { evidenceReadiness } from "@/lib/evidence/readiness";

export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const analytics = await loadCompanyAnalytics(createAdminClient() as unknown as SupabaseClient);
    return NextResponse.json({ readiness: evidenceReadiness(analytics) });
  } catch (err) {
    console.error("[admin/evidence-readiness]", err);
    return NextResponse.json({ error: "Unable to compute evidence readiness." }, { status: 500 });
  }
}
