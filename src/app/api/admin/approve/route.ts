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

  // Clear rejected_at on approve so a previously-rejected row can never end
  // up publicly visible (is_approved=true) while still flagged as rejected —
  // approve and reject must keep is_approved/rejected_at mutually consistent.
  // Falls back to the plain update if rejected_at doesn't exist yet
  // (migration not applied) — see
  // supabase/migrations/0001_rate_limit_and_moderation_audit.sql.
  const { error: updateError } = await (supabase.from("hiring_submissions") as any)
    .update({ is_approved: true, rejected_at: null })
    .eq("id", id);

  if (updateError) {
    console.warn(
      "[admin/approve] update with rejected_at failed, falling back — has the rejected_at migration been applied?",
      updateError
    );
    const { error: fallbackError } = await (supabase.from("hiring_submissions") as any)
      .update({ is_approved: true })
      .eq("id", id);

    if (fallbackError) {
      return NextResponse.json({ error: "Unable to approve submission." }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
