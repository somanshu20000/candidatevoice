/**
 * Live presence — bot/crawler/health-check exclusion. Pure string matching,
 * no I/O. A heartbeat from a matched User-Agent (or with no User-Agent at
 * all — every real browser sends one) is never recorded: it would inflate
 * the count with non-human traffic, which is exactly the "no fake counts"
 * invariant applied to the input side, not just the display side.
 *
 * Deliberately a denylist of well-known bot/tooling signatures, not an
 * attempt at real bot-detection (fingerprinting, behavioural analysis) —
 * that is a much larger, different problem this feature does not need to
 * solve. This stops the obvious, common cases (search crawlers, uptime
 * monitors, curl/scripted requests, headless-browser defaults) named in the
 * requirement, not a determined adversary.
 */

const BOT_PATTERNS: RegExp[] = [
  /bot/i,
  /spider/i,
  /crawl/i,
  /slurp/i, // Yahoo
  /googlebot/i,
  /bingbot/i,
  /duckduckbot/i,
  /baiduspider/i,
  /yandexbot/i,
  /facebookexternalhit/i,
  /twitterbot/i,
  /linkedinbot/i,
  /whatsapp/i,
  /telegrambot/i,
  /discordbot/i,
  /slackbot/i,
  /pingdom/i,
  /uptimerobot/i,
  /statuscake/i,
  /site24x7/i,
  /healthcheck/i,
  /monitor/i,
  /^curl/i,
  /^wget/i,
  /python-requests/i,
  /python-urllib/i,
  /^okhttp/i,
  /^axios/i,
  /^node-fetch/i,
  /^go-http-client/i,
  /headlesschrome/i,
  /phantomjs/i,
  /playwright/i,
  /puppeteer/i,
  /selenium/i,
  /vercel-cron/i,
  /lighthouse/i,
];

/** True for a missing/empty User-Agent (no real browser omits it) or one
 *  matching a known bot/tooling signature. */
export function isLikelyBot(userAgent: string | null | undefined): boolean {
  if (!userAgent || userAgent.trim().length === 0) return true;
  return BOT_PATTERNS.some((re) => re.test(userAgent));
}
