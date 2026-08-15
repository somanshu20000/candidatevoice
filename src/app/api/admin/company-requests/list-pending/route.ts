import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { listPendingCompanyRequests } from "@/lib/company-intelligence/requests";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const data = await listPendingCompanyRequests(supabase);
    return NextResponse.json({ data });
  } catch (err) {
    console.error("[admin/company-requests/list-pending]", err);
    return NextResponse.json({ error: "Unable to load pending company requests." }, { status: 500 });
  }
}
