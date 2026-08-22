/**
 * Deterministic display pseudonym for the anonymous candidate identity
 * (Phase 1 of the product-experience audit).
 *
 * PURE, DERIVED, NEVER STORED — same discipline as HQS/confidence (ADR-0001
 * §3.4): a candidate_profiles.id already exists as an opaque UUID; this module
 * only computes a human-readable label FROM it on every read. No new column,
 * no new table, no write path. A returning visitor sees the same pseudonym
 * every time because the input (their cookie's UUID) doesn't change — not
 * because anything was persisted beyond what candidate_profiles already holds.
 *
 * NOT A HANDLE THE USER CHOOSES. A chosen, editable pseudonym can itself leak
 * identity (the same handle reused across sites/forums) and would need a
 * uniqueness/moderation surface this product has no reason to build. Generated
 * and fixed is the safe shape: recognizable to its owner, meaningless to
 * anyone else, and — because it's a pure function of an already-anonymous id —
 * adds no new de-anonymization surface (ADR-0003 §5 / adr-0001 §4.3).
 */

import crypto from "crypto";

const ADJECTIVES = [
  "Quiet", "Steady", "Curious", "Bold", "Calm", "Bright", "Patient", "Swift",
  "Wandering", "Careful", "Sharp", "Gentle", "Restless", "Sturdy", "Keen",
  "Thoughtful", "Nimble", "Diligent", "Earnest", "Wry",
] as const;

const NOUNS = [
  "Otter", "Falcon", "Maple", "River", "Compass", "Lantern", "Sparrow", "Cedar",
  "Comet", "Harbor", "Ember", "Willow", "Beacon", "Heron", "Boulder", "Meadow",
  "Anchor", "Fern", "Kestrel", "Summit",
] as const;

/**
 * "AdjectiveNoun####" — a 4-digit number gives ~20*20*10000 = 4,000,000
 * combinations, plenty for collision to be a non-issue at this product's
 * scale (this is a display label, not an identifier — two candidates sharing
 * a pseudonym causes no correlation risk, since neither can see the other's
 * evidence either way).
 */
export function pseudonymFor(candidateId: string): string {
  const digest = crypto.createHash("sha256").update(candidateId).digest();
  const adjIndex = digest[0] % ADJECTIVES.length;
  const nounIndex = digest[1] % NOUNS.length;
  const number = (digest.readUInt16BE(2) % 10000).toString().padStart(4, "0");
  return `${ADJECTIVES[adjIndex]}${NOUNS[nounIndex]}${number}`;
}
