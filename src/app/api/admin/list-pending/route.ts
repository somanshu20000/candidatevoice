import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";

export async function GET(req: NextRequest) {
  const auth = isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const supabase = createAdminClient();
  const { data, error } = await (supabase
    .from("hiring_submissions")
    .select("id, company, role, stage, outcome, reason, created_at")
    .eq("is_approved", false)
    .order("created_at", { ascending: false }) as any);

  if (error) {
    return NextResponse.json({ error: "Unable to load pending submissions." }, { status: 500 });
  }

  return NextResponse.json({ data: data ?? [] });
}
