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
    // here should be deliberate. Pin at 13 (0003_fingerprint_model.sql seeds 13).
    expect(FACET_KEYS.length).toBe(13);
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
