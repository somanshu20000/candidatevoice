import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import type { Database } from "@/types/database";
import {
  addCompanyToUnlockedCompanies,
  COOKIE_NAME,
  decodeUnlockedCompaniesCookie,
  encodeUnlockedCompaniesCookie,
  getUnlockCookieOptions,
  normalizeCompanySlug,
} from "@/lib/unlock-cookie";
import { sanitizeAndTruncate, FIELD_LIMITS } from "@/utils/sanitize";
import { checkAndRecordRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

const MAX_SUBMISSIONS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

type SubmissionInsert = Database["public"]["Tables"]["hiring_submissions"]["Insert"];

// Enum allowlists — must stay in sync with submit/page.tsx dropdowns and types/index.ts
const VALID_STAGES = ["applied", "screening", "technical", "hr", "final"];
const VALID_OUTCOMES = ["rejected", "no_response", "offer", "ongoing"];
const VALID_EXPERIENCE_BUCKETS = ["0-1", "1-3", "3-5", "5-8", "8+"];
const VALID_RESPONSE_TIME_BUCKETS = ["0-3", "4-7", "8-14", "15+"];
const VALID_LAST_INTERACTION_GAPS = ["0-7", "8-14", "15-30", "30+"];
const VALID_CALL_DURATIONS = ["<2", "2-5", "5-15", "15+", "na"];
const VALID_FIRST_INTERACTION_OUTCOMES = ["continued", "rejected_immediately", "na"];
const VALID_REASONS = ["experience_mismatch", "skill_mismatch", "culture_fit", "no_reason", "other"];

export async function POST(req: NextRequest) {
  try {
    const ip = getClientIp(req);
    const limited = await checkAndRecordRateLimit(
      "submit",
      ip,
      MAX_SUBMISSIONS_PER_HOUR,
      RATE_LIMIT_WINDOW_MS
    );
    if (limited) {
      return NextResponse.json(
        { error: "Too many submissions from this IP. Please try again later." },
        { status: 429 }
      );
    }

    const body = (await req.json()) as SubmissionInsert;

    // Server-side enum validation — reject anything not in the known set
    if (
      !VALID_STAGES.includes(String(body.stage ?? "")) ||
      !VALID_OUTCOMES.includes(String(body.outcome ?? "")) ||
      !VALID_EXPERIENCE_BUCKETS.includes(String(body.experience_bucket ?? "")) ||
      !VALID_RESPONSE_TIME_BUCKETS.includes(String(body.response_time_bucket ?? "")) ||
      !VALID_LAST_INTERACTION_GAPS.includes(String(body.last_interaction_gap ?? "")) ||
      !VALID_CALL_DURATIONS.includes(String(body.call_duration ?? "")) ||
      !VALID_FIRST_INTERACTION_OUTCOMES.includes(String(body.first_interaction_outcome ?? "")) ||
      !VALID_REASONS.includes(String(body.reason ?? ""))
    ) {
      return NextResponse.json({ error: "Invalid field values." }, { status: 400 });
    }

    const payload: SubmissionInsert = {
      company: normalizeCompanySlug(sanitizeAndTruncate(String(body.company ?? ""), 100)),
      role: sanitizeAndTruncate(String(body.role ?? ""), FIELD_LIMITS.ROLE_TITLE),
      experience_bucket: body.experience_bucket,
      stage: body.stage,
      outcome: body.outcome,
      response_time_bucket: body.response_time_bucket,
      last_interaction_gap: body.last_interaction_gap,
      call_duration: body.call_duration,
      first_interaction_outcome: body.first_interaction_outcome,
      reason: String(body.reason ?? "").trim(),
      payment_flag: Boolean(body.payment_flag),
      is_approved: false,
    };

    if (!payload.company || !payload.role || !payload.reason) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const supabase = createAdminClient();
    const { error } = await (supabase.from("hiring_submissions") as any).insert([payload]);

    if (error) {
      return NextResponse.json({ error: "Unable to submit right now." }, { status: 500 });
    }

    const existingRaw = req.cookies.get(COOKIE_NAME)?.value;
    const existing = decodeUnlockedCompaniesCookie(existingRaw);
    const next = addCompanyToUnlockedCompanies(existing, payload.company);
    const encoded = encodeUnlockedCompaniesCookie(next);
    if (!encoded) {
      return NextResponse.json({ error: "COOKIE_SECRET is not configured." }, { status: 500 });
    }

    const res = NextResponse.json({ ok: true });
    res.cookies.set(COOKIE_NAME, encoded, getUnlockCookieOptions());
    return res;
  } catch {
    return NextResponse.json({ error: "Invalid request payload." }, { status: 400 });
  }
}
