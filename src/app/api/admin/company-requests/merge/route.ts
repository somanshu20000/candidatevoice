import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { mergeCompanyRequest } from "@/lib/company-intelligence/requests";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { id?: string; organizationId?: string } | null;
  const id = body?.id?.trim();
  const organizationId = body?.organizationId?.trim();
  if (!id || !organizationId) {
    return NextResponse.json({ error: "Missing request id or organizationId." }, { status: 400 });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const result = await mergeCompanyRequest(supabase, id, organizationId);
    if (!result.ok) {
      return NextResponse.json({ error: result.error }, { status: 409 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[admin/company-requests/merge]", err);
    return NextResponse.json({ error: "Unable to merge company request." }, { status: 500 });
  }
}
