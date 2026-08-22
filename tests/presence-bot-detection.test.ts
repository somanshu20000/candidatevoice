/**
 * Live presence — bot/admin/health-check exclusion (Task: "bot/admin
 * exclusion"). Pure string matching, no I/O.
 */
import { describe, expect, it } from "vitest";
import { isLikelyBot } from "@/lib/presence/bot-detection";

describe("isLikelyBot", () => {
  it("excludes missing/empty User-Agent — no real browser omits one", () => {
    expect(isLikelyBot(null)).toBe(true);
    expect(isLikelyBot(undefined)).toBe(true);
    expect(isLikelyBot("")).toBe(true);
    expect(isLikelyBot("   ")).toBe(true);
  });

  it("excludes well-known search/social crawlers", () => {
    expect(isLikelyBot("Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)")).toBe(true);
    expect(isLikelyBot("facebookexternalhit/1.1")).toBe(true);
    expect(isLikelyBot("Twitterbot/1.0")).toBe(true);
  });

  it("excludes uptime/health-check monitors", () => {
    expect(isLikelyBot("Pingdom.com_bot_version_1.4")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0+(compatible; UptimeRobot/2.0; http://www.uptimerobot.com/)")).toBe(true);
    expect(isLikelyBot("StatusCake")).toBe(true);
  });

  it("excludes scripted HTTP clients and headless-automation tooling", () => {
    expect(isLikelyBot("curl/8.4.0")).toBe(true);
    expect(isLikelyBot("python-requests/2.31.0")).toBe(true);
    expect(isLikelyBot("axios/1.6.0")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 HeadlessChrome/120.0.0.0")).toBe(true);
    expect(isLikelyBot("Mozilla/5.0 Playwright")).toBe(true);
  });

  it("excludes this project's own cron trigger", () => {
    expect(isLikelyBot("vercel-cron/1.0")).toBe(true);
  });

  it("does NOT exclude a real browser User-Agent", () => {
    expect(isLikelyBot(
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
    )).toBe(false);
    expect(isLikelyBot(
      "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1"
    )).toBe(false);
    expect(isLikelyBot(
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Safari/605.1.15"
    )).toBe(false);
  });
});
