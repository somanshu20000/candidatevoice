/**
 * M3.3 — deterministic query parser (M3 architecture plan §5, §8).
 *
 * Turns one free-text query into a structured intent the retrieval layer can
 * act on, WITHOUT an LLM (D-006), embeddings, or a network call. It only knows
 * the closed vocabularies M3.0 already defined: the signal lexicon
 * (lexicon.ts) and the unsupported-capability list (unsupported.ts).
 *
 * THE THREE JOBS:
 *   1. Pull out SIGNAL phrases ("slow response" -> response_speed, low), using
 *      longest-phrase-first matching so a multi-word phrase is never shadowed
 *      by a shorter one it contains.
 *   2. Flag UNSUPPORTED constraints ("in Gurgaon" -> location) so the UI can
 *      say so instead of silently ignoring them (M3 §8 case I).
 *   3. Leave the residual tokens as the ENTITY query (a company name), after
 *      dropping filler words.
 *
 * INTENT is then a function of what survived:
 *   - signals + a real entity residual  -> "mixed"  ("Razorpay ghosting")
 *   - signals only                       -> "signal" ("companies that ghost…")
 *   - entity residual only               -> "entity" ("Razorpay")
 *   - nothing actionable                 -> "empty"
 *
 * Plural tolerance: a query token matches a vocabulary token if they are equal
 * or differ only by a trailing "s" ("responses" ~ "response", "rounds" ~
 * "round"). Cheap, deterministic, and enough for the phrases in scope — no
 * stemmer dependency.
 */

import { SIGNAL_LEXICON, dimensionLabel } from "./lexicon";
import { LOCATION_TERMS, detectCompensationAmount, type UnsupportedCapability } from "./unsupported";
import type { SearchDimensionKey, SearchMode, SignalDirection } from "./types";

/** Filler words dropped from the entity residual — never company names, and
 *  their presence should not make a signal query look like an entity one. */
const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "for", "to", "with", "without", "in", "at", "on", "by",
  "that", "which", "who", "whose", "where", "when", "after", "before", "during",
  "companies", "company", "employers", "employer", "firms", "firm", "orgs", "organizations",
  "hiring", "interview", "interviews", "interviewing", "process", "processes",
  "candidate", "candidates", "applicant", "applicants", "round", "rounds", "stage", "stages",
  "technical", "hr", "employees", "employee", "job", "jobs", "role", "roles",
  "me", "show", "find", "list", "some", "any", "all", "their",
]);

export type ParseIntent = SearchMode | "mixed" | "empty";

export interface ParsedSignal {
  /** The verbatim phrase the user typed that matched. */
  term: string;
  dimensionKey: SearchDimensionKey;
  direction: SignalDirection;
  label: string;
}

export interface ParsedUnsupported {
  /** The verbatim fragment that triggered it. */
  term: string;
  capability: UnsupportedCapability;
}

export interface ParsedQuery {
  raw: string;
  intent: ParseIntent;
  /** The query to run entity search with. The raw string when nothing was
   *  stripped (so "razorpay.com" reaches the domain matcher intact); otherwise
   *  the residual tokens joined. Empty when there is no entity residual. */
  entityQuery: string;
  entityTokens: string[];
  signals: ParsedSignal[];
  unsupported: ParsedUnsupported[];
}

function tokenize(raw: string): string[] {
  return raw.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** Equal, or differ only by a trailing "s". */
function tokenMatch(queryTok: string, vocabTok: string): boolean {
  if (queryTok === vocabTok) return true;
  if (queryTok === vocabTok + "s") return true;
  if (vocabTok === queryTok + "s") return true;
  return false;
}

interface Matcher {
  tokens: string[];
  kind: "signal" | "location";
  entry?: (typeof SIGNAL_LEXICON)[number];
}

/** All vocabulary phrases as matchers, longest (most tokens) first so a longer
 *  phrase always wins over a shorter one it contains. Built once at module load. */
const MATCHERS: Matcher[] = [
  ...SIGNAL_LEXICON.map((entry) => ({ tokens: tokenize(entry.term), kind: "signal" as const, entry })),
  ...LOCATION_TERMS.map((term) => ({ tokens: tokenize(term), kind: "location" as const })),
].sort((a, b) => b.tokens.length - a.tokens.length);

/** Does `matcher` match `tokens` starting exactly at index `i`? */
function matchesAt(tokens: string[], i: number, matcher: Matcher): boolean {
  if (i + matcher.tokens.length > tokens.length) return false;
  for (let j = 0; j < matcher.tokens.length; j++) {
    if (!tokenMatch(tokens[i + j], matcher.tokens[j])) return false;
  }
  return true;
}

export function parseQuery(raw: string): ParsedQuery {
  const trimmed = raw.trim();
  const tokens = tokenize(trimmed);

  if (tokens.length === 0) {
    return { raw: trimmed, intent: "empty", entityQuery: "", entityTokens: [], signals: [], unsupported: [] };
  }

  const signals: ParsedSignal[] = [];
  const seenSignal = new Set<string>(); // dimensionKey|direction
  const unsupported: ParsedUnsupported[] = [];
  const seenLocation = new Set<string>();
  const residual: string[] = [];

  // Left-to-right, longest-phrase-first, consuming matched spans.
  let i = 0;
  while (i < tokens.length) {
    const matcher = MATCHERS.find((m) => matchesAt(tokens, i, m));
    if (!matcher) {
      residual.push(tokens[i]);
      i += 1;
      continue;
    }
    const term = tokens.slice(i, i + matcher.tokens.length).join(" ");
    if (matcher.kind === "signal" && matcher.entry) {
      const key = `${matcher.entry.dimensionKey}|${matcher.entry.direction}`;
      if (!seenSignal.has(key)) {
        seenSignal.add(key);
        signals.push({
          term,
          dimensionKey: matcher.entry.dimensionKey,
          direction: matcher.entry.direction,
          label: dimensionLabel(matcher.entry.dimensionKey),
        });
      }
    } else if (matcher.kind === "location") {
      if (!seenLocation.has(term)) {
        seenLocation.add(term);
        unsupported.push({ term, capability: "location" });
      }
    }
    i += matcher.tokens.length;
  }

  // Absolute-compensation asks are detected over the whole raw string (they are
  // number-shaped, not fixed phrases).
  const money = detectCompensationAmount(trimmed);
  if (money) unsupported.push({ term: money, capability: "compensation_amount" });

  const entityTokens = residual.filter((t) => !STOPWORDS.has(t));
  const nothingStripped = signals.length === 0 && unsupported.length === 0;
  // When nothing was stripped, keep the raw query so domain/URL forms survive.
  const entityQuery = nothingStripped ? trimmed : entityTokens.join(" ");

  let intent: ParseIntent;
  if (entityTokens.length > 0 && signals.length > 0) intent = "mixed";
  else if (signals.length > 0) intent = "signal";
  else if (entityTokens.length > 0) intent = "entity";
  else intent = "empty";

  return { raw: trimmed, intent, entityQuery, entityTokens, signals, unsupported };
}
