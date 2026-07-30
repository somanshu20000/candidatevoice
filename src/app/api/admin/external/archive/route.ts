import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { moderateExternalReport } from "@/lib/hiring-intel/moderation";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Archive removes a report from public view (the read policy only shows
 * 'approved') without deleting the audit row. Allowed regardless of the
 * report's current status — a moderator may archive something previously
 * approved and later found stale or wrong, not only pending items.
 */
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
    await moderateExternalReport(supabase, id, "archive");
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/external/archive]", err);
    return NextResponse.json({ error: "Unable to archive report." }, { status: 500 });
  }
}
