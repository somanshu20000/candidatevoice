/**
 * M3 Search — signal lexicon (M3 architecture plan §5).
 *
 * Maps a closed vocabulary of hiring-pattern phrases onto the dimension keys
 * the Evidence/Fingerprint machinery already computes. This is deliberately
 * NOT semantic search: there are ~13 known dimensions total, so a checked-in
 * synonym table is more accurate than an embedding on a vocabulary this
 * small, is deterministic, is unit-testable, and — unlike a cosine score —
 * prints its own reasoning ("matched 'ghost' → ghosting, low").
 *
 * No LLM, no embeddings, no pgvector, no network call, no PixelRAG (D-006,
 * D-019). Query PARSING (tokenizing a sentence, detecting entity vs. signal
 * intent) is explicitly out of scope here — that is M3.3. This module only
 * defines the vocabulary and an exact-phrase lookup over it.
 *
 * SCOPE. Only the behavioural, compensation/privacy, and offboarding
 * dimensions are covered — exactly what M3 §5 named. conduct.ts and
 * culture.ts are deliberately excluded: neither exposes a keyed dimension
 * union (each is a single hard-gated signal, not a `Record<Key, Score>`), so
 * there is no existing key for a lexicon entry to reference without inventing
 * one — which D-002/M3's "no new metric" rule forbids.
 */

import { BEHAVIOURAL_DIMENSION_LABELS } from "@/lib/fingerprint/behavioural";
import { COMPENSATION_DIMENSION_LABELS } from "@/lib/fingerprint/compensation";
import { OFFBOARDING_DIMENSION_LABELS } from "@/lib/fingerprint/offboarding";
import type { SearchDimensionKey, SignalDirection } from "./types";

export interface LexiconEntry {
  /** Lowercase phrase a user might type. Unique across the whole lexicon —
   *  enforced by tests/search-lexicon.test.ts, not at runtime. */
  term: string;
  dimensionKey: SearchDimensionKey;
  /** Which end of the dimension's 0..100 axis this phrase points toward. */
  direction: SignalDirection;
}

/**
 * Every SearchDimensionKey's human label, assembled from the label maps the
 * three fingerprint modules already own. Typed as `Record<SearchDimensionKey,
 * string>`, so if a key is ever added to/removed from the union without a
 * matching label existing in one of the three source maps, this object
 * literal fails `tsc` — the same "misspelling fails the build" guarantee the
 * lexicon entries below get from `LexiconEntry.dimensionKey`.
 */
const DIMENSION_LABELS: Record<SearchDimensionKey, string> = {
  ...BEHAVIOURAL_DIMENSION_LABELS,
  ...COMPENSATION_DIMENSION_LABELS,
  ...OFFBOARDING_DIMENSION_LABELS,
};

export function dimensionLabel(key: SearchDimensionKey): string {
  return DIMENSION_LABELS[key];
}

/**
 * The lexicon. Grouped by dimension, `low` phrases before `high` phrases
 * within each group, purely for readability — order carries no meaning.
 */
export const SIGNAL_LEXICON: LexiconEntry[] = [
  // ghosting — high score = LESS ghosting. Every phrase here names the bad
  // behaviour, so it points `low`.
  { term: "ghost", dimensionKey: "ghosting", direction: "low" },
  { term: "ghosting", dimensionKey: "ghosting", direction: "low" },
  { term: "ghosts candidates", dimensionKey: "ghosting", direction: "low" },
  { term: "goes silent", dimensionKey: "ghosting", direction: "low" },
  { term: "never responds", dimensionKey: "ghosting", direction: "low" },
  { term: "disappears after interview", dimensionKey: "ghosting", direction: "low" },

  // response_speed — high score = faster response.
  { term: "slow response", dimensionKey: "response_speed", direction: "low" },
  { term: "slow to respond", dimensionKey: "response_speed", direction: "low" },
  { term: "slow interview process", dimensionKey: "response_speed", direction: "low" },
  { term: "takes forever to respond", dimensionKey: "response_speed", direction: "low" },
  { term: "fast response", dimensionKey: "response_speed", direction: "high" },
  { term: "quick to respond", dimensionKey: "response_speed", direction: "high" },
  { term: "responsive", dimensionKey: "response_speed", direction: "high" },

  // process_depth — high score = deeper process (reaches later rounds/stages).
  { term: "long interview process", dimensionKey: "process_depth", direction: "high" },
  { term: "many rounds", dimensionKey: "process_depth", direction: "high" },
  { term: "multiple rounds", dimensionKey: "process_depth", direction: "high" },
  { term: "lengthy hiring process", dimensionKey: "process_depth", direction: "high" },
  { term: "quick process", dimensionKey: "process_depth", direction: "low" },
  { term: "single round", dimensionKey: "process_depth", direction: "low" },
  { term: "one round interview", dimensionKey: "process_depth", direction: "low" },

  // offer_probability — high score = more likely to receive an offer.
  { term: "hard to get an offer", dimensionKey: "offer_probability", direction: "low" },
  { term: "low offer rate", dimensionKey: "offer_probability", direction: "low" },
  { term: "rarely gives offers", dimensionKey: "offer_probability", direction: "low" },
  { term: "high offer rate", dimensionKey: "offer_probability", direction: "high" },
  { term: "easy to get hired", dimensionKey: "offer_probability", direction: "high" },

  // transparency — high score = explains rejection reasons rather than none.
  { term: "no feedback", dimensionKey: "transparency", direction: "low" },
  { term: "vague rejection reasons", dimensionKey: "transparency", direction: "low" },
  { term: "doesn't explain rejection", dimensionKey: "transparency", direction: "low" },
  { term: "opaque about rejection", dimensionKey: "transparency", direction: "low" },
  { term: "explains rejection", dimensionKey: "transparency", direction: "high" },
  { term: "gives feedback", dimensionKey: "transparency", direction: "high" },
  { term: "transparent about rejection", dimensionKey: "transparency", direction: "high" },

  // payment_risk — high score = safer (lower rate of payment demands).
  { term: "asks for payment", dimensionKey: "payment_risk", direction: "low" },
  { term: "payment scam", dimensionKey: "payment_risk", direction: "low" },
  { term: "asks candidates to pay", dimensionKey: "payment_risk", direction: "low" },
  { term: "fee before interview", dimensionKey: "payment_risk", direction: "low" },
  { term: "no upfront payment", dimensionKey: "payment_risk", direction: "high" },
  { term: "doesn't ask for money", dimensionKey: "payment_risk", direction: "high" },

  // salary_history_privacy — high score = never asks for salary history.
  { term: "asks for salary history", dimensionKey: "salary_history_privacy", direction: "low" },
  { term: "demands previous salary", dimensionKey: "salary_history_privacy", direction: "low" },
  { term: "asks current salary", dimensionKey: "salary_history_privacy", direction: "low" },
  { term: "doesn't ask salary history", dimensionKey: "salary_history_privacy", direction: "high" },

  // document_privacy — high score = never demands bank statements/tax docs.
  { term: "asks for bank statements", dimensionKey: "document_privacy", direction: "low" },
  { term: "demands financial documents", dimensionKey: "document_privacy", direction: "low" },
  { term: "invasive salary proof", dimensionKey: "document_privacy", direction: "low" },
  { term: "asks for tax documents", dimensionKey: "document_privacy", direction: "low" },
  { term: "doesn't ask for documents", dimensionKey: "document_privacy", direction: "high" },

  // range_transparency — high score = discloses the salary range early.
  { term: "hides salary range", dimensionKey: "range_transparency", direction: "low" },
  { term: "doesn't disclose salary range", dimensionKey: "range_transparency", direction: "low" },
  { term: "no salary range", dimensionKey: "range_transparency", direction: "low" },
  { term: "discloses salary range", dimensionKey: "range_transparency", direction: "high" },
  { term: "transparent about pay", dimensionKey: "range_transparency", direction: "high" },
  { term: "posts salary range", dimensionKey: "range_transparency", direction: "high" },

  // verification_timing — high score = verifies salary only after an offer.
  { term: "verifies salary before offer", dimensionKey: "verification_timing", direction: "low" },
  { term: "demands proof before offer", dimensionKey: "verification_timing", direction: "low" },
  { term: "verifies after offer", dimensionKey: "verification_timing", direction: "high" },

  // experience_letter — high score = on-time experience/relieving letter.
  { term: "withholds experience letter", dimensionKey: "experience_letter", direction: "low" },
  { term: "delayed relieving letter", dimensionKey: "experience_letter", direction: "low" },
  { term: "doesn't give experience letter", dimensionKey: "experience_letter", direction: "low" },
  { term: "gives experience letter on time", dimensionKey: "experience_letter", direction: "high" },

  // settlement_timeliness — high score = on-time full-and-final settlement.
  { term: "delayed final settlement", dimensionKey: "settlement_timeliness", direction: "low" },
  { term: "doesn't pay full and final", dimensionKey: "settlement_timeliness", direction: "low" },
  { term: "withholds settlement", dimensionKey: "settlement_timeliness", direction: "low" },
  { term: "pays settlement on time", dimensionKey: "settlement_timeliness", direction: "high" },

  // documentation_completeness — high score = complete exit documentation.
  { term: "incomplete exit documentation", dimensionKey: "documentation_completeness", direction: "low" },
  { term: "missing exit paperwork", dimensionKey: "documentation_completeness", direction: "low" },
  { term: "complete exit documentation", dimensionKey: "documentation_completeness", direction: "high" },
];

const BY_TERM = new Map<string, LexiconEntry>(SIGNAL_LEXICON.map((e) => [e.term, e]));

/**
 * Exact-phrase lookup, case-insensitive and trimmed. Returns null on any miss
 * — the caller (M3.3's parser) decides what an unmatched phrase means; this
 * module never guesses a nearest match.
 */
export function lookupSignalTerm(rawTerm: string): LexiconEntry | null {
  const term = rawTerm.trim().toLowerCase();
  return BY_TERM.get(term) ?? null;
}
