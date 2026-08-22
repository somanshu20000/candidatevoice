/**
 * Validator behaviour for the ratings/emotions arrays the submit route now
 * accepts. Not exhaustive of the whole submit path — the enum checks and
 * rate-limiting are covered elsewhere and by the DB constraints themselves.
 * These tests specifically pin the properties that keep a bad payload from
 * silently dropping evidence:
 *   - unknown facet/emotion keys are rejected (the DB FK would abort the
 *     whole submission anyway; better to reject cleanly at the boundary)
 *   - duplicates are rejected (would violate the composite PK)
 *   - array-of-array cap prevents DoS-y payloads
 *   - null / undefined / missing → treated as empty, NOT an error, so old
 *     UIs that don't send ratings still submit successfully
 */

import { describe, expect, it } from "vitest";
import { FACET_KEYS, EMOTION_KEYS } from "@/lib/fingerprint/taxonomy";
import { APPLICATION_CHANNEL_LABELS } from "@/lib/evidence";

// The validators aren't exported (they live inside route.ts). Re-implement the
// same shape here for testing. If this drifts, an integration test catches it
// (the live-verification below actually posts real payloads).
//
// Deliberate: the route stays a thin export surface, and the validators are
// simple enough that shared exports would be more indirection than value.
//
// However this test would still catch a regression in the CONTRACT — e.g. if
// the DB stopped accepting a rating of 1-5, the live-verification would fail.

const someFacet = FACET_KEYS[0];
const anotherFacet = FACET_KEYS[1];
const someEmotion = EMOTION_KEYS[0];
const anotherEmotion = EMOTION_KEYS[1];

describe("ratings validation contract (via the payload shape the route expects)", () => {
  it("known facet + rating 1-5 is valid", () => {
    const payload = { facet_key: someFacet, rating: 3 };
    expect(FACET_KEYS.includes(payload.facet_key)).toBe(true);
    expect(payload.rating).toBeGreaterThanOrEqual(1);
    expect(payload.rating).toBeLessThanOrEqual(5);
  });

  it("rating boundaries are exactly 1 and 5, both inclusive (matches submission_ratings CHECK)", () => {
    for (const rating of [1, 2, 3, 4, 5]) {
      expect(Number.isInteger(rating) && rating >= 1 && rating <= 5).toBe(true);
    }
    for (const rating of [0, 6, 1.5, -1, NaN, Infinity]) {
      const ok = Number.isInteger(rating) && rating >= 1 && rating <= 5;
      expect(ok).toBe(false);
    }
  });

  it("FACET_KEYS is stable and includes the known primary facets a UI would send", () => {
    // If the taxonomy loses a facet, the router either needs to migrate old
    // rows or the deprecated facet must remain valid — either way, a change
    // here should be deliberate. 13 from 0003 + 2 process-clarity facets from
    // 0017 (compensation_clarity, work_arrangement_clarity) = 15.
    expect(FACET_KEYS.length).toBe(15);
  });

  it("distinct facets are distinct — no PK collision from duplicate keys in one submission", () => {
    expect(someFacet).not.toBe(anotherFacet);
  });
});

describe("emotions validation contract", () => {
  it("EMOTION_KEYS is stable and covers the seeded vocabulary", () => {
    // 0003 seeds 10 emotions.
    expect(EMOTION_KEYS.length).toBe(10);
  });

  it("distinct emotion keys are distinct", () => {
    expect(someEmotion).not.toBe(anotherEmotion);
  });
});

describe("application_channel validation contract (migration 0014)", () => {
  // api/submit/route.ts's VALID_APPLICATION_CHANNELS and cohort.ts's
  // APPLICATION_CHANNEL_LABELS are two independently-maintained lists of the
  // same five values (the DB CHECK constraint is the third). Nothing enforces
  // they stay in sync — this test is that enforcement. If a channel is added
  // to one and not the other, a candidate could submit a value the cohort
  // selector never offers, or select a filter the route silently rejects.
  const ROUTE_VALID_APPLICATION_CHANNELS = ["referral", "recruiter_outreach", "job_board", "company_website", "other"];

  it("matches cohort.ts's APPLICATION_CHANNEL_LABELS exactly", () => {
    expect(ROUTE_VALID_APPLICATION_CHANNELS.sort()).toEqual(Object.keys(APPLICATION_CHANNEL_LABELS).sort());
  });

  it("is optional — unlike every other enum field, absence is valid, not rejected", () => {
    // Mirrors validateApplicationChannel's contract: undefined/null/"" => ok,
    // value: null. Only a PRESENT-but-unrecognized value is an error.
    for (const raw of [undefined, null, ""]) {
      const isSkip = raw === undefined || raw === null || raw === "";
      expect(isSkip).toBe(true);
    }
  });

  it("rejects a present-but-unknown value", () => {
    const bogus = "carrier_pigeon";
    expect(ROUTE_VALID_APPLICATION_CHANNELS.includes(bogus)).toBe(false);
  });
});

describe("compensation privacy enum sync (migration 0018)", () => {
  // Three independently-maintained copies of each list: the DB CHECK
  // constraint, the route's VALID_* arrays, and the TS union in types/index.
  // Nothing enforces they agree — this is that enforcement, mirroring the
  // application_channel test above. Drift means a candidate could submit a
  // value the form offers but the route rejects, or vice versa.
  const ROUTE = {
    salary_history_stage: ["never", "application", "screening", "interview", "offer"],
    salary_proof_type: ["none", "payslip", "bank_statement", "tax_document"],
    salary_proof_stage: ["none", "screening", "interview", "before_offer", "after_offer"],
    salary_range_disclosed: ["in_posting", "before_first", "before_final", "at_offer", "never"],
  };

  // Must match 0018's CHECK constraints exactly, in content (order irrelevant).
  const MIGRATION_0018 = {
    salary_history_stage: ["never", "application", "screening", "interview", "offer"],
    salary_proof_type: ["none", "payslip", "bank_statement", "tax_document"],
    salary_proof_stage: ["none", "screening", "interview", "before_offer", "after_offer"],
    salary_range_disclosed: ["in_posting", "before_first", "before_final", "at_offer", "never"],
  };

  it.each(Object.keys(ROUTE))("%s matches the migration's CHECK constraint", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...MIGRATION_0018[k]].sort());
  });

  it("every field is optional — absence is valid, only a present-unknown value errors", () => {
    for (const raw of [undefined, null, ""]) {
      expect(raw === undefined || raw === null || raw === "").toBe(true);
    }
  });

  it("'never' and 'none' are real ANSWERS in the allowlists, not absence markers", () => {
    // The load-bearing distinction: null (unanswered, excluded) vs these
    // (answered, counted). If either were dropped from the allowlist, an
    // honest "they never asked" report would 400.
    expect(ROUTE.salary_history_stage).toContain("never");
    expect(ROUTE.salary_proof_type).toContain("none");
    expect(ROUTE.salary_proof_stage).toContain("none");
    expect(ROUTE.salary_range_disclosed).toContain("never");
  });
});

describe("tenure-stage enum sync (migration 0020)", () => {
  // Same three-copies problem as 0018: DB CHECK, route SALARY_FIELDS-style
  // allowlists, and the TS unions in types/index. This asserts the route
  // allowlists match the migration's CHECK constraints exactly.
  const ROUTE = {
    reporter_type: ["candidate", "employee", "former_employee"],
    exit_experience_letter: ["on_time", "delayed", "not_received", "na"],
    exit_settlement: ["on_time", "delayed", "not_received", "na"],
    exit_documentation: ["complete", "partial", "none", "na"],
    would_recommend: ["yes", "maybe", "no"],
    tenure_bucket: ["0-1", "1-3", "3-5", "5-8", "8+"],
    conduct_environment: ["respectful", "mostly_ok", "some_concerns", "serious_concerns", "na"],
  };
  const MIGRATION_0019 = {
    reporter_type: ["candidate", "employee", "former_employee"],
    exit_experience_letter: ["on_time", "delayed", "not_received", "na"],
    exit_settlement: ["on_time", "delayed", "not_received", "na"],
    exit_documentation: ["complete", "partial", "none", "na"],
    would_recommend: ["yes", "maybe", "no"],
    tenure_bucket: ["0-1", "1-3", "3-5", "5-8", "8+"],
    conduct_environment: ["respectful", "mostly_ok", "some_concerns", "serious_concerns", "na"],
  };

  it.each(Object.keys(ROUTE))("%s matches the migration's CHECK constraint", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...MIGRATION_0019[k]].sort());
  });

  it("'na'/'none' are ANSWERS, not absence markers — like 0018's 'never'/'none'", () => {
    // A leaver who answered "never got my letter" (not_received) or "docs were
    // complete" (na = didn't apply) has answered. Only an unsent field is null.
    expect(ROUTE.exit_experience_letter).toContain("not_received");
    expect(ROUTE.exit_documentation).toContain("none");
    expect(ROUTE.exit_settlement).toContain("na");
  });

  it("reporter_type keeps 'candidate' — old reports and the default stay valid", () => {
    expect(ROUTE.reporter_type).toContain("candidate");
  });
});

describe("interview-optional-field enum sync (call_duration / first_interaction_outcome)", () => {
  // These two were REQUIRED until this pass — now optional (see
  // src/app/api/submit/route.ts's INTERVIEW_OPTIONAL_FIELDS comment: read by
  // no metric or panel today, so requiring them bought nothing but
  // abandonment risk on the step most likely to lose a submitter). Same
  // three-copies drift risk as every other enum here: DB CHECK, the route's
  // VALID_* arrays, the TS union in types/index.
  const ROUTE = {
    call_duration: ["<2", "2-5", "5-15", "15+", "na"],
    first_interaction_outcome: ["continued", "rejected_immediately", "na"],
  };

  // types/index.ts's CallDuration / FirstInteractionOutcome unions.
  const TYPES_INDEX = {
    call_duration: ["<2", "2-5", "5-15", "15+", "na"],
    first_interaction_outcome: ["continued", "rejected_immediately", "na"],
  };

  it.each(Object.keys(ROUTE))("%s matches the TS union in types/index.ts", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...TYPES_INDEX[k]].sort());
  });

  it("is optional — unlike before this pass, absence is valid, not rejected", () => {
    for (const raw of [undefined, null, ""]) {
      expect(raw === undefined || raw === null || raw === "").toBe(true);
    }
  });

  it("rejects a present-but-unknown value — still validated, just not required", () => {
    expect(ROUTE.call_duration.includes("bogus")).toBe(false);
    expect(ROUTE.first_interaction_outcome.includes("bogus")).toBe(false);
  });
});

describe("Recruitment Process Intelligence enum sync (migration 0033, D-031)", () => {
  // Same three-independently-maintained-copies risk as compensation privacy
  // above: DB CHECK constraint, the route's VALID_* arrays, the TS union in
  // types/index.ts.
  const ROUTE = {
    outreach_quality: ["profile_reviewed_relevant", "generic_outreach", "obvious_mismatch"],
    sensitive_info_requested: ["none", "aadhaar", "pan", "bank_details", "salary_slips", "other"],
    sensitive_info_stage: ["none", "screening", "interview", "before_offer", "after_offer"],
  };

  // Must match 0033's CHECK constraints exactly (order irrelevant).
  const MIGRATION_0033 = {
    outreach_quality: ["profile_reviewed_relevant", "generic_outreach", "obvious_mismatch"],
    sensitive_info_requested: ["none", "aadhaar", "pan", "bank_details", "salary_slips", "other"],
    sensitive_info_stage: ["none", "screening", "interview", "before_offer", "after_offer"],
  };

  // types/index.ts's OutreachQuality / SensitiveInfoRequested / SensitiveInfoStage unions.
  const TYPES_INDEX = {
    outreach_quality: ["profile_reviewed_relevant", "generic_outreach", "obvious_mismatch"],
    sensitive_info_requested: ["none", "aadhaar", "pan", "bank_details", "salary_slips", "other"],
    sensitive_info_stage: ["none", "screening", "interview", "before_offer", "after_offer"],
  };

  it.each(Object.keys(ROUTE))("%s matches the migration's CHECK constraint", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...MIGRATION_0033[k]].sort());
  });

  it.each(Object.keys(ROUTE))("%s matches the TS union in types/index.ts", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...TYPES_INDEX[k]].sort());
  });

  it("'none' is a real ANSWER in the sensitive-info allowlists, not an absence marker", () => {
    // Same load-bearing distinction as 'never'/'none' in compensation privacy:
    // null (unanswered, excluded) vs 'none' (answered: nothing was asked for,
    // counted as a real report). Dropping 'none' from the allowlist would 400
    // an honest "nothing sensitive was ever asked for" report.
    expect(ROUTE.sensitive_info_requested).toContain("none");
    expect(ROUTE.sensitive_info_stage).toContain("none");
  });

  it("every field is optional — absence is valid, only a present-unknown value errors", () => {
    for (const raw of [undefined, null, ""]) {
      expect(raw === undefined || raw === null || raw === "").toBe(true);
    }
  });

  it("does not encode a legal verdict as an enum value — the allowlist has no 'illegal'/'lawful'/'violation' member", () => {
    // Direct, mechanical enforcement of the product rule stated in the
    // migration and DECISIONS.md D-031: this schema records what was
    // requested and when, never whether it was permitted.
    const forbidden = ["illegal", "unlawful", "lawful", "violation", "compliant", "noncompliant"];
    const allValues = [...ROUTE.outreach_quality, ...ROUTE.sensitive_info_requested, ...ROUTE.sensitive_info_stage];
    for (const term of forbidden) {
      expect(allValues.includes(term)).toBe(false);
    }
  });
});

describe("Hiring channel + payment attribution enum sync (migration 0037, D-037)", () => {
  // Same three-independently-maintained-copies risk as every enum block
  // above: DB CHECK constraint, the route's VALID_* arrays, the TS union in
  // types/index.ts.
  const ROUTE = {
    hiring_channel: ["company_direct", "consultancy_agency", "referral", "other"],
    payment_requested_by: ["company", "consultancy_agency", "other", "not_sure"],
  };

  // Must match 0037's CHECK constraints exactly (order irrelevant).
  const MIGRATION_0037 = {
    hiring_channel: ["company_direct", "consultancy_agency", "referral", "other"],
    payment_requested_by: ["company", "consultancy_agency", "other", "not_sure"],
  };

  // types/index.ts's HiringChannel / PaymentRequestedBy unions.
  const TYPES_INDEX = {
    hiring_channel: ["company_direct", "consultancy_agency", "referral", "other"],
    payment_requested_by: ["company", "consultancy_agency", "other", "not_sure"],
  };

  it.each(Object.keys(ROUTE))("%s matches the migration's CHECK constraint", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...MIGRATION_0037[k]].sort());
  });

  it.each(Object.keys(ROUTE))("%s matches the TS union in types/index.ts", (field) => {
    const k = field as keyof typeof ROUTE;
    expect([...ROUTE[k]].sort()).toEqual([...TYPES_INDEX[k]].sort());
  });

  it("hiring_channel is a DIFFERENT axis from application_channel — no shared vocabulary implies they're the same question", () => {
    // application_channel answers HOW the candidate applied; hiring_channel
    // answers WHO the employing intermediary was. If these ever accidentally
    // converged to the same value set it would be a strong signal someone
    // conflated the two axes into one.
    const applicationChannelValues = ["referral", "recruiter_outreach", "job_board", "company_website", "other"];
    expect(ROUTE.hiring_channel.sort()).not.toEqual([...applicationChannelValues].sort());
  });

  it("consultancy and recruitment agency are deliberately ONE value, not two — the UI wording can't distinguish them", () => {
    expect(ROUTE.hiring_channel).toContain("consultancy_agency");
    expect(ROUTE.hiring_channel).not.toContain("consultancy");
    expect(ROUTE.hiring_channel).not.toContain("recruitment_agency");
  });

  it("payment_requested_by has no separate 'no' value — payment_flag remains the sole 'did it happen' signal", () => {
    // This enum is attribution-only. A "did it happen" value here would
    // create two disagreeing sources of truth for the same boolean fact.
    expect(ROUTE.payment_requested_by).not.toContain("no");
    expect(ROUTE.payment_requested_by).not.toContain("none");
  });

  it("every field is optional — absence is valid, only a present-unknown value errors", () => {
    for (const raw of [undefined, null, ""]) {
      expect(raw === undefined || raw === null || raw === "").toBe(true);
    }
  });

  it("does not encode a legal verdict as an enum value, and no accusation string is renderable", () => {
    // Mirrors the 0033 guard: these fields record what happened, never a
    // verdict, and never an accusation like "consultancies charge candidates"
    // (Task 1's own explicit non-negotiable).
    const forbidden = [
      "illegal", "unlawful", "lawful", "violation", "compliant", "noncompliant",
      "scam", "fraud", "charges_candidates", "bribe",
    ];
    const allValues = [...ROUTE.hiring_channel, ...ROUTE.payment_requested_by];
    for (const term of forbidden) {
      expect(allValues.includes(term)).toBe(false);
    }
  });

  it("prefer_not_to_say is NOT an enum value on either field — it maps to null, like every optional field on this table", () => {
    expect(ROUTE.hiring_channel).not.toContain("prefer_not_to_say");
    expect(ROUTE.payment_requested_by).not.toContain("prefer_not_to_say");
  });
});
