"use client";

import { FormEvent, useMemo, useState } from "react";
import { outcomeLabel, reasonLabel, stageLabel } from "@/utils/labels";

type PendingSubmission = {
  id: string;
  company: string;
  role: string;
  stage: string;
  outcome: string;
  reason: string;
  created_at: string;
};

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isReady = useMemo(() => secret.trim().length > 0, [secret]);

  async function loadPending(e?: FormEvent) {
    e?.preventDefault();
    if (!isReady) return;

    setLoading(true);
    setError(null);
    setMessage(null);

    const response = await fetch("/api/admin/list-pending", {
      method: "GET",
      headers: {
        Authorization: `Bearer ${secret.trim()}`,
      },
    });

    const body = (await response.json().catch(() => null)) as
      | { data?: PendingSubmission[]; error?: string }
      | null;

    if (!response.ok) {
      setError(body?.error ?? "Unable to load pending submissions.");
      setPending([]);
      setLoading(false);
      return;
    }

    setPending(body?.data ?? []);
    setLoading(false);
  }

  async function moderate(id: string, action: "approve" | "reject") {
    setError(null);
    setMessage(null);

    const response = await fetch(`/api/admin/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${secret.trim()}`,
      },
      body: JSON.stringify({ id }),
    });

    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Action failed.");
      return;
    }

    setMessage(action === "approve" ? "Submission approved." : "Submission rejected.");
    await loadPending();
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-14">
      <div className="mb-8 pb-6 border-b border-rule">
        <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">
          Internal
        </p>
        <h1 className="font-serif text-3xl text-ink mb-1">Admin Moderation</h1>
        <p className="text-sm text-ink-muted">
          Review pending submissions. Approved entries become publicly visible.
        </p>
      </div>

      <form
        onSubmit={loadPending}
        className="border border-rule bg-paper-sheet rounded-sm p-5 mb-8 shadow-sheet"
      >
        <label htmlFor="admin-secret" className="block text-sm font-medium text-ink mb-1.5">
          Admin secret
        </label>
        <div className="flex flex-col sm:flex-row gap-2.5">
          <input
            id="admin-secret"
            type="password"
            value={secret}
            onChange={(e) => setSecret(e.target.value)}
            placeholder="Enter ADMIN_SECRET"
            className="flex-1 bg-paper border border-rule text-ink text-sm rounded-sm px-3 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint"
          />
          <button
            type="submit"
            disabled={!isReady || loading}
            className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors whitespace-nowrap"
          >
            {loading ? "Loading…" : "Load Pending"}
          </button>
        </div>
      </form>

      {error && (
        <p className="text-sm text-bad border border-[#E6C4BF] bg-[#F9EEEC] rounded-sm px-4 py-3 mb-6">
          {error}
        </p>
      )}
      {message && (
        <p className="text-sm text-good border border-[#C5DBCC] bg-[#E8F0EA] rounded-sm px-4 py-3 mb-6">
          {message}
        </p>
      )}

      {!loading && pending.length === 0 && (
        <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
          <p className="text-sm text-ink-muted">No pending submissions.</p>
        </div>
      )}

      {pending.length > 0 && (
        <div className="space-y-4">
          {pending.map((item) => (
            <div
              key={item.id}
              className="border border-rule bg-paper-sheet rounded-sm p-5 shadow-sheet"
            >
              <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-rule">
                <h2 className="font-serif text-xl text-ink capitalize">{item.company}</h2>
                <span className="text-[11px] font-mono text-ink-faint shrink-0 tnum">
                  {new Date(item.created_at).toLocaleString()}
                </span>
              </div>

              <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm mb-5">
                <div className="flex gap-2">
                  <dt className="text-ink-muted shrink-0">Role</dt>
                  <dd className="text-ink">{item.role}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-muted shrink-0">Stage</dt>
                  <dd className="text-ink">{stageLabel(item.stage)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-muted shrink-0">Outcome</dt>
                  <dd className="text-ink">{outcomeLabel(item.outcome)}</dd>
                </div>
                <div className="flex gap-2">
                  <dt className="text-ink-muted shrink-0">Reason</dt>
                  <dd className="text-ink">{reasonLabel(item.reason)}</dd>
                </div>
              </dl>

              <div className="flex gap-2.5">
                <button
                  type="button"
                  onClick={() => moderate(item.id, "approve")}
                  className="bg-accent text-paper-sheet text-sm font-medium px-4 py-2 rounded-sm hover:bg-accent-hover transition-colors"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => moderate(item.id, "reject")}
                  className="border border-rule-strong bg-paper-sheet text-ink-soft text-sm px-4 py-2 rounded-sm hover:border-bad hover:text-bad transition-colors"
                >
                  Reject
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
