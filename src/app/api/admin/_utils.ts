import { NextRequest } from "next/server";

export function isAuthorizedAdmin(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const secret = process.env.ADMIN_SECRET;

  if (!secret) {
    return { ok: false, status: 500, error: "ADMIN_SECRET is not configured." };
  }

  if (!authHeader?.startsWith("Bearer ")) {
    return { ok: false, status: 401, error: "Missing authorization header." };
  }

  const token = authHeader.slice("Bearer ".length);
  if (token !== secret) {
    return { ok: false, status: 401, error: "Unauthorized." };
  }

  return { ok: true, status: 200 };
}
