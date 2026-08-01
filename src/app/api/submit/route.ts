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
import type { ApplicationChannel } from "@/types/index";

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
  if (raw === undefined || raw === null || raw === "") return { ok: true, value: null };
  if (typeof raw !== "string" || !VALID_APPLICATION_CHANNELS.includes(raw)) {
    return { ok: false, error: `unknown application_channel: ${String(raw)}` };
  }
  return { ok: true, value: raw as ApplicationChannel };
}

/**
 * Resolve the submitted company slug to a canonical organization, creating one
 * if this is the first time this employer has ever been observed.
 *
 * WHY THIS EXISTS. Until now this route never set organization_id, so every
 * new first-party submission had it NULL — meanwhile external_reports resolves
 * it at import time. The two evidence families keyed on different identifiers
 * and could not be joined (see docs/adr-0002-evidence-engine.md, blocker B2).
 * The Evidence Engine joins first-party and external evidence by
 * organization_id; this is the fix at the source.
 *
 * organizations is not in the hand-authored Database type (same reason as
 * src/lib/company-intelligence and src/lib/hiring-intel cast their clients),
 * so `client` is typed as the untyped SupabaseClient the caller casts to.
 *
 * FAIL-OPEN BY DESIGN. organization_id has always been nullable specifically
 * so a resolution hiccup can never cost a submission (see 0002_organizations.sql:
 * "Nullable on purpose... nothing is invisible while unresolved"). Any error
 * here is swallowed and returns null — the row still gets saved with its raw
 * `company` slug intact, evidence is never dropped over this.
 *
 * Mirrors createSupabaseCompanyStore.createOrganization in
 * src/lib/company-intelligence/store.ts: upsert with ignoreDuplicates guards
 * the race where two submissions for a brand-new employer arrive at once.
 */
async function resolveOrCreateOrganization(client: SupabaseClient, rawSlug: string): Promise<string | null> {
  try {
    const resolved = await client.rpc("resolve_organization", { p_slug: rawSlug });
    if (resolved.error) throw resolved.error;
    if (resolved.data) return resolved.data as string;

    // No existing organization matches this slug, even canonicalized — this is
    // the first time this employer name has been observed. Create it at its
    // canonical slug, exactly as the Company Intelligence importer would.
    const canonicalized = await client.rpc("canonicalize_slug", { p_slug: rawSlug });
    if (canonicalized.error) throw canonicalized.error;
    const canonicalSlug = canonicalized.data as string | null;
    // A slug that canonicalizes to empty (pure punctuation/symbols) cannot back
    // an organizations row — organizations_slug_length requires length >= 1.
    if (!canonicalSlug) return null;

    const displayName = canonicalSlug
      .split("-")
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(" ");

    const { error: upsertError } = await client
      .from("organizations")
      .upsert({ slug: canonicalSlug, display_name: displayName }, { onConflict: "slug", ignoreDuplicates: true });
    if (upsertError) throw upsertError;

    const { data: org, error: selectError } = await client
      .from("organizations")
      .select("id")
      .eq("slug", canonicalSlug)
      .maybeSingle();
    if (selectError) throw selectError;
    if (!org) return null;

    // Record the as-submitted spelling as an alias if it differs from the
    // canonical slug, so a future submission with this exact spelling resolves
    // on branch 1 of resolve_organization() rather than falling through to
    // re-canonicalizing every time. Best-effort — never blocks the submission.
    if (rawSlug !== canonicalSlug) {
      await client
        .from("organization_aliases")
        .upsert(
          { alias_slug: rawSlug, organization_id: org.id, alias_source: "observed" },
          { onConflict: "alias_slug", ignoreDuplicates: true }
        );
    }

    return org.id as string;
  } catch (err) {
    console.error("[api/submit] organization resolution failed, submitting with organization_id=null:", err);
    return null;
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

    const body = (await req.json()) as SubmissionInsert & { ratings?: unknown; emotions?: unknown };

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

    const payload: SubmissionInsert = {
      company: normalizeCompanySlug(sanitizeAndTruncate(String(body.company ?? ""), 100)),
      role: sanitizeAndTruncate(String(body.role ?? ""), FIELD_LIMITS.ROLE_TITLE),
      experience_bucket: body.experience_bucket,
      application_channel: channelValidation.value,
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
    payload.organization_id = await resolveOrCreateOrganization(supabase as unknown as SupabaseClient, payload.company);

    // Atomic write via migration 0013's RPC — submission + ratings + emotions
    // in one transaction, so a Family B insert failure never leaves an
    // orphaned Family A row behind (or vice versa). Cast because the RPC is
    // not in the hand-authored Database type — same pattern as
    // resolveOrCreateOrganization above.
    const { error } = await (supabase as unknown as SupabaseClient).rpc("submit_hiring_report", {
      p_submission: payload,
      p_ratings: ratingsValidation.value,
      p_emotions: emotionsValidation.value,
    });

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
