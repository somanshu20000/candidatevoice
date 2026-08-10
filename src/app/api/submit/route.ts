import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
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
import { FACET_KEYS, EMOTION_KEYS, type FacetKey, type EmotionKey } from "@/lib/fingerprint/taxonomy";
import type { ApplicationChannel, ReporterType } from "@/types/index";
import { findOrCreateOpportunity, recordHiringEvents } from "@/lib/hiring-intent/match";
import { buildCandidateEvents } from "@/lib/hiring-intent/events";

const MAX_SUBMISSIONS_PER_HOUR = 5;
const RATE_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/** Absolute ceiling on how many facet ratings a single submission can carry.
 *  The seeded taxonomy has 13 facets today; the cap is loose enough for any
 *  reasonable UI to send everything a user could pick, tight enough that a
 *  crafted payload cannot ask us to insert thousands of rows in one call. */
const MAX_RATINGS_PER_SUBMISSION = 32;
const MAX_EMOTIONS_PER_SUBMISSION = EMOTION_KEYS.length;

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
const VALID_APPLICATION_CHANNELS = ["referral", "recruiter_outreach", "job_board", "company_website", "other"];

interface RatingInput { facet_key: FacetKey; rating: number }
interface EmotionInput { emotion_key: EmotionKey }

/**
 * Validate + de-dupe the ratings array. The DB has both a FK on facet_key
 * and a composite PK (submission_id, facet_key), so an invalid or duplicate
 * facet would abort the whole transaction — including the submission row.
 * Better to reject the request cleanly here with a specific error than to
 * lose the submission over a UI bug. Returns the sanitized array or a
 * message describing exactly what was rejected.
 */
function validateRatings(raw: unknown): { ok: true; value: RatingInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "ratings must be an array" };
  if (raw.length > MAX_RATINGS_PER_SUBMISSION) return { ok: false, error: `too many ratings (max ${MAX_RATINGS_PER_SUBMISSION})` };
  const seen = new Set<string>();
  const out: RatingInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "each rating must be an object" };
    const rec = item as { facet_key?: unknown; rating?: unknown };
    const facet = typeof rec.facet_key === "string" ? rec.facet_key : "";
    const rating = Number(rec.rating);
    if (!(FACET_KEYS as readonly string[]).includes(facet)) return { ok: false, error: `unknown facet_key: ${facet}` };
    if (!Number.isInteger(rating) || rating < 1 || rating > 5) return { ok: false, error: `rating out of range: ${rec.rating}` };
    if (seen.has(facet)) return { ok: false, error: `duplicate facet_key: ${facet}` };
    seen.add(facet);
    out.push({ facet_key: facet as FacetKey, rating });
  }
  return { ok: true, value: out };
}

function validateEmotions(raw: unknown): { ok: true; value: EmotionInput[] } | { ok: false; error: string } {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "emotions must be an array" };
  if (raw.length > MAX_EMOTIONS_PER_SUBMISSION) return { ok: false, error: `too many emotions (max ${MAX_EMOTIONS_PER_SUBMISSION})` };
  const seen = new Set<string>();
  const out: EmotionInput[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return { ok: false, error: "each emotion must be an object" };
    const key = (item as { emotion_key?: unknown }).emotion_key;
    const emo = typeof key === "string" ? key : "";
    if (!(EMOTION_KEYS as readonly string[]).includes(emo)) return { ok: false, error: `unknown emotion_key: ${emo}` };
    if (seen.has(emo)) return { ok: false, error: `duplicate emotion_key: ${emo}` };
    seen.add(emo);
    out.push({ emotion_key: emo as EmotionKey });
  }
  return { ok: true, value: out };
}

/**
 * Optional field — unlike the enum allowlist check above, an ABSENT or empty
 * value is valid (the candidate skipped it). Only a PRESENT-but-unrecognized
 * value is rejected, so a form bug or tampered payload can't silently store
 * garbage into a field the cohort filter later trusts as an enum.
 */
function validateApplicationChannel(raw: unknown): { ok: true; value: ApplicationChannel | null } | { ok: false; error: string } {
  const r = validateOptionalEnum(raw, VALID_APPLICATION_CHANNELS, "application_channel");
  return r.ok ? { ok: true, value: r.value as ApplicationChannel | null } : r;
}

/**
 * Optional-enum validator: absent/empty is VALID and yields null; only a
 * present-but-unrecognized value is an error. Same contract
 * validateApplicationChannel established — generalized so the four
 * compensation-privacy fields (migration 0018) don't each need a clone.
 *
 * null here means "not answered" and stays null all the way to the column, so
 * the Evidence Engine can exclude it. It is NEVER coerced to "never"/"none",
 * which are real answers (see 0018's header).
 */
function validateOptionalEnum(
  raw: unknown,
  allowed: readonly string[],
  field: string
): { ok: true; value: string | null } | { ok: false; error: string } {
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || !allowed.includes(raw)) {
    return { ok: false, error: `unknown ${field}: ${String(raw)}` };
  }
  return { ok: true, value: raw };
}

// Compensation transparency & privacy (migration 0018). Mirrors the CHECK
// constraints; tests/submit-validators.test.ts asserts the three-way sync.
const VALID_SALARY_HISTORY_STAGES = ["never", "application", "screening", "interview", "offer"];
const VALID_SALARY_PROOF_TYPES = ["none", "payslip", "bank_statement", "tax_document"];
const VALID_SALARY_PROOF_STAGES = ["none", "screening", "interview", "before_offer", "after_offer"];
const VALID_SALARY_RANGE_DISCLOSURES = ["in_posting", "before_first", "before_final", "at_offer", "never"];

const SALARY_FIELDS: { key: string; allowed: readonly string[] }[] = [
  { key: "salary_history_stage", allowed: VALID_SALARY_HISTORY_STAGES },
  { key: "salary_proof_type", allowed: VALID_SALARY_PROOF_TYPES },
  { key: "salary_proof_stage", allowed: VALID_SALARY_PROOF_STAGES },
  { key: "salary_range_disclosed", allowed: VALID_SALARY_RANGE_DISCLOSURES },
];

// Tenure stages (migration 0020/0021). Mirrors the CHECK constraints;
// tests/submit-validators.test.ts asserts the three-way sync.
const VALID_REPORTER_TYPES: readonly ReporterType[] = ["candidate", "employee", "former_employee"];
const VALID_EXIT_EXPERIENCE_LETTERS = ["on_time", "delayed", "not_received", "na"];
const VALID_EXIT_SETTLEMENTS = ["on_time", "delayed", "not_received", "na"];
const VALID_EXIT_DOCUMENTATIONS = ["complete", "partial", "none", "na"];
const VALID_WOULD_RECOMMENDS = ["yes", "maybe", "no"];
const VALID_TENURE_BUCKETS = ["0-1", "1-3", "3-5", "5-8", "8+"];
const VALID_CONDUCT_ENVIRONMENTS = ["respectful", "mostly_ok", "some_concerns", "serious_concerns", "na"];

const TENURE_FIELDS: { key: string; allowed: readonly string[] }[] = [
  { key: "exit_experience_letter", allowed: VALID_EXIT_EXPERIENCE_LETTERS },
  { key: "exit_settlement", allowed: VALID_EXIT_SETTLEMENTS },
  { key: "exit_documentation", allowed: VALID_EXIT_DOCUMENTATIONS },
  { key: "would_recommend", allowed: VALID_WOULD_RECOMMENDS },
  { key: "tenure_bucket", allowed: VALID_TENURE_BUCKETS },
  { key: "conduct_environment", allowed: VALID_CONDUCT_ENVIRONMENTS },
];

/**
 * Company identity (migration 0022). This route NEVER resolves an
 * organization from free-text company input and NEVER silently creates one —
 * that was the old resolveOrCreateOrganization behaviour, removed entirely.
 * The client must have already run the confirmation flow
 * (src/lib/company-intelligence/resolve.ts + submit/page.tsx's CompanyPicker):
 * a human clicked "This is the company" on a specific organization_id, or
 * explicitly chose "Company isn't listed."
 *
 * This function only RE-VERIFIES the id the client claims to have confirmed —
 * the displayed candidate list is advisory, this query is truth. A stale or
 * fabricated id fails closed (returns false), not open.
 */
async function verifyOrganizationId(client: SupabaseClient, organizationId: string): Promise<boolean> {
  const { data, error } = await client.from("organizations").select("id").eq("id", organizationId).maybeSingle();
  if (error) return false;
  return data !== null;
}

/**
 * "Company isn't listed" — writes to the moderation queue (company_requests),
 * never to organizations directly. Best-effort: a failure here must never
 * cost the submission it's attached to, same fail-open discipline the old
 * resolveOrCreateOrganization used for organization_id itself.
 */
async function fileCompanyRequest(
  client: SupabaseClient,
  requestedName: string,
  requestedDomain: string | null
): Promise<void> {
  try {
    await client.from("company_requests").insert({
      requested_name: requestedName.slice(0, 200),
      requested_domain: requestedDomain?.slice(0, 200) || null,
    });
  } catch (err) {
    console.error("[api/submit] company_requests insert failed (submission still proceeds):", err);
  }
}

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

    const body = (await req.json()) as SubmissionInsert & {
      ratings?: unknown;
      emotions?: unknown;
      /** Confirmed organization id from the search+confirm flow (0022). */
      organization_id?: unknown;
      company_not_listed?: unknown;
      company_request_domain?: unknown;
      /** Hiring-intent (0023) — the only genuinely new candidate fields;
       *  interview_occurred/candidate_outcome/candidate_follow_up events reuse
       *  stage/outcome/last_interaction_gap already collected above. */
      perceived_seriousness?: unknown;
      intent_reasons?: unknown;
    };

    // Reporter relationship (migration 0020) — absent defaults to 'candidate',
    // matching submit_hiring_report's own coalesce, so an old client that never
    // sends the field keeps working exactly as before.
    const rawReporterType = body.reporter_type;
    const reporterType: ReporterType =
      rawReporterType && (VALID_REPORTER_TYPES as readonly string[]).includes(String(rawReporterType))
        ? (rawReporterType as ReporterType)
        : "candidate";
    const isCandidate = reporterType === "candidate";

    // The 8 interview-only fields (migration 0021 made 4 of them nullable at
    // the DB precisely for this): a candidate report must have real values,
    // exactly as before. An employee/former_employee report never went through
    // an interview process here, so these fields are not required — and are
    // forced to null below regardless of what the client sent, so a stray
    // client-side bug can never write interview data under a non-candidate row.
    if (
      isCandidate &&
      (!VALID_STAGES.includes(String(body.stage ?? "")) ||
        !VALID_OUTCOMES.includes(String(body.outcome ?? "")) ||
        !VALID_RESPONSE_TIME_BUCKETS.includes(String(body.response_time_bucket ?? "")) ||
        !VALID_LAST_INTERACTION_GAPS.includes(String(body.last_interaction_gap ?? "")) ||
        !VALID_CALL_DURATIONS.includes(String(body.call_duration ?? "")) ||
        !VALID_FIRST_INTERACTION_OUTCOMES.includes(String(body.first_interaction_outcome ?? "")) ||
        !VALID_REASONS.includes(String(body.reason ?? "")))
    ) {
      return NextResponse.json({ error: "Invalid field values." }, { status: 400 });
    }
    // experience_bucket applies to every relationship (it's about the reporter,
    // not the interview), so it stays required unconditionally.
    if (!VALID_EXPERIENCE_BUCKETS.includes(String(body.experience_bucket ?? ""))) {
      return NextResponse.json({ error: "Invalid field values." }, { status: 400 });
    }

    const ratingsValidation = validateRatings(body.ratings);
    if (!ratingsValidation.ok) {
      return NextResponse.json({ error: ratingsValidation.error }, { status: 400 });
    }
    const emotionsValidation = validateEmotions(body.emotions);
    if (!emotionsValidation.ok) {
      return NextResponse.json({ error: emotionsValidation.error }, { status: 400 });
    }
    const channelValidation = validateApplicationChannel(body.application_channel);
    if (!channelValidation.ok) {
      return NextResponse.json({ error: channelValidation.error }, { status: 400 });
    }

    // Compensation privacy (0018) — CANDIDATE-KNOWABLE by definition (0018's own
    // header): a question about what was asked during YOUR hiring process has no
    // meaning for someone who never went through one. All optional; absent stays
    // null; forced null outright for a non-candidate report.
    const salaryValues: Record<string, string | null> = {};
    for (const f of SALARY_FIELDS) {
      if (!isCandidate) {
        salaryValues[f.key] = null;
        continue;
      }
      const r = validateOptionalEnum((body as Record<string, unknown>)[f.key], f.allowed, f.key);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      salaryValues[f.key] = r.value;
    }

    // Tenure-stage practices (0020) — all optional, all first-party. Unlike
    // salary, these are collectable from EITHER employee stage (would_recommend,
    // tenure_bucket, conduct_environment are asked of both; the exit_* fields are
    // meaningful only for a leaver but are simply null if a current employee
    // never answers them — no relationship gate needed here, the columns are
    // just questions nobody but the right audience will have an answer to).
    const tenureValues: Record<string, string | null> = {};
    for (const f of TENURE_FIELDS) {
      const r = validateOptionalEnum((body as Record<string, unknown>)[f.key], f.allowed, f.key);
      if (!r.ok) return NextResponse.json({ error: r.error }, { status: 400 });
      tenureValues[f.key] = r.value;
    }

    const payload: SubmissionInsert = {
      company: normalizeCompanySlug(sanitizeAndTruncate(String(body.company ?? ""), 100)),
      role: sanitizeAndTruncate(String(body.role ?? ""), FIELD_LIMITS.ROLE_TITLE),
      experience_bucket: body.experience_bucket,
      reporter_type: reporterType,
      application_channel: isCandidate ? channelValidation.value : null,
      ...salaryValues,
      ...tenureValues,
      stage: isCandidate ? body.stage : null,
      outcome: isCandidate ? body.outcome : null,
      response_time_bucket: isCandidate ? body.response_time_bucket : null,
      last_interaction_gap: isCandidate ? body.last_interaction_gap : null,
      call_duration: isCandidate ? body.call_duration : null,
      first_interaction_outcome: isCandidate ? body.first_interaction_outcome : null,
      reason: isCandidate ? String(body.reason ?? "").trim() : null,
      // payment_flag is NOT NULL at the DB; false is the honest default for a
      // question that doesn't apply outside the candidate flow. The engine's
      // payment_risk dimension also independently gates on reporter_type, so
      // this value is never read for a non-candidate row either way.
      payment_flag: isCandidate ? Boolean(body.payment_flag) : false,
      is_approved: false,
    };

    if (!payload.company || !payload.role || (isCandidate && !payload.reason)) {
      return NextResponse.json({ error: "Missing required fields." }, { status: 400 });
    }

    const supabase = createAdminClient() as unknown as SupabaseClient;

    // Company identity (migration 0022) — never silently resolved or created.
    // Exactly one of these two must be true: the client confirmed a specific
    // organization, or explicitly said it isn't listed. Anything else is
    // rejected — this is the server-side half of "never silently choose,"
    // enforceable even if the submit UI's own guard were ever bypassed.
    const rawOrgId = typeof body.organization_id === "string" ? body.organization_id : null;
    const notListed = body.company_not_listed === true;
    if (!rawOrgId && !notListed) {
      return NextResponse.json({ error: "Please confirm the company before submitting." }, { status: 400 });
    }
    if (rawOrgId) {
      // Re-verify. The candidate list the client saw is advisory; this query
      // is truth — a stale, tampered, or fabricated id is rejected outright
      // rather than silently falling back to null.
      const valid = await verifyOrganizationId(supabase, rawOrgId);
      if (!valid) {
        return NextResponse.json({ error: "That company could not be verified. Please search again." }, { status: 400 });
      }
      payload.organization_id = rawOrgId;
    } else {
      payload.organization_id = null;
      // Best-effort, non-blocking — uses the ORIGINAL typed text (before slug
      // normalization) so a moderator sees "Anemoi Technologies", not
      // "anemoi-technologies".
      const requestedName = sanitizeAndTruncate(String(body.company ?? ""), 100);
      const requestedDomain = typeof body.company_request_domain === "string" ? body.company_request_domain : null;
      await fileCompanyRequest(supabase, requestedName, requestedDomain);
    }

    // Atomic write via migration 0013's RPC — submission + ratings + emotions
    // in one transaction, so a Family B insert failure never leaves an
    // orphaned Family A row behind (or vice versa). Cast because the RPC is
    // not in the hand-authored Database type.
    const { data: submissionId, error } = await (supabase as unknown as SupabaseClient).rpc("submit_hiring_report", {
      p_submission: payload,
      p_ratings: ratingsValidation.value,
      p_emotions: emotionsValidation.value,
    });

    if (error) {
      return NextResponse.json({ error: "Unable to submit right now." }, { status: 500 });
    }

    // Hiring-intent events (0023) — candidate-only, and only when a REAL
    // organization was confirmed (the "isn't listed" path has no opportunity
    // to attach to). Reuses stage/outcome/last_interaction_gap already
    // validated above rather than asking for them twice; perceived_seriousness
    // and intent_reasons are the only genuinely new fields. Best-effort: a
    // failure here must never cost the submission that already succeeded.
    if (isCandidate && payload.organization_id && typeof submissionId === "string") {
      const opportunityId = await findOrCreateOpportunity(supabase, payload.organization_id, payload.role);
      if (opportunityId) {
        const reportedMonth = new Date().toISOString().slice(0, 7); // YYYY-MM, same coarsening as public_submissions
        const events = buildCandidateEvents({
          stage: payload.stage,
          perceivedSeriousness: typeof body.perceived_seriousness === "string" ? body.perceived_seriousness : null,
          intentReasons: Array.isArray(body.intent_reasons) ? body.intent_reasons.filter((r): r is string => typeof r === "string") : [],
          outcome: payload.outcome,
          lastContactGap: payload.last_interaction_gap,
          submissionId,
          reportedMonth,
        });
        // Every candidate report that attaches to an opportunity leaves at
        // least this one event, even if every optional signal above was
        // skipped — the timeline should never look empty for a real report.
        events.unshift({ actorType: "candidate", eventType: "role_reported", payload: {}, submissionId, reportedMonth });
        await recordHiringEvents(supabase, opportunityId, events);
      }
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
