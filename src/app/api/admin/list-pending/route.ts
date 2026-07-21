import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";

export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();

  let { data, error } = await (supabase
    .from("hiring_submissions")
    .select("id, company, role, stage, outcome, reason, created_at")
    .eq("is_approved", false)
    .is("rejected_at", null)
    .order("created_at", { ascending: false }) as any);

  if (error) {
    // rejected_at may not exist yet if the migration hasn't been applied —
    // fall back to the pre-migration query rather than break the admin panel.
    // See supabase/migrations/0001_rate_limit_and_moderation_audit.sql.
    console.warn(
      "[admin/list-pending] query with rejected_at filter failed, falling back — has the migration been applied?",
      error
    );
    ({ data, error } = await (supabase
      .from("hiring_submissions")
      .select("id, company, role, stage, outcome, reason, created_at")
      .eq("is_approved", false)
      .order("created_at", { ascending: false }) as any));
  }

  if (error) {
    return NextResponse.json({ error: "Unable to load pending submissions." }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
