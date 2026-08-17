/**
 * Manual trigger for the acquisition pipeline (requirement: admin can run it
 * without a developer running scripts by hand). Thin wrapper around
 * runAcquisition() — all real logic lives there, shared with the cron route.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { isAuthorizedAdmin } from "@/app/api/admin/_utils";
import { runAcquisition, ADAPTERS } from "@/lib/external-intel/orchestrator";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const auth = await isAuthorizedAdmin(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await req.json().catch(() => null)) as { companyQuery?: string; sourceKey?: string; variant?: string } | null;
  const companyQuery = body?.companyQuery?.trim();
  const sourceKey = body?.sourceKey?.trim();
  if (!companyQuery) {
    return NextResponse.json({ error: "companyQuery is required." }, { status: 400 });
  }
  if (!sourceKey || !ADAPTERS[sourceKey]) {
    return NextResponse.json({ error: `sourceKey must be one of: ${Object.keys(ADAPTERS).join(", ")}` }, { status: 400 });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;
    const result = await runAcquisition({
      supabase,
      companyQuery,
      sourceKey,
      triggeredBy: "manual",
      adapterInput: body?.variant ? { variant: body.variant } : undefined,
    });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[admin/external/acquire]", err);
    return NextResponse.json({ error: "Acquisition run failed to start." }, { status: 500 });
  }
}
