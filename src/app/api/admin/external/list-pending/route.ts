import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { listPendingExternalReports } from "@/lib/hiring-intel/moderation";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    // external_reports is not in the hand-authored Database type, same cast
    // used throughout src/lib/company-intelligence for the same reason.
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const data = await listPendingExternalReports(supabase);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[admin/external/list-pending]", err);
    return NextResponse.json({ error: "Unable to load pending external reports." }, { status: 500 });
  }
}
