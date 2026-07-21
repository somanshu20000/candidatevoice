import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";

export async function POST(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing submission id." }, { status: 400 });
  }

  const supabase = createAdminClient();

  // Soft-delete: keep the row with rejected_at set instead of destroying the
  // only record of what was rejected and when. Also forces is_approved=false
  // so rejecting an already-approved row (direct API misuse) can never leave
  // it publicly visible while flagged as rejected — approve and reject must
  // keep is_approved/rejected_at mutually consistent. Falls back to the
  // previous hard-delete if the rejected_at column doesn't exist yet
  // (migration not applied) — see
  // supabase/migrations/0001_rate_limit_and_moderation_audit.sql.
  const { error: updateError } = await (supabase.from("hiring_submissions") as any)
    .update({ rejected_at: new Date().toISOString(), is_approved: false })
    .eq("id", id);

  if (updateError) {
    console.warn(
      "[admin/reject] soft-delete update failed, falling back to hard delete — has the rejected_at migration been applied?",
      updateError
    );
    const { error: deleteError } = await (supabase.from("hiring_submissions") as any)
      .delete()
      .eq("id", id);

    if (deleteError) {
      return NextResponse.json({ error: "Unable to reject submission." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
