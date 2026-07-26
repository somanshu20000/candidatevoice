/**
 * Shared harness for the company-import scripts.
 *
 * A deliberately standalone Supabase admin client lives here rather than reusing
 * src/lib/supabase/server.ts: that module imports `next/headers` at load time,
 * which only exists inside a Next.js request. These scripts run under plain
 * Node (via tsx), so they build their own service-role client from env.
 */

import { readFileSync, existsSync } from "fs";
import { resolve } from "path";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Load environment variables from .env.local / .env without adding a dotenv
 * dependency. Only fills keys that are not already set, so real shell env wins.
 */
export function loadEnv(): void {
  for (const file of [".env.local", ".env"]) {
    const path = resolve(process.cwd(), file);
    if (!existsSync(path)) continue;
    const text = readFileSync(path, "utf8");
    for (const line of text.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const eq = trimmed.indexOf("=");
      if (eq === -1) continue;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (process.env[key] === undefined) process.env[key] = value;
    }
  }
}

/** Service-role client. Throws a clear message when secrets are absent. */
export function adminClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY. " +
        "Set them in .env.local or the shell before running a company-import script."
    );
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } });
}

/** Minimal --flag value / --flag=value parser. Returns a map plus positionals. */
export function parseArgs(argv: string[]): { flags: Map<string, string>; positional: string[]; has: (f: string) => boolean } {
  const flags = new Map<string, string>();
  const positional: string[] = [];
  const boolean = new Set<string>();

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg.startsWith("--")) {
      const body = arg.slice(2);
      const eq = body.indexOf("=");
      if (eq !== -1) {
        flags.set(body.slice(0, eq), body.slice(eq + 1));
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith("--")) {
        flags.set(body, argv[++i]);
      } else {
        boolean.add(body);
        flags.set(body, "true");
      }
    } else {
      positional.push(arg);
    }
  }

  return { flags, positional, has: (f: string) => flags.has(f) || boolean.has(f) };
}

export function requireFlag(flags: Map<string, string>, name: string): string {
  const value = flags.get(name);
  if (value === undefined) throw new Error(`Missing required --${name}`);
  return value;
}

/** Detect json vs csv from a file path. */
export function formatFromPath(path: string): "json" | "csv" {
  return path.toLowerCase().endsWith(".csv") ? "csv" : "json";
}

// ANSI helpers — plain functions so output reads clearly in a terminal.
export const c = {
  bold: (s: string) => `\x1b[1m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
};
