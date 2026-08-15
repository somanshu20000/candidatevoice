import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { promoteCompanyRequest } from "@/lib/company-intelligence/requests";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function POST(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { id?: string } | null;
  const id = body?.id?.trim();
  if (!id) {
    return NextResponse.json({ error: "Missing request id." }, { status: 400 });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const result = await promoteCompanyRequest(supabase, id);
    if (!result.ok) {
      return NextResponse.json(
        { error: result.error, existingOrganizationId: result.existingOrganizationId },
        { status: 409 }
      );
    }
    return NextResponse.json({ ok: true, organizationId: result.organizationId, slug: result.slug });
  } catch (err) {
    console.error("[admin/company-requests/promote]", err);
    return NextResponse.json({ error: "Unable to promote company request." }, { status: 500 });
  }
}
