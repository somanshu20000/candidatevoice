import crypto from "crypto";

const COOKIE_NAME = "unlocked_companies";
const COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24; // 24 hours
const MAX_UNLOCKED_COMPANIES = 20;

export function normalizeCompanySlug(input: string) {
  return input.toLowerCase().trim().replace(/\s+/g, "-");
}

function getCookieSecret() {
  return process.env.COOKIE_SECRET ?? "";
}

function sign(data: string) {
  const secret = getCookieSecret();
  if (!secret) return "";
  return crypto.createHmac("sha256", secret).update(data).digest("base64url");
}

export function encodeUnlockedCompaniesCookie(companies: string[]) {
  const unique = Array.from(
    new Set(companies.map((company) => normalizeCompanySlug(company)).filter(Boolean))
  ).slice(-MAX_UNLOCKED_COMPANIES);

  const payloadB64 = Buffer.from(JSON.stringify(unique), "utf8").toString("base64url");
  const signature = sign(payloadB64);
  if (!signature) return "";
  return `${payloadB64}.${signature}`;
}

export function decodeUnlockedCompaniesCookie(value?: string) {
  try {
    if (!value) return [];

    const [payloadB64, signature] = value.split(".");
    if (!payloadB64 || !signature) return [];

    const expectedSignature = sign(payloadB64);
    if (!expectedSignature || signature !== expectedSignature) return [];

    const decoded = Buffer.from(payloadB64, "base64url").toString("utf8");
    const parsed = JSON.parse(decoded);
    if (!Array.isArray(parsed)) return [];

    return Array.from(
      new Set(parsed.filter((item): item is string => typeof item === "string").map(normalizeCompanySlug))
    ).slice(-MAX_UNLOCKED_COMPANIES);
  } catch {
    return [];
  }
}

export function addCompanyToUnlockedCompanies(existing: string[], company: string) {
  const normalizedCompany = normalizeCompanySlug(company);
  if (!normalizedCompany) return Array.from(new Set(existing)).slice(-MAX_UNLOCKED_COMPANIES);

  const deduped = existing
    .map(normalizeCompanySlug)
    .filter((entry) => entry && entry !== normalizedCompany);

  deduped.push(normalizedCompany);
  return Array.from(new Set(deduped)).slice(-MAX_UNLOCKED_COMPANIES);
}

export function getUnlockCookieOptions() {
  return {
    httpOnly: true as const,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: COOKIE_MAX_AGE_SECONDS,
  };
}

export { COOKIE_NAME };
