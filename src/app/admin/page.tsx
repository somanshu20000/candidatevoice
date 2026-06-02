"use client";

import { FormEvent, useMemo, useState } from "react";

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
    <main className="max-w-5xl mx-auto px-4 py-10">
      <h1 className="text-2xl font-semibold mb-2">Admin Moderation</h1>
      <p className="text-sm text-gray-600 mb-6">
        Review pending submissions. Approved entries become publicly visible.
      </p>

      <form onSubmit={loadPending} className="flex flex-col sm:flex-row gap-2 mb-6">
        <input
          type="password"
          value={secret}
          onChange={(e) => setSecret(e.target.value)}
          placeholder="Enter ADMIN_SECRET"
          className="border rounded px-3 py-2 flex-1"
        />
        <button
          type="submit"
          disabled={!isReady || loading}
          className="border rounded px-4 py-2 disabled:opacity-50"
        >
          {loading ? "Loading..." : "Load Pending"}
        </button>
      </form>

      {error && <p className="text-sm text-red-600 mb-4">{error}</p>}
      {message && <p className="text-sm text-green-700 mb-4">{message}</p>}

      {!loading && pending.length === 0 && (
        <div className="border rounded p-4 text-sm text-gray-600">No pending submissions.</div>
      )}

      {pending.length > 0 && (
        <div className="space-y-3">
          {pending.map((item) => (
            <div key={item.id} className="border rounded p-4">
              <div className="grid sm:grid-cols-2 gap-2 text-sm mb-3">
                <p><strong>Company:</strong> {item.company}</p>
                <p><strong>Role:</strong> {item.role}</p>
                <p><strong>Stage:</strong> {item.stage}</p>
                <p><strong>Outcome:</strong> {item.outcome}</p>
                <p className="sm:col-span-2"><strong>Reason:</strong> {item.reason}</p>
                <p className="text-gray-600 sm:col-span-2">
                  <strong>Created:</strong> {new Date(item.created_at).toLocaleString()}
                </p>
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => moderate(item.id, "approve")}
                  className="border rounded px-3 py-1 text-sm"
                >
                  Approve
                </button>
                <button
                  type="button"
                  onClick={() => moderate(item.id, "reject")}
                  className="border rounded px-3 py-1 text-sm"
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
