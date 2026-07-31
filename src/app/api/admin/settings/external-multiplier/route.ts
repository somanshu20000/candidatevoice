import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { getGlobalExternalMultiplier, setGlobalExternalMultiplier } from "@/lib/hiring-intel/settings";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The Global Bootstrap Multiplier — read and set operationally, no redeploy.
 * GET returns the current value; PUT changes it. Both are admin-only.
 */
export async function GET(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }
  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const value = await getGlobalExternalMultiplier(supabase);
    return NextResponse.json({ value });
  } catch (err) {
    console.error("[admin/settings/external-multiplier GET]", err);
    return NextResponse.json({ error: "Unable to read the multiplier." }, { status: 500 });
  }
}

export async function PUT(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { value?: unknown } | null;
  const value = typeof body?.value === "number" ? body.value : Number(body?.value);
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    return NextResponse.json(
      { error: "value must be a number between 0 and 1 (0 = first-party only)." },
      { status: 400 }
    );
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    await setGlobalExternalMultiplier(supabase, value, "admin");
    return NextResponse.json({ ok: true, value });
  } catch (err) {
    console.error("[admin/settings/external-multiplier PUT]", err);
    return NextResponse.json({ error: "Unable to update the multiplier." }, { status: 500 });
  }
}
