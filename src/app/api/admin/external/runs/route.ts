/**
 * Admin status view (requirement #12): the pipeline's queued -> fetching ->
 * extracted -> validation_failed -> awaiting_moderation -> completed/failed
 * trail, per run, most recent first. Reads external_acquisition_runs
 * (migration 0031) directly — no business logic here.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const { data, error } = await supabase
      .from("external_acquisition_runs")
      .select(
        "id, source_key, company_query, organization_id, status, records_found, records_created, records_duplicate, records_invalid, error_message, triggered_by, started_at, finished_at"
      )
      .order("started_at", { ascending: false })
      .limit(50);
    if (error) throw new Error(error.message);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[admin/external/runs]", err);
    return NextResponse.json({ error: "Unable to load acquisition runs." }, { status: 500 });
  }
}
