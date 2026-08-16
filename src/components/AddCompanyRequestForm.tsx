"use client";

import { useState } from "react";

/**
 * The lightweight "Add this company" action that a company search with zero
 * matches was missing (message I's gap): POSTs directly to
 * /api/company-requests/create instead of routing into the full hiring-report
 * wizard, which was the only existing path into `company_requests`. Success
 * here means the request is queued for admin promote/merge (M5.1) — it never
 * creates a searchable organization by itself.
 */
export default function AddCompanyRequestForm({ defaultName }: { defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [domain, setDomain] = useState("");
  const [status, setStatus] = useState<"idle" | "submitting" | "done" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || status === "submitting") return;
    setStatus("submitting");
    setError(null);
    try {
      const res = await fetch("/api/company-requests/create", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), domain: domain.trim() || undefined }),
      });
      const payload = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(payload?.error ?? "Could not submit the request. Please try again.");
        setStatus("error");
        return;
      }
      setStatus("done");
    } catch {
      setError("Could not submit the request. Please try again.");
      setStatus("error");
    }
  }

  if (status === "done") {
    return (
      <p className="text-sm text-good mt-4">
        Thanks — “{name.trim()}” has been queued for review. It will appear in search once approved.
      </p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-2.5 max-w-sm mx-auto text-left">
      <label htmlFor="add-company-name" className="sr-only">
        Company name
      </label>
      <input
        id="add-company-name"
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Company name"
        required
        className="bg-paper border border-rule text-ink text-sm rounded-sm px-4 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors"
      />
      <label htmlFor="add-company-domain" className="sr-only">
        Website (optional)
      </label>
      <input
        id="add-company-domain"
        type="text"
        value={domain}
        onChange={(e) => setDomain(e.target.value)}
        placeholder="Website (optional, e.g. example.com)"
        className="bg-paper border border-rule text-ink text-sm rounded-sm px-4 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors"
      />
      <button
        type="submit"
        disabled={!name.trim() || status === "submitting"}
        className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
      >
        {status === "submitting" ? "Submitting…" : "Add this company"}
      </button>
      {error && <p className="text-xs text-bad">{error}</p>}
    </form>
  );
}
