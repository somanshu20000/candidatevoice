/**
 * CandidateVoice — Supabase Browser Client
 *
 * LEGAL NOTICE: This platform hosts user-generated content.
 * All data is anonymized. See Terms for liability.
 *
 * Use this client in Client Components ("use client") only.
 * For Server Components, use @/lib/supabase/server.ts instead.
 *
 * Security note: This uses the ANON key, which is safe to expose.
 * All access is controlled by Supabase Row Level Security (RLS).
 * NEVER use the SERVICE_ROLE_KEY on the client side.
 */

import { createBrowserClient } from "@supabase/ssr";

import type { Database } from "@/types/database";

/**
 * Creates a Supabase client for use in browser/client components.
 * Reads from NEXT_PUBLIC_* env vars — safe to call from the client bundle.
 */
export function createClient() {
  // These are safe to expose — RLS enforces all access control
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !supabaseAnonKey) {
    throw new Error(
      "[CandidateVoice] Missing Supabase environment variables. " +
        "Copy .env.example to .env.local and fill in your values."
    );
  }

  return createBrowserClient<Database>(supabaseUrl, supabaseAnonKey);
}
