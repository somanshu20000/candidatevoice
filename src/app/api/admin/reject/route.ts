import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";

export async function POST(req: NextRequest) {
  const auth = isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing submission id." }, { status: 400 });
  }

  const supabase = createAdminClient();
  const { error } = await (supabase.from("hiring_submissions") as any).delete().eq("id", id);

  if (error) {
    return NextResponse.json({ error: "Unable to reject submission." }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
