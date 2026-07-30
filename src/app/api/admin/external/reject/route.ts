import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { moderateExternalReport } from "@/lib/hiring-intel/moderation";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing report id." }, { status: 400 });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    await moderateExternalReport(supabase, id, "reject");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/external/reject]", err);
    return NextResponse.json({ error: "Unable to reject report." }, { status: 500 });
  }
}
