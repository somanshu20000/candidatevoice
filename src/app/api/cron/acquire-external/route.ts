/**
 * Scheduled acquisition trigger (requirement #5: "continuously acquire new
 * data without a developer manually running scripts"). Vercel Cron calls
 * this on the schedule in vercel.json; Vercel automatically sends
 * `Authorization: Bearer $CRON_SECRET` on cron-triggered requests when
 * CRON_SECRET is set, which is what this route verifies (the same
 * shared-secret pattern ADMIN_SECRET already uses elsewhere in this app).
 *
 * ONLY ever uses the REAL 'reddit' source, never 'demo' — the demo adapter
 * exists for deliberate, controlled exercises (admin trigger, tests), never
 * to auto-attach fabricated-looking content to a real company's moderation
 * queue. If Reddit's credentials are not genuinely valid (checked with a
 * real OAuth round trip, not inferred), every candidate is skipped and
 * recorded as such — never silently retried into a fake success.
 */
import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { runAcquisition } from "@/lib/external-intel/orchestrator";
import { checkRedditCredentials } from "@/lib/external-intel/adapters/reddit";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const maxDuration = 300;

const BATCH_SIZE = 5;

function isAuthorizedCron(req: NextRequest): { ok: boolean; error?: string } {
  const secret = process.env.CRON_SECRET;
  if (!secret) return { ok: false, error: "CRON_SECRET is not configured." };
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${secret}`) return { ok: false, error: "Unauthorized." };
  return { ok: true };
}

export async function GET(req: NextRequest) {
  const auth = isAuthorizedCron(req);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.error?.includes("not configured") ? 500 : 401 });
  }

  const credCheck = await checkRedditCredentials();
  if (!credCheck.ok) {
    return NextResponse.json({
      skipped: true,
      reason: `reddit credentials not usable: ${credCheck.reason}`,
      ran: 0,
    });
  }

  try {
    const supabase = createAdminClient() as unknown as SupabaseClient;

    // Companies with zero external_reports at all — the honest "sparse
    // evidence" candidate set for a first pass. organizations has no
    // external_reports count column, so this is two queries: recent
    // organizations, minus ones that already have at least one row.
    const { data: orgs, error: orgsErr } = await supabase
      .from("organizations")
      .select("id, display_name")
      .order("created_at", { ascending: false })
      .limit(50);
    if (orgsErr) throw new Error(orgsErr.message);

    const { data: covered } = await supabase.from("external_reports").select("organization_id").not("organization_id", "is", null);
    const coveredIds = new Set(((covered ?? []) as { organization_id: string }[]).map((r) => r.organization_id));

    const candidates = ((orgs ?? []) as { id: string; display_name: string }[])
      .filter((o) => !coveredIds.has(o.id))
      .slice(0, BATCH_SIZE);

    const results = [];
    for (const org of candidates) {
      const result = await runAcquisition({
        supabase,
        companyQuery: org.display_name,
        sourceKey: "reddit",
        triggeredBy: "cron",
      });
      results.push({ organization: org.display_name, ...result });
    }

    return NextResponse.json({ skipped: false, ran: results.length, results });
  } catch (err) {
    console.error("[cron/acquire-external]", err);
    return NextResponse.json({ error: "Cron acquisition run failed." }, { status: 500 });
  }
}
