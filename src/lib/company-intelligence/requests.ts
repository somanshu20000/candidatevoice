/**
 * M5.1 — Company-request moderation: the admin-side half of the "add a
 * company" loop. `resolve.ts`'s `createCompanyRequest` already writes pending
 * rows into `company_requests` from the submit flow's "Company isn't listed"
 * path; this module is what was missing — read the queue, and turn a request
 * into either a new canonical organization, a link to an existing one, or a
 * rejection. Without this, a queued request had no code path to ever become
 * a searchable company.
 *
 * D-009 (never silently choose or create): promotion re-resolves the
 * candidate slug via the SAME `resolve_organization()` RPC the rest of the
 * codebase already trusts (`store.ts`'s `resolveOrganization`,
 * `submit_hiring_report`'s own resolution) IMMEDIATELY before writing — the
 * request may have been filed weeks ago; the organization directory has
 * moved on since. If that resolves to an existing organization, promotion
 * refuses rather than creating a duplicate and tells the admin to merge
 * instead. A secondary domain check catches the case a differently-named
 * request ("Google" vs the legal "Alphabet Inc.") is still the same real
 * employer.
 *
 * Every mutation re-checks `status = 'pending'` in the same UPDATE and
 * requires the update to actually match a row — the guard against two admins
 * (or a promote racing a reject) acting on the same request twice.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { canonicalizeSlug } from "./normalize";
import { organizationExists } from "./resolve";

export type CompanyRequestStatus = "pending" | "approved" | "rejected" | "merged";

export interface CompanyRequestRow {
  id: string;
  requestedName: string;
  requestedDomain: string | null;
  requesterNote: string | null;
  status: CompanyRequestStatus;
  resolvedOrganizationId: string | null;
  createdAt: string;
  reviewedAt: string | null;
}

interface RawRequestRow {
  id: string;
  requested_name: string;
  requested_domain: string | null;
  requester_note: string | null;
  status: CompanyRequestStatus;
  resolved_organization_id: string | null;
  created_at: string;
  reviewed_at: string | null;
}

function toRow(r: RawRequestRow): CompanyRequestRow {
  return {
    id: r.id,
    requestedName: r.requested_name,
    requestedDomain: r.requested_domain,
    requesterNote: r.requester_note,
    status: r.status,
    resolvedOrganizationId: r.resolved_organization_id,
    createdAt: r.created_at,
    reviewedAt: r.reviewed_at,
  };
}

const REQUEST_SELECT =
  "id, requested_name, requested_domain, requester_note, status, resolved_organization_id, created_at, reviewed_at";

export async function listPendingCompanyRequests(supabase: SupabaseClient): Promise<CompanyRequestRow[]> {
  const { data, error } = await supabase
    .from("company_requests")
    .select(REQUEST_SELECT)
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw new Error(`listPendingCompanyRequests: ${error.message}`);
  return ((data ?? []) as unknown as RawRequestRow[]).map(toRow);
}

async function loadRequest(supabase: SupabaseClient, requestId: string): Promise<CompanyRequestRow | null> {
  const { data, error } = await supabase.from("company_requests").select(REQUEST_SELECT).eq("id", requestId).maybeSingle();
  if (error) throw new Error(`loadRequest(${requestId}): ${error.message}`);
  return data ? toRow(data as unknown as RawRequestRow) : null;
}

/** The exact resolver `store.ts`'s `resolveOrganization` and
 *  `submit_hiring_report` already trust — exact slug, alias, or
 *  canonicalized-slug match (migration 0002). */
async function resolveExistingOrganization(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const { data, error } = await (
    supabase as unknown as {
      rpc: (fn: string, args: Record<string, unknown>) => Promise<{ data: string | null; error: { message: string } | null }>;
    }
  ).rpc("resolve_organization", { p_slug: slug });
  if (error) throw new Error(`resolve_organization(${slug}): ${error.message}`);
  return data ?? null;
}

/** Secondary collision guard: a real employer's website domain, independent
 *  of what name it was requested under. Best-effort — a query failure here
 *  never blocks promotion; the slug resolve above is the authoritative check. */
async function findOrganizationByDomain(supabase: SupabaseClient, domain: string): Promise<string | null> {
  const normalized = domain
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .split("/")[0];
  if (!normalized) return null;
  const { data, error } = await supabase
    .from("company_links")
    .select("organization_id")
    .eq("normalized_domain", normalized)
    .limit(1)
    .maybeSingle();
  if (error) return null;
  return (data as { organization_id: string } | null)?.organization_id ?? null;
}

export interface SimpleResult {
  ok: boolean;
  error?: string;
}

export type PromoteResult =
  | { ok: true; organizationId: string; slug: string }
  | { ok: false; error: string; existingOrganizationId?: string };

/**
 * Promote a pending request into exactly one new canonical organization — or
 * refuse if it turns out to already resolve to one (D-009). Never creates a
 * second organization for a name/domain that already has one.
 */
export async function promoteCompanyRequest(supabase: SupabaseClient, requestId: string): Promise<PromoteResult> {
  const request = await loadRequest(supabase, requestId);
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "pending") return { ok: false, error: `Request is already ${request.status}, not pending.` };

  const slug = canonicalizeSlug(request.requestedName);
  if (!slug) return { ok: false, error: "The requested name cannot be turned into a valid company slug." };

  // D-009: re-resolve IMMEDIATELY before creating — never trust that "isn't
  // listed" is still true by the time an admin reviews a queued request.
  const bySlug = await resolveExistingOrganization(supabase, slug);
  if (bySlug) {
    return {
      ok: false,
      error: "This name already resolves to an existing organization — use merge instead.",
      existingOrganizationId: bySlug,
    };
  }
  if (request.requestedDomain) {
    const byDomain = await findOrganizationByDomain(supabase, request.requestedDomain);
    if (byDomain) {
      return {
        ok: false,
        error: "The requested domain already belongs to an existing organization — use merge instead.",
        existingOrganizationId: byDomain,
      };
    }
  }

  // Create exactly one organization. ON CONFLICT DO NOTHING + re-select
  // mirrors store.ts's createOrganization — a concurrent creator (another
  // admin, or a race on this same slug) never causes a hard failure or a
  // duplicate row; both converge on whichever row won the race.
  const { error: insertError } = await supabase
    .from("organizations")
    .upsert({ slug, display_name: request.requestedName.trim() }, { onConflict: "slug", ignoreDuplicates: true });
  if (insertError) return { ok: false, error: `Unable to create organization: ${insertError.message}` };

  const { data: org, error: selectError } = await supabase.from("organizations").select("id").eq("slug", slug).single();
  if (selectError || !org) {
    return { ok: false, error: `Organization was not found after creation: ${selectError?.message ?? "unknown error"}` };
  }
  const organizationId = (org as { id: string }).id;

  // Guard against two admins acting on the same request concurrently: the
  // status='pending' condition means only the FIRST such update actually
  // matches a row. select().maybeSingle() lets us detect the race and say so,
  // even though the organization itself was already safely created/reused above.
  const { data: updated, error: updateError } = await supabase
    .from("company_requests")
    .update({ status: "approved", resolved_organization_id: organizationId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (updateError) return { ok: false, error: `Organization created but request update failed: ${updateError.message}` };
  if (!updated) return { ok: false, error: "Request was already resolved by another admin action." };

  return { ok: true, organizationId, slug };
}

/** Link a request to an ALREADY-EXISTING organization the admin identified.
 *  Creates nothing — the entire point of merge is "this was never a new
 *  company." */
export async function mergeCompanyRequest(
  supabase: SupabaseClient,
  requestId: string,
  organizationId: string
): Promise<SimpleResult> {
  const request = await loadRequest(supabase, requestId);
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "pending") return { ok: false, error: `Request is already ${request.status}, not pending.` };

  const exists = await organizationExists(supabase, organizationId);
  if (!exists) return { ok: false, error: "The organization id to merge into does not exist." };

  const { data: updated, error } = await supabase
    .from("company_requests")
    .update({ status: "merged", resolved_organization_id: organizationId, reviewed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Request was already resolved by another admin action." };
  return { ok: true };
}

/** Reject — no organization is touched or created. */
export async function rejectCompanyRequest(supabase: SupabaseClient, requestId: string): Promise<SimpleResult> {
  const request = await loadRequest(supabase, requestId);
  if (!request) return { ok: false, error: "Request not found." };
  if (request.status !== "pending") return { ok: false, error: `Request is already ${request.status}, not pending.` };

  const { data: updated, error } = await supabase
    .from("company_requests")
    .update({ status: "rejected", reviewed_at: new Date().toISOString() })
    .eq("id", requestId)
    .eq("status", "pending")
    .select("id")
    .maybeSingle();
  if (error) return { ok: false, error: error.message };
  if (!updated) return { ok: false, error: "Request was already resolved by another admin action." };
  return { ok: true };
}
