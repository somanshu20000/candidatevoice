"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

/**
 * Live presence — ONE shared session/heartbeat per browser tab, mounted once
 * in the root layout. Deliberately NOT one indicator per page: a company
 * page would otherwise need its own heartbeat loop with its own session_id
 * alongside the layout's global one, and since the heartbeat route counts
 * every row toward the global figure regardless of company scope, two
 * independent session rows for the same tab would double-count that visitor
 * globally. A single provider + a `setCompanySlug` scoping call from
 * whichever page needs it avoids that structurally — there is only ever one
 * session_id, one heartbeat interval, for the tab's whole visit.
 *
 * session_id is generated once via crypto.randomUUID() and lives only in a
 * ref — never persisted to storage, never the cv_candidate cookie, never
 * shared with any other identity in this codebase (ADR-0001 §4.3 disjoint-
 * ness applies here too, even though presence isn't evidence: nothing here
 * should ever become a linkage key for anything else).
 */

const HEARTBEAT_INTERVAL_MS = 55_000; // just under the ~60s cadence, comfortably inside the server's 120s active window

interface HeartbeatResponse {
  show_global: boolean;
  global_count: number | null;
  show_company: boolean;
  company_count: number | null;
}

interface PresenceState {
  showGlobal: boolean;
  globalCount: number | null;
  showCompany: boolean;
  companyCount: number | null;
}

const EMPTY_STATE: PresenceState = { showGlobal: false, globalCount: null, showCompany: false, companyCount: null };

interface PresenceContextValue extends PresenceState {
  /** Called by a page that wants its viewers counted toward a company figure
   *  too. Pass null (or unmount the caller) to leave company scope. */
  setCompanySlug: (slug: string | null) => void;
}

const PresenceContext = createContext<PresenceContextValue>({
  ...EMPTY_STATE,
  setCompanySlug: () => {},
});

export function usePresence(): PresenceContextValue {
  return useContext(PresenceContext);
}

export default function PresenceProvider({ children }: { children: React.ReactNode }) {
  const sessionIdRef = useRef<string | null>(null);
  const companySlugRef = useRef<string | null>(null);
  const [state, setState] = useState<PresenceState>(EMPTY_STATE);

  if (sessionIdRef.current === null && typeof crypto !== "undefined" && crypto.randomUUID) {
    sessionIdRef.current = crypto.randomUUID();
  }

  const sendHeartbeat = useCallback(async () => {
    const sessionId = sessionIdRef.current;
    if (!sessionId) return; // crypto.randomUUID unavailable (very old browser) — presence simply never shows
    try {
      const res = await fetch("/api/presence/heartbeat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          session_id: sessionId,
          company_slug: companySlugRef.current ?? undefined,
        }),
        // Never block/queue behind other work, and never surface a failure
        // to the visitor — graceful failure is the whole point.
        keepalive: true,
      });
      if (!res.ok) {
        setState(EMPTY_STATE);
        return;
      }
      const body = (await res.json()) as HeartbeatResponse;
      setState({
        showGlobal: body.show_global,
        globalCount: body.global_count,
        showCompany: body.show_company,
        companyCount: body.company_count,
      });
    } catch {
      // Network error, offline, blocked request — hide, never error.
      setState(EMPTY_STATE);
    }
  }, []);

  useEffect(() => {
    void sendHeartbeat();
    const id = setInterval(() => void sendHeartbeat(), HEARTBEAT_INTERVAL_MS);
    return () => clearInterval(id);
  }, [sendHeartbeat]);

  const setCompanySlug = useCallback(
    (slug: string | null) => {
      if (companySlugRef.current === slug) return;
      companySlugRef.current = slug;
      // Re-scope immediately rather than waiting up to 55s for the next
      // tick — a visitor navigating straight to a company page should see
      // (and count toward) the right figure right away.
      void sendHeartbeat();
    },
    [sendHeartbeat]
  );

  return (
    <PresenceContext.Provider value={{ ...state, setCompanySlug }}>
      {children}
    </PresenceContext.Provider>
  );
}
