/**
 * seed-realistic-dataset.ts — production-quality synthetic seed data for
 * exercising the COMPLETE CandidateVoice product: search, company pages,
 * evidence confidence/suppression gates, compare, advisor, moderation queue,
 * and the external-acquisition pipeline's data shapes.
 *
 * SAFETY MODEL (read before running):
 *   - First-party (hiring_submissions) rows are attributed to CLEARLY
 *     FICTIONAL company names, never a real employer. Unlike external
 *     reports, hiring_submissions has no source/enabled kill-switch (D-013's
 *     "demo data must never reach production as real evidence" rule), so the
 *     safe design is: never let synthetic first-party content be mistaken
 *     for a real company's evidence, by construction of the company name
 *     itself — not by a flag someone could miss.
 *   - Written through the REAL submit_hiring_report RPC (same triggers,
 *     same immutability guard) — never a raw INSERT into hiring_submissions.
 *   - External reports are attributed to the EXISTING `demo` external_sources
 *     row (migration demo_external_source): enabled=false PERMANENTLY, so a
 *     demo external_reports row can never reach public_external_reports
 *     regardless of moderation status — the same structural guarantee
 *     scripts/demo-seed.ts already relies on. Content hashed with the exact
 *     canonical algorithm src/lib/hiring-intel/normalize.ts uses, so a
 *     second run against the same logical record is a true no-op, not a
 *     duplicate — this script replicates that pure hashing function inline
 *     rather than importing the pipeline modules, to stay fully
 *     self-contained and independent of in-flight collaborator changes to
 *     src/lib/hiring-intel/{store,types}.ts.
 *   - external_acquisition_runs rows use source_key='demo' and status values
 *     from the real CHECK constraint, modeling a realistic pipeline trace
 *     (queued -> fetching -> extracted -> awaiting_moderation/completed).
 *   - Idempotent: organizations/company_requests/external_reports are all
 *     upserted or existence-checked by a stable natural key, so re-running
 *     this script is safe and does not create duplicates. hiring_submissions
 *     rows are the one exception (no natural key — a report has none by
 *     design, ADR-0001) and ARE created fresh each run; this is intentional
 *     for hiring_submissions (immutable once written) but means running this
 *     script twice doubles first-party evidence counts. Use --dry-run first.
 *
 * Usage:
 *   tsx scripts/seed-realistic-dataset.ts --dry-run
 *   tsx scripts/seed-realistic-dataset.ts --confirm
 */
import { createHash, randomUUID } from "crypto";
import { loadEnv, adminClient, parseArgs, c } from "./_shared";

loadEnv();

// --- Deterministic PRNG (mirrors scripts/demo-seed.ts's mulberry32) --------
function mulberry32(seed: number) {
  let a = seed >>> 0;
  return function rand() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function pick<T>(rand: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rand() * arr.length)];
}
function weighted<T extends string>(rand: () => number, table: [T, number][]): T {
  const total = table.reduce((s, [, w]) => s + w, 0);
  let r = rand() * total;
  for (const [value, w] of table) {
    r -= w;
    if (r <= 0) return value;
  }
  return table[table.length - 1][0];
}
function monthsAgo(rand: () => number, n: number): string {
  const now = new Date();
  const back = Math.floor(rand() * n);
  const d = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
function slugify(name: string): string {
  return name.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
}

// Same canonical field order as src/lib/hiring-intel/normalize.ts's
// hashContent — a literal copy of the pure algorithm, not an import, per the
// self-containment note above.
function hashExternalContent(fields: {
  companySlug: string; role: string; experienceBucket: string; stage: string;
  outcome: string; responseTimeBucket: string; lastInteractionGap: string;
  reason: string; paymentFlag: string; reportedMonth: string;
}): string {
  const canonical = [
    fields.companySlug, fields.role, fields.experienceBucket, fields.stage,
    fields.outcome, fields.responseTimeBucket, fields.lastInteractionGap,
    fields.reason, fields.paymentFlag, fields.reportedMonth,
  ].join("");
  return createHash("sha256").update(canonical).digest("hex");
}

// --- Vocabulary (mirrors src/lib/fingerprint/taxonomy.ts / types/index.ts) -
const STAGES = ["applied", "screening", "technical", "hr", "final"] as const;
const OUTCOMES = ["rejected", "no_response", "offer", "ongoing"] as const;
const EXPERIENCE_BUCKETS = ["0-1", "1-3", "3-5", "5-8", "8+"] as const;
const RESPONSE_TIME_BUCKETS = ["0-3", "4-7", "8-14", "15+"] as const;
const LAST_INTERACTION_GAPS = ["0-7", "8-14", "15-30", "30+"] as const;
const REASONS = ["experience_mismatch", "skill_mismatch", "culture_fit", "no_reason", "other"] as const;
const OUTREACH_QUALITIES = ["profile_reviewed_relevant", "generic_outreach", "obvious_mismatch"] as const;
const SENSITIVE_INFO = ["none", "aadhaar", "pan", "bank_details", "salary_slips", "other"] as const;
const SENSITIVE_INFO_STAGES = ["screening", "interview", "before_offer", "after_offer"] as const;
const WOULD_RECOMMEND = ["yes", "maybe", "no"] as const;
const CONDUCT = ["respectful", "mostly_ok", "some_concerns", "serious_concerns", "na"] as const;
const CULTURE_THEME_KEYS = [
  "supportive_managers", "transparent_communication", "good_work_life_balance",
  "learning_opportunities", "clear_career_growth", "recognizes_contributions",
  "collaborative_teams", "high_autonomy", "long_hours_expected",
  "high_pressure_deadlines", "frequent_reorgs", "bureaucratic_processes",
  "unclear_expectations", "limited_growth_paths",
] as const;
const VERIFICATION_TIERS = ["unverified", "inbox_verified", "contact_domain", "attested"] as const;
// Hiring channel + payment attribution (migration 0037, D-037).
const HIRING_CHANNELS = ["company_direct", "consultancy_agency", "referral", "other"] as const;
const PAYMENT_REQUESTED_BY = ["company", "consultancy_agency", "other", "not_sure"] as const;
const DEMO_ROLES = ["Software Engineer", "Product Manager", "Data Analyst", "UX Designer", "DevOps Engineer", "Account Manager", "Operations Lead"];

// --- Demo organizations (fictional, realistic-styled, never a real employer)
interface OrgProfile {
  name: string;
  archetype: string;
  /** How many candidate (interview) reports to generate. */
  candidateCount: number;
  /** How many employee/former_employee reports to generate. */
  employeeCount: number;
  /** Outcome weighting: 'strong' (mostly offers, fast), 'weak' (mostly ghosted/rejected),
   *  'mixed' (genuinely conflicting), 'balanced' (realistic middle). */
  tenor: "strong" | "weak" | "mixed" | "balanced";
  /** Share of generated rows to leave is_approved=false (moderation queue demo). */
  pendingShare: number;
  /** Whether to vary verification_tier across rows (metadata-only demo). */
  varyVerificationTier?: boolean;
}

const ORG_PROFILES: OrgProfile[] = [
  { name: "Verdant Softworks", archetype: "large enterprise / SaaS", candidateCount: 16, employeeCount: 3, tenor: "strong", pendingShare: 0 },
  { name: "Presidio Cloud Systems", archetype: "large enterprise / technology", candidateCount: 14, employeeCount: 2, tenor: "strong", pendingShare: 0 },
  { name: "Aarohi Fintech Labs", archetype: "mid-market / fintech", candidateCount: 8, employeeCount: 0, tenor: "mixed", pendingShare: 0 },
  { name: "NimbusCart Retail", archetype: "mid-market / e-commerce", candidateCount: 3, employeeCount: 0, tenor: "balanced", pendingShare: 0 },
  { name: "Solstice Manufacturing", archetype: "manufacturing / services", candidateCount: 2, employeeCount: 0, tenor: "balanced", pendingShare: 0 },
  { name: "Kestrel Consulting Group", archetype: "consulting", candidateCount: 0, employeeCount: 0, tenor: "balanced", pendingShare: 0 },
  { name: "Meridian Media Networks", archetype: "media", candidateCount: 4, employeeCount: 6, tenor: "balanced", pendingShare: 0 },
  { name: "Tarang Startup Labs", archetype: "startup", candidateCount: 5, employeeCount: 0, tenor: "balanced", pendingShare: 0 },
  { name: "Bridgeview Consulting India", archetype: "consulting", candidateCount: 10, employeeCount: 0, tenor: "balanced", pendingShare: 0.9 },
  { name: "Orchid Financial Services", archetype: "fintech / insurance", candidateCount: 9, employeeCount: 0, tenor: "mixed", pendingShare: 0 },
  { name: "Copper Peak Manufacturing", archetype: "manufacturing / services", candidateCount: 6, employeeCount: 0, tenor: "balanced", pendingShare: 0, varyVerificationTier: true },
  { name: "Silverline Insurance Co", archetype: "mid-market / financial services", candidateCount: 7, employeeCount: 0, tenor: "balanced", pendingShare: 0 },
];

interface SubmissionPayload {
  company: string;
  organization_id: string;
  role: string;
  experience_bucket: string;
  reporter_type: "candidate" | "employee" | "former_employee";
  stage?: string; outcome?: string; response_time_bucket?: string; last_interaction_gap?: string;
  reason?: string; payment_flag?: boolean;
  outreach_quality?: string; sensitive_info_requested?: string; sensitive_info_stage?: string;
  would_recommend?: string; conduct_environment?: string; tenure_bucket?: string;
  verification_tier?: string;
  hiring_channel?: string; payment_requested_by?: string;
  is_approved: boolean;
}

function tenorOutcomeTable(tenor: OrgProfile["tenor"]): [(typeof OUTCOMES)[number], number][] {
  switch (tenor) {
    case "strong": return [["offer", 45], ["ongoing", 25], ["rejected", 25], ["no_response", 5]];
    case "weak": return [["no_response", 45], ["rejected", 35], ["offer", 10], ["ongoing", 10]];
    case "mixed": return [["offer", 25], ["no_response", 30], ["rejected", 30], ["ongoing", 15]];
    default: return [["rejected", 40], ["offer", 25], ["no_response", 20], ["ongoing", 15]];
  }
}

function generateCandidateRow(rand: () => number, org: { name: string; id: string }, profile: OrgProfile, i: number): SubmissionPayload {
  const outcome = weighted(rand, tenorOutcomeTable(profile.tenor));
  const lastInteractionGap = outcome === "no_response"
    ? weighted(rand, [["15-30", 45], ["30+", 40], ["8-14", 15]] as [(typeof LAST_INTERACTION_GAPS)[number], number][])
    : weighted(rand, [["0-7", 40], ["8-14", 30], ["15-30", 20], ["30+", 10]] as [(typeof LAST_INTERACTION_GAPS)[number], number][]);
  const wasContactedFirst = rand() < 0.4;
  const payload: SubmissionPayload = {
    company: org.name, organization_id: org.id, role: pick(rand, DEMO_ROLES),
    experience_bucket: pick(rand, EXPERIENCE_BUCKETS), reporter_type: "candidate",
    stage: pick(rand, STAGES), outcome, response_time_bucket: pick(rand, RESPONSE_TIME_BUCKETS),
    last_interaction_gap: lastInteractionGap,
    reason: outcome === "rejected" ? pick(rand, REASONS) : "no_reason",
    payment_flag: rand() < (profile.tenor === "mixed" ? 0.15 : 0.03),
    is_approved: rand() >= profile.pendingShare,
  };
  if (wasContactedFirst) payload.outreach_quality = pick(rand, OUTREACH_QUALITIES);
  if (rand() < 0.25) {
    payload.sensitive_info_requested = pick(rand, SENSITIVE_INFO);
    if (payload.sensitive_info_requested !== "none") payload.sensitive_info_stage = pick(rand, SENSITIVE_INFO_STAGES);
  }
  // Hiring channel + payment attribution (migration 0037, D-037). ~30% left
  // unanswered ("prefer not to say") — same optionality shape as
  // outreach_quality/sensitive_info above — so the seed exercises both the
  // answered and unanswered-excluded-from-metrics paths. payment_requested_by
  // is only ever set when payment_flag is true (mirrors the route's own gate)
  // and itself has a real chance of staying unanswered, covering the
  // "payment requested, unsure by whom" edge case explicitly.
  if (rand() < 0.7) payload.hiring_channel = pick(rand, HIRING_CHANNELS);
  if (payload.payment_flag && rand() < 0.6) payload.payment_requested_by = pick(rand, PAYMENT_REQUESTED_BY);
  if (profile.varyVerificationTier) payload.verification_tier = VERIFICATION_TIERS[i % VERIFICATION_TIERS.length];
  return payload;
}

function generateEmployeeRow(rand: () => number, org: { name: string; id: string }, profile: OrgProfile): { payload: SubmissionPayload; themes: string[] } {
  const reporterType = rand() < 0.5 ? "employee" : "former_employee";
  const recommend = weighted(rand, profile.tenor === "strong" ? [["yes", 60], ["maybe", 30], ["no", 10]] : [["yes", 30], ["maybe", 40], ["no", 30]] as [(typeof WOULD_RECOMMEND)[number], number][]);
  const payload: SubmissionPayload = {
    company: org.name, organization_id: org.id, role: pick(rand, DEMO_ROLES),
    experience_bucket: pick(rand, EXPERIENCE_BUCKETS), reporter_type: reporterType,
    would_recommend: recommend, conduct_environment: pick(rand, CONDUCT), tenure_bucket: pick(rand, EXPERIENCE_BUCKETS),
    is_approved: rand() >= profile.pendingShare,
  };
  const themeCount = 1 + Math.floor(rand() * 3);
  const themes = new Set<string>();
  while (themes.size < themeCount) themes.add(pick(rand, CULTURE_THEME_KEYS));
  return { payload, themes: [...themes] };
}

async function main() {
  const { flags } = parseArgs(process.argv.slice(2));
  const dryRun = flags.has("dry-run") && !flags.has("confirm");
  if (!flags.has("confirm") && !flags.has("dry-run")) {
    console.error(c.red("Refusing to run without --confirm or --dry-run (this writes to the live database)."));
    process.exit(2);
  }

  const supabase = adminClient();
  const rand = mulberry32(20260822);
  const summary = { orgsCreated: 0, orgsExisting: 0, submissions: 0, approved: 0, pending: 0, cultureThemeSelections: 0, companyRequests: 0, externalReports: 0, externalReportsSkipped: 0, acquisitionRuns: 0 };

  console.log(c.dim(dryRun ? "DRY RUN — no writes will be made.\n" : "LIVE RUN — writing to the connected Supabase project.\n"));

  // --- 1. Organizations (idempotent: skip if slug already exists) ---------
  const orgIds = new Map<string, string>();
  for (const profile of ORG_PROFILES) {
    const slug = slugify(profile.name);
    const { data: existing } = await supabase.from("organizations").select("id").eq("slug", slug).maybeSingle();
    if (existing) {
      orgIds.set(profile.name, (existing as { id: string }).id);
      summary.orgsExisting++;
      continue;
    }
    if (dryRun) {
      orgIds.set(profile.name, `dry-run-${slug}`);
      summary.orgsCreated++;
      continue;
    }
    const { data, error } = await supabase.from("organizations").insert({ slug, display_name: profile.name }).select("id").single();
    if (error || !data) {
      console.error(c.red(`  failed to create organization "${profile.name}": ${error?.message}`));
      continue;
    }
    orgIds.set(profile.name, (data as { id: string }).id);
    summary.orgsCreated++;
  }
  console.log(c.green(`✓ organizations: ${summary.orgsCreated} created, ${summary.orgsExisting} already existed (${ORG_PROFILES.map((o) => o.archetype).join(" · ")})`));

  // --- 2. hiring_submissions via the REAL submit_hiring_report RPC --------
  if (!dryRun) {
    for (const profile of ORG_PROFILES) {
      const id = orgIds.get(profile.name);
      if (!id) continue;
      const org = { name: profile.name, id };

      for (let i = 0; i < profile.candidateCount; i++) {
        const payload = generateCandidateRow(rand, org, profile, i);
        const { data: subId, error } = await supabase.rpc("submit_hiring_report", { p_submission: payload });
        if (error) { console.error(c.red(`  candidate row failed for ${profile.name}: ${error.message}`)); continue; }
        summary.submissions++;
        if (payload.is_approved) summary.approved++; else summary.pending++;
        if (payload.is_approved === false && subId) {
          // submit_hiring_report always inserts is_approved from p_submission
          // directly, so payload.is_approved already controls this; nothing
          // further to do here — kept as an explicit branch for clarity.
        }
      }
      for (let i = 0; i < profile.employeeCount; i++) {
        const { payload, themes } = generateEmployeeRow(rand, org, profile);
        const { error } = await supabase.rpc("submit_hiring_report", {
          p_submission: payload, p_ratings: [], p_emotions: [], p_culture_themes: themes,
        });
        if (error) { console.error(c.red(`  employee row failed for ${profile.name}: ${error.message}`)); continue; }
        summary.submissions++;
        summary.cultureThemeSelections += themes.length;
        if (payload.is_approved) summary.approved++; else summary.pending++;
      }
    }
  } else {
    for (const profile of ORG_PROFILES) summary.submissions += profile.candidateCount + profile.employeeCount;
  }
  console.log(c.green(`✓ hiring_submissions: ${summary.submissions} written (${summary.approved} approved, ${summary.pending} left pending for the moderation queue), ${summary.cultureThemeSelections} culture-theme selections`));

  // --- 3. company_requests — pending / duplicate / mergeable / promotable --
  // Uses a REAL existing organization (read-only lookup) as the "should
  // merge" target, and a name colliding with a demo org above as the
  // "duplicate" scenario — both exercise D-009's collision protection when
  // an admin later works the queue; this script only seeds the states, it
  // does not resolve them (that is an admin/human moderation action).
  const { data: aRealOrg } = await supabase.from("organizations").select("slug, display_name").neq("slug", "").limit(1).maybeSingle();
  const requests: { requested_name: string; requested_domain: string | null; note: string }[] = [
    { requested_name: "Zephyr Robotics Pvt Ltd", requested_domain: "zephyrrobotics.example.com", note: "pending — brand new company, no existing match, suitable for promotion" },
    { requested_name: ORG_PROFILES[0].name, requested_domain: null, note: `duplicate — should collide with the already-seeded "${ORG_PROFILES[0].name}" on slug` },
    { requested_name: (aRealOrg as { display_name: string } | null)?.display_name ? `${(aRealOrg as { display_name: string }).display_name} India Pvt Ltd` : "Existing Co India Pvt Ltd", requested_domain: null, note: "should merge — a spelling variant of an existing real organization" },
    { requested_name: "Halcyon Data Systems", requested_domain: "halcyondata.example.com", note: "pending — another clean promotable candidate" },
  ];
  if (!dryRun) {
    for (const r of requests) {
      const { data: existingReq } = await supabase.from("company_requests").select("id").eq("requested_name", r.requested_name).maybeSingle();
      if (existingReq) continue;
      const { error } = await supabase.from("company_requests").insert({ requested_name: r.requested_name, requested_domain: r.requested_domain, requester_note: r.note });
      if (error) { console.error(c.red(`  company_request failed: ${error.message}`)); continue; }
      summary.companyRequests++;
    }
  } else {
    summary.companyRequests = requests.length;
  }
  console.log(c.green(`✓ company_requests: ${summary.companyRequests} seeded (pending / duplicate / mergeable / promotable)`));

  // --- 4. external_reports — attributed to the permanently-disabled 'demo' source
  const { data: demoSource } = await supabase.from("external_sources").select("id, enabled").eq("key", "demo").maybeSingle();
  if (!demoSource) {
    console.warn(c.yellow("  'demo' external_sources row not found — skipping external_reports (run migration demo_external_source first)."));
  } else {
    if ((demoSource as { enabled: boolean }).enabled) {
      console.warn(c.red("  WARNING: 'demo' source has enabled=true — this should be permanently false. Not seeding external_reports until this is fixed."));
    } else {
      const targets = [...ORG_PROFILES.slice(0, 3).map((p) => p.name), (aRealOrg as { display_name: string } | null)?.display_name].filter((v): v is string => !!v);
      for (let i = 0; i < 18; i++) {
        const companyName = pick(rand, targets);
        const orgId = orgIds.get(companyName) ?? (aRealOrg as { slug: string } | null)?.slug;
        const role = pick(rand, DEMO_ROLES);
        const experienceBucket = pick(rand, EXPERIENCE_BUCKETS);
        const stage = pick(rand, STAGES);
        const outcome = pick(rand, OUTCOMES);
        const responseTimeBucket = pick(rand, RESPONSE_TIME_BUCKETS);
        const lastInteractionGap = pick(rand, LAST_INTERACTION_GAPS);
        const reason = outcome === "rejected" ? pick(rand, REASONS) : "no_reason";
        const paymentFlag = rand() < 0.03;
        const reportedMonth = monthsAgo(rand, 12);
        const companySlug = slugify(companyName);
        const contentHash = hashExternalContent({
          companySlug, role, experienceBucket, stage, outcome, responseTimeBucket,
          lastInteractionGap, reason, paymentFlag: String(paymentFlag), reportedMonth,
        });
        const externalRef = `demo-${contentHash.slice(0, 16)}`;

        if (!dryRun) {
          const { data: existingReport } = await supabase.from("external_reports").select("id").eq("content_hash", contentHash).maybeSingle();
          if (existingReport) { summary.externalReportsSkipped++; continue; }
          const { error } = await supabase.from("external_reports").insert({
            company: companyName,
            organization_id: typeof orgId === "string" && orgId.length === 36 ? orgId : null,
            role, source_id: (demoSource as { id: string }).id,
            source_url: `https://example.com/demo/${externalRef}`,
            external_ref: externalRef, content_hash: contentHash,
            experience_bucket: experienceBucket, stage, outcome,
            response_time_bucket: responseTimeBucket, last_interaction_gap: lastInteractionGap,
            reason, payment_flag: paymentFlag, reported_month: reportedMonth,
            verification_status: "pending",
            extraction_version: "seed-v1-demo", extraction_confidence: 0.5 + rand() * 0.4,
          });
          if (error) { console.error(c.red(`  external_report failed: ${error.message}`)); continue; }
        }
        summary.externalReports++;
      }
    }
  }
  console.log(c.green(`✓ external_reports: ${summary.externalReports} seeded on the 'demo' source (never publishable — enabled=false), ${summary.externalReportsSkipped} already present (idempotent)`));

  // --- 5. external_acquisition_runs — a realistic pipeline trace ----------
  if (!dryRun && demoSource) {
    const traceTargets = ORG_PROFILES.slice(0, 3);
    const stages: { status: string; recordsFound: number; recordsCreated: number; recordsDuplicate: number; recordsInvalid: number }[] = [
      { status: "completed", recordsFound: 6, recordsCreated: 5, recordsDuplicate: 1, recordsInvalid: 0 },
      { status: "awaiting_moderation", recordsFound: 4, recordsCreated: 4, recordsDuplicate: 0, recordsInvalid: 0 },
      { status: "validation_failed", recordsFound: 3, recordsCreated: 0, recordsDuplicate: 0, recordsInvalid: 3 },
    ];
    for (let i = 0; i < traceTargets.length; i++) {
      const t = stages[i];
      const { error } = await supabase.from("external_acquisition_runs").insert({
        source_key: "demo", company_query: traceTargets[i].name,
        organization_id: orgIds.get(traceTargets[i].name) ?? null,
        status: t.status, records_found: t.recordsFound, records_created: t.recordsCreated,
        records_duplicate: t.recordsDuplicate, records_invalid: t.recordsInvalid,
        triggered_by: "manual", finished_at: new Date().toISOString(),
      });
      if (error) { console.error(c.red(`  external_acquisition_runs failed: ${error.message}`)); continue; }
      summary.acquisitionRuns++;
    }
  } else {
    summary.acquisitionRuns = 3;
  }
  console.log(c.green(`✓ external_acquisition_runs: ${summary.acquisitionRuns} seeded (completed / awaiting_moderation / validation_failed traces)`));

  console.log(c.dim("\nAll first-party rows: real companies never used. All external rows: 'demo' source, permanently enabled=false. Nothing here becomes public evidence without an explicit moderation decision, and external content structurally cannot regardless."));
  if (dryRun) console.log(c.yellow("\nThis was a --dry-run. Re-run with --confirm to write."));
}

main().catch((err) => {
  console.error(c.red(`\nSeed script failed: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
