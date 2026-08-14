/**
 * M3.5 — search orchestration. The one async entry point the UI calls: parse
 * the query, run the right retrieval, and return a single typed outcome.
 *
 * This is the whole chain from the plan, in order and nowhere else:
 *   USER QUERY -> parseQuery -> (entity: ranked RPC + substring | signal:
 *   loadCompanyAnalytics -> rankSignalResults -> buildSignalResult) -> outcome
 *
 * It computes NO metric. Entity retrieval reuses searchCompanies (directory.ts,
 * itself the ranked RPC + substring merge from M3.1); signal retrieval reuses
 * loadCompanyAnalytics (the existing Evidence Engine) and the pure ranker.
 * Clock-free: the caller supplies referenceMonth (a server component may read
 * the clock and pass it in — same discipline as evidence/rank.ts).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { searchCompanies, type CompanyListItem } from "@/lib/company-intelligence/directory";
import { loadCompanyAnalytics } from "@/lib/evidence";
import { parseQuery, type ParsedQuery } from "./parse";
import { rankSignalResults, type SignalSpec } from "./signal";
import { buildSignalResult } from "./explain";
import type { SearchResult } from "./types";

export interface SearchOutcome {
  parsed: ParsedQuery;
  /** "entity" and "mixed" render company cards; "signal" renders banded signal
   *  results; "empty" renders the prompt. Mirrors parsed.intent, surfaced at the
   *  top level so the page never re-derives it. */
  primaryMode: "entity" | "signal" | "empty";
  /** Populated for entity/mixed. Ranked (M3.1). */
  entityCompanies: CompanyListItem[];
  /** Populated for signal. Empty when no company clears the evidence gate —
   *  the honest "not enough evidence yet" state, not an error. */
  signalResults: SearchResult[];
  /** True when a signal query ran but zero companies cleared the gate, so the
   *  UI can distinguish "no company has enough evidence yet" from "no such signal". */
  signalGatedEmpty: boolean;
}

const ENTITY_LIMIT = 50;

export async function runSearch(
  client: SupabaseClient,
  rawQuery: string,
  referenceMonth: string
): Promise<SearchOutcome> {
  const parsed = parseQuery(rawQuery);

  if (parsed.intent === "empty") {
    return { parsed, primaryMode: "empty", entityCompanies: [], signalResults: [], signalGatedEmpty: false };
  }

  // Signal (and only signal) intent runs the evidence-gated ranker. "mixed"
  // ("Razorpay ghosting") is entity-first: the user named a company, so we
  // resolve the company and let its page carry the dimension.
  if (parsed.intent === "signal") {
    const analytics = await loadCompanyAnalytics(client);
    const specs: SignalSpec[] = parsed.signals.map((s) => ({ dimensionKey: s.dimensionKey, direction: s.direction }));
    const ranked = rankSignalResults(analytics.ranked.concat(analytics.unranked), specs, referenceMonth);
    const signalResults = ranked.map((r) => buildSignalResult(r, parsed.signals));
    return {
      parsed,
      primaryMode: "signal",
      entityCompanies: [],
      signalResults,
      signalGatedEmpty: signalResults.length === 0,
    };
  }

  // entity | mixed
  const entityCompanies = parsed.entityQuery
    ? await searchCompanies(client, parsed.entityQuery, ENTITY_LIMIT)
    : [];
  return { parsed, primaryMode: "entity", entityCompanies, signalResults: [], signalGatedEmpty: false };
}
