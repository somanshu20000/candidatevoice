import crypto from "crypto";
import { NextRequest } from "next/server";
import { isLockedOut, recordFailedAttempt } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/client-ip";

const MAX_FAILED_ATTEMPTS = 10;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

// Constant-time secret comparison — a plain `!==` check leaks timing
// information proportional to how many leading bytes match, which is a real
// (if narrow) side channel against the only authZ boundary protecting
// moderation. crypto.timingSafeEqual throws on length mismatch, so unequal
// lengths are handled by comparing against a same-length dummy buffer first.
function timingSafeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a);
  const bBuf = Buffer.from(b);
  if (aBuf.length !== bBuf.length) {
    crypto.timingSafeEqual(aBuf, Buffer.alloc(aBuf.length));
    return false;
  }
  return crypto.timingSafeEqual(aBuf, bBuf);
}

export async function isAuthorizedAdmin(req: NextRequest) {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) {
    return { ok: false, status: 500, error: "ADMIN_SECRET is not configured." };
  }

  // Only failed attempts count toward lockout (recorded below), so this never
  // throttles the legitimate admin making repeated correct-secret requests.
  const ip = getClientIp(req);
  if (await isLockedOut("admin_auth", ip, MAX_FAILED_ATTEMPTS, LOCKOUT_WINDOW_MS)) {
    return { ok: false, status: 429, error: "Too many failed attempts. Try again later." };
  }

  const authHeader = req.headers.get("authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    await recordFailedAttempt("admin_auth", ip, LOCKOUT_WINDOW_MS);
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  const token = authHeader.slice("Bearer ".length);
  if (!timingSafeEqual(token, secret)) {
    await recordFailedAttempt("admin_auth", ip, LOCKOUT_WINDOW_MS);
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  return { ok: true, status: 200 };
}
