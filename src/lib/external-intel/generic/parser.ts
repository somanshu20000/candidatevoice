/**
 * Generic acquisition PARSER — owns HTML parsing and nothing else (the
 * BeautifulSoup role, in TypeScript, per the no-parallel-Python-stack rule).
 * Strictly separated from acquisition: it takes an HTML STRING and a
 * selector spec, returns structured intermediate records. It never touches
 * a browser, the network, or the database — which is exactly what makes it
 * unit-testable against a static fixture with no live site (Task 3 req 11).
 *
 * Uses node-html-parser (tolerant of malformed HTML — a real requirement,
 * since a scraped page is never guaranteed well-formed). A record missing a
 * required field is not dropped silently: it's returned with the field null
 * and `partial: true`, so the extractor can decide (Task 3 reqs 5, "partial
 * extraction").
 *
 * Output is deliberately RAW STRINGS, not evidence enums — mapping raw text
 * onto CandidateVoice's closed dimensions is the extractor's job
 * (generic/extract.ts), kept separate so the parser has no knowledge of the
 * evidence model at all.
 */

import { parse, type HTMLElement } from "node-html-parser";

/** Which DOM selectors locate each field within one review "card". */
export interface ReviewSelectors {
  /** Selector for each repeated review container on the page. */
  card: string;
  /** Field selectors, run relative to each card. All optional except that
   *  a card with none of them yields nothing. */
  company?: string;
  role?: string;
  outcome?: string;
  stage?: string;
  experience?: string;
  responseTime?: string;
  lastGap?: string;
  reason?: string;
  reportedDate?: string;
  /** Attribute holding a stable per-review id (for external_ref), e.g. "data-review-id". */
  externalRefAttr?: string;
}

export interface ParsedRecord {
  company: string | null;
  role: string | null;
  outcome: string | null;
  stage: string | null;
  experience: string | null;
  responseTime: string | null;
  lastGap: string | null;
  reason: string | null;
  reportedDate: string | null;
  externalRef: string | null;
  /** True when a field required to form usable evidence (company) is absent. */
  partial: boolean;
}

export interface ParseResult {
  records: ParsedRecord[];
  /** Cards found on the page, including ones that produced a partial record. */
  cardsFound: number;
}

function textOf(root: HTMLElement, selector: string | undefined): string | null {
  if (!selector) return null;
  const el = root.querySelector(selector);
  if (!el) return null;
  // Collapse ALL whitespace runs (incl. &nbsp;/ , newlines, tabs) to a
  // single space and trim — real scraped markup is full of layout whitespace
  // and entities, and a value like "Meridian Media  Networks" must
  // normalize to "Meridian Media Networks" or it won't match anything.
  const t = el.text.replace(/\s+/g, " ").trim();
  return t.length > 0 ? t : null;
}

/**
 * Parse a review-listing page's HTML into structured records. Never throws
 * on malformed input — node-html-parser is tolerant, and a card that yields
 * no company is returned as `partial`, not an exception. A caller passing
 * HTML with zero matching cards gets `{records: [], cardsFound: 0}`.
 */
export function parseReviewPage(html: string, selectors: ReviewSelectors): ParseResult {
  const root = parse(html ?? "");
  const cards = root.querySelectorAll(selectors.card);
  const records: ParsedRecord[] = [];

  for (const card of cards) {
    const company = textOf(card, selectors.company);
    const externalRef = selectors.externalRefAttr
      ? card.getAttribute(selectors.externalRefAttr) ?? null
      : null;
    const record: ParsedRecord = {
      company,
      role: textOf(card, selectors.role),
      outcome: textOf(card, selectors.outcome),
      stage: textOf(card, selectors.stage),
      experience: textOf(card, selectors.experience),
      responseTime: textOf(card, selectors.responseTime),
      lastGap: textOf(card, selectors.lastGap),
      reason: textOf(card, selectors.reason),
      reportedDate: textOf(card, selectors.reportedDate),
      externalRef: externalRef && externalRef.trim().length > 0 ? externalRef.trim() : null,
      // "company" is the one field with no honest default — an evidence row
      // must name an employer. Everything else may legitimately be absent.
      partial: company === null,
    };
    records.push(record);
  }

  return { records, cardsFound: cards.length };
}
