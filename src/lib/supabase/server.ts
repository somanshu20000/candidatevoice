/**
 * CandidateVoice — Supabase Server Client
 *
 * LEGAL NOTICE: This platform hosts user-generated content.
 * All data is anonymized. See Terms for liability.
 *
 * Use this client in:
 *   - Server Components
 *   - Route Handlers (app/api/*)
 *   - Server Actions
 *
 * This reads cookies to establish session context — required for
 * Next.js 14 App Router auth to work correctly server-side.
 *
 * Security note: This still uses the ANON key + user session.
 * RLS policies enforce what the authenticated user can access.
 * The SERVICE_ROLE_KEY is only used in createAdminClient() below,
 * and ONLY in trusted server-side admin contexts.
 */

import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * Standard server client — uses the user's session cookie.
 * RLS policies apply. Use for all normal data access.
 */
export function createClient() {
  const cookieStore = cookies();

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[CandidateVoice] Missing Supabase environment variables. " +
        "Copy .env.example to .env.local and fill in your values."
    );
  }

  return createServerClient<Database>(supabaseUrl, supabaseAnonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        } catch {
          // The `setAll` method is called from a Server Component.
          // Cookies can only be set from Route Handlers or Server Actions.
          // This error is safe to ignore if session refresh is not needed here.
        }
      },
    },
  });
}

/**
 * Admin server client — bypasses RLS using the SERVICE_ROLE_KEY.
 *
 * ⚠️  DANGER ZONE: Only use this in:
 *   - Moderation API routes
 *   - Admin-only Server Actions
 *   - Background jobs
 *
 * NEVER call this from a client component or expose to users.
 * NEVER use this for regular data reads — use createClient() instead.
 */
export function createAdminClient() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!supabaseUrl || !serviceRoleKey) {
    throw new Error(
      "[CandidateVoice] Missing SUPABASE_SERVICE_ROLE_KEY. " +
        "This is a server-only secret. Check your .env.local."
    );
  }

  // Import here to avoid bundling into client code
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createClient: createSupabaseClient } = require("@supabase/supabase-js");

  return createSupabaseClient<Database>(supabaseUrl, serviceRoleKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
}
