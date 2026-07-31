import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * The shared browser-side Supabase singleton.
 *
 * Intentionally UNTYPED. The hand-authored `Database` type in src/types
 * describes only `hiring_submissions`; every public read path now goes through
 * views it does not declare (public_submissions, public_external_reports), and
 * generic-typing the client makes those resolve to `never`. The server-side
 * readers cast to an untyped client for the same reason — this keeps the
 * browser consistent with them rather than inventing a third convention.
 *
 * Env vars are validated here rather than asserted with `!`. The previous
 * version passed `process.env.NEXT_PUBLIC_SUPABASE_URL!` straight in, so a
 * missing value surfaced as supabase-js's opaque internal error at module
 * evaluation — before any component could catch it — instead of naming the
 * actual problem.
 */

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "[CandidateVoice] Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY. " +
      "Copy .env.example to .env.local and fill in your values, then restart the dev server."
  );
}

export const supabase: SupabaseClient = createClient(supabaseUrl, supabaseAnonKey);
