"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  outcomeLabel,
  reasonLabel,
  stageLabel,
  experienceLabel,
  responseTimeLabel,
  lastInteractionGapLabel,
} from "@/utils/labels";

type PendingSubmission = {
  id: string;
  company: string;
  role: string;
  stage: string;
  outcome: string;
  reason: string;
  created_at: string;
};

interface RelatedReportRef {
  id: string;
  sourceKey: string;
  status: "pending" | "approved" | "rejected" | "archived";
  stage: string | null;
  outcome: string | null;
  ingestedAt: string;
}

interface ExternalQueueItem {
  id: string;
  company: string;
  organizationId: string | null;
  role: string | null;
  sourceKey: string;
  sourceName: string;
  trustWeight: number;
  sourceUrl: string;
  externalRef: string | null;
  contentHash: string;
  experienceBucket: string | null;
  stage: string | null;
  outcome: string | null;
  responseTimeBucket: string | null;
  lastInteractionGap: string | null;
  reason: string | null;
  paymentFlag: boolean | null;
  reportedMonth: string | null;
  extractionVersion: string | null;
  extractionConfidence: number | null;
  fieldsExtracted: string[];
  validationWarnings: { field: string; message: string }[];
  ingestedAt: string;
  duplicates: RelatedReportRef[];
  related: RelatedReportRef[];
}

type Tab = "hiring" | "external";

const STATUS_DOT: Record<RelatedReportRef["status"], string> = {
  pending: "bg-[#C9A227]",
  approved: "bg-good",
  rejected: "bg-bad",
  archived: "bg-ink-faint",
};

function pct(n: number | null): string {
  return n === null ? "—" : `${Math.round(n * 100)}%`;
}

/** Compact one-line summary of a duplicate/related report for the review card. */
function RelatedRow({ ref }: { ref: RelatedReportRef }) {
  const bits = [ref.sourceKey, ref.stage ? stageLabel(ref.stage) : null, ref.outcome ? outcomeLabel(ref.outcome) : null].filter(
    Boolean
  );
  return (
    <li className="flex items-center gap-2 text-xs text-ink-soft">
      <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${STATUS_DOT[ref.status]}`} aria-hidden="true" />
      <span>{bits.join(" · ")}</span>
      <span className="text-ink-faint">({ref.status})</span>
    </li>
  );
}

export default function AdminPage() {
  const [secret, setSecret] = useState("");
  const [tab, setTab] = useState<Tab>("hiring");
  const [pending, setPending] = useState<PendingSubmission[]>([]);
  const [externalPending, setExternalPending] = useState<ExternalQueueItem[]>([]);
  const [loaded, setLoaded] = useState<Record<Tab, boolean>>({ hiring: false, external: false });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const isReady = useMemo(() => secret.trim().length > 0, [secret]);

  async function loadTab(which: Tab) {
    if (!isReady) return;
    setLoading(true);
    setError(null);
    setMessage(null);

    const url = which === "hiring" ? "/api/admin/list-pending" : "/api/admin/external/list-pending";
    const response = await fetch(url, { headers: { Authorization: `Bearer ${secret.trim()}` } });
    const body = (await response.json().catch(() => null)) as
      | { data?: PendingSubmission[] | ExternalQueueItem[]; error?: string }
      | null;

    if (!response.ok) {
      setError(body?.error ?? "Unable to load pending items.");
      setLoading(false);
      return;
    }

    if (which === "hiring") setPending((body?.data ?? []) as PendingSubmission[]);
    else setExternalPending((body?.data ?? []) as ExternalQueueItem[]);
    setLoaded((prev) => ({ ...prev, [which]: true }));
    setLoading(false);
  }

  async function handleUnlock(e: FormEvent) {
    e.preventDefault();
    await loadTab(tab);
  }

  function selectTab(next: Tab) {
    setTab(next);
    setError(null);
    setMessage(null);
    if (isReady && !loaded[next]) void loadTab(next);
  }

  async function moderateHiring(id: string, action: "approve" | "reject") {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/admin/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret.trim()}` },
      body: JSON.stringify({ id }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Action failed.");
      return;
    }
    setMessage(action === "approve" ? "Submission approved." : "Submission rejected.");
    await loadTab("hiring");
  }

  async function moderateExternal(id: string, action: "approve" | "reject" | "archive") {
    setError(null);
    setMessage(null);
    const response = await fetch(`/api/admin/external/${action}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret.trim()}` },
      body: JSON.stringify({ id }),
    });
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    if (!response.ok) {
      setError(body?.error ?? "Action failed.");
      return;
    }
    setMessage(
      action === "approve" ? "Report approved — now part of weighted evidence." : action === "reject" ? "Report rejected." : "Report archived."
    );
    await loadTab("external");
  }

  return (
    <main className="max-w-4xl mx-auto px-4 py-14">
      <div className="mb-8 pb-6 border-b border-rule">
        <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">Internal</p>
        <h1 className="font-serif text-3xl text-ink mb-1">Admin Moderation</h1>
        <p className="text-sm text-ink-muted">
          Moderation is the trust boundary. Nothing here influences the product until approved.
        </p>
      </div>

      <form onSubmit={handleUnlock} className="border border-rule bg-paper-sheet rounded-sm p-5 mb-6 shadow-sheet">
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

      <div className="flex gap-2 mb-6 border-b border-rule">
        {(
          [
            ["hiring", "Hiring Reports", pending.length],
            ["external", "External Reports", externalPending.length],
          ] as const
        ).map(([value, label, count]) => (
          <button
            key={value}
            type="button"
            onClick={() => selectTab(value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === value ? "border-accent text-ink" : "border-transparent text-ink-muted hover:text-ink"
            }`}
          >
            {label}
            {loaded[value] && count > 0 && <span className="ml-1.5 text-xs font-mono text-ink-faint">({count})</span>}
          </button>
        ))}
      </div>

      {error && (
        <p className="text-sm text-bad border border-[#E6C4BF] bg-[#F9EEEC] rounded-sm px-4 py-3 mb-6">{error}</p>
      )}
      {message && (
        <p className="text-sm text-good border border-[#C5DBCC] bg-[#E8F0EA] rounded-sm px-4 py-3 mb-6">{message}</p>
      )}

      {tab === "hiring" && (
        <>
          {!loading && loaded.hiring && pending.length === 0 && (
            <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
              <p className="text-sm text-ink-muted">No pending submissions.</p>
            </div>
          )}
          {pending.length > 0 && (
            <div className="space-y-4">
              {pending.map((item) => (
                <div key={item.id} className="border border-rule bg-paper-sheet rounded-sm p-5 shadow-sheet">
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
                      onClick={() => moderateHiring(item.id, "approve")}
                      className="bg-accent text-paper-sheet text-sm font-medium px-4 py-2 rounded-sm hover:bg-accent-hover transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => moderateHiring(item.id, "reject")}
                      className="border border-rule-strong bg-paper-sheet text-ink-soft text-sm px-4 py-2 rounded-sm hover:border-bad hover:text-bad transition-colors"
                    >
                      Reject
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}

      {tab === "external" && (
        <>
          {!loading && loaded.external && externalPending.length === 0 && (
            <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
              <p className="text-sm text-ink-muted">No pending external reports.</p>
            </div>
          )}
          {externalPending.length > 0 && (
            <div className="space-y-4">
              {externalPending.map((item) => (
                <div key={item.id} className="border border-rule bg-paper-sheet rounded-sm p-5 shadow-sheet">
                  {/* Header: employer + source + when */}
                  <div className="flex items-start justify-between gap-3 mb-4 pb-3 border-b border-rule">
                    <div>
                      <h2 className="font-serif text-xl text-ink capitalize">{item.company}</h2>
                      <p className="text-xs text-ink-muted mt-0.5">
                        {item.role ?? "Role not extracted"}
                        {item.reportedMonth ? ` · ${item.reportedMonth}` : ""}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <span className="inline-block text-[10px] font-mono uppercase tracking-wider text-ink-muted border border-rule px-2 py-0.5 rounded-sm">
                        {item.sourceName}
                      </span>
                      <p className="text-[11px] font-mono text-ink-faint mt-1 tnum">
                        {new Date(item.ingestedAt).toLocaleString()}
                      </p>
                    </div>
                  </div>

                  {/* Structured signal */}
                  <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2.5 text-sm mb-4">
                    <Field label="Experience" value={item.experienceBucket ? experienceLabel(item.experienceBucket) : null} />
                    <Field label="Stage" value={item.stage ? stageLabel(item.stage) : null} />
                    <Field label="Outcome" value={item.outcome ? outcomeLabel(item.outcome) : null} />
                    <Field label="Reason" value={item.reason ? reasonLabel(item.reason) : null} />
                    <Field label="Response time" value={item.responseTimeBucket ? responseTimeLabel(item.responseTimeBucket) : null} />
                    <Field label="Last interaction" value={item.lastInteractionGap ? lastInteractionGapLabel(item.lastInteractionGap) : null} />
                    <Field
                      label="Payment asked"
                      value={item.paymentFlag === null ? null : item.paymentFlag ? "Yes" : "No"}
                    />
                  </dl>

                  {/* Provenance + explainability */}
                  <div className="border-t border-rule pt-3 mb-4">
                    <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-2">
                      Provenance &amp; explainability
                    </p>
                    <dl className="grid sm:grid-cols-2 gap-x-6 gap-y-2 text-xs">
                      <div className="flex gap-2">
                        <dt className="text-ink-faint shrink-0 w-32">Source URL</dt>
                        <dd className="min-w-0">
                          <a
                            href={item.sourceUrl}
                            target="_blank"
                            rel="noopener noreferrer nofollow"
                            className="text-accent hover:underline truncate block"
                          >
                            {item.sourceUrl}
                          </a>
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-faint shrink-0 w-32">Trust weight</dt>
                        <dd className="text-ink-soft tnum">{pct(item.trustWeight)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-faint shrink-0 w-32">Extraction version</dt>
                        <dd className="text-ink-soft font-mono">{item.extractionVersion ?? "unknown"}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-faint shrink-0 w-32">Extraction confidence</dt>
                        <dd className="text-ink-soft tnum">{pct(item.extractionConfidence)}</dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-faint shrink-0 w-32">Fields extracted</dt>
                        <dd className="text-ink-soft">
                          {item.fieldsExtracted.length > 0 ? item.fieldsExtracted.join(", ") : "none"}
                        </dd>
                      </div>
                      <div className="flex gap-2">
                        <dt className="text-ink-faint shrink-0 w-32">Content hash</dt>
                        <dd className="text-ink-faint font-mono truncate" title={item.contentHash}>
                          {item.contentHash.slice(0, 16)}…
                        </dd>
                      </div>
                    </dl>

                    {item.validationWarnings.length > 0 && (
                      <div className="mt-2.5 border border-[#E6C4BF] bg-[#F9EEEC] rounded-sm px-3 py-2">
                        <p className="text-[10px] font-mono uppercase tracking-wider text-bad mb-1">
                          Validation warnings
                        </p>
                        <ul className="text-xs text-bad space-y-0.5">
                          {item.validationWarnings.map((w, i) => (
                            <li key={i}>
                              <span className="font-mono">{w.field}</span>: {w.message}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>

                  {/* Duplicate / related matches */}
                  {(item.duplicates.length > 0 || item.related.length > 0) && (
                    <div className="border-t border-rule pt-3 mb-4">
                      {item.duplicates.length > 0 && (
                        <div className="mb-2.5">
                          <p className="text-[10px] font-mono uppercase tracking-wider text-bad mb-1.5">
                            Possible duplicate — same extracted content
                          </p>
                          <ul className="space-y-1">
                            {item.duplicates.map((d) => (
                              <RelatedRow key={d.id} ref={d} />
                            ))}
                          </ul>
                        </div>
                      )}
                      {item.related.length > 0 && (
                        <div>
                          <p className="text-[10px] font-mono uppercase tracking-wider text-ink-faint mb-1.5">
                            Other reports for this employer
                          </p>
                          <ul className="space-y-1">
                            {item.related.map((r) => (
                              <RelatedRow key={r.id} ref={r} />
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  )}

                  <div className="flex gap-2.5">
                    <button
                      type="button"
                      onClick={() => moderateExternal(item.id, "approve")}
                      className="bg-accent text-paper-sheet text-sm font-medium px-4 py-2 rounded-sm hover:bg-accent-hover transition-colors"
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      onClick={() => moderateExternal(item.id, "reject")}
                      className="border border-rule-strong bg-paper-sheet text-ink-soft text-sm px-4 py-2 rounded-sm hover:border-bad hover:text-bad transition-colors"
                    >
                      Reject
                    </button>
                    <button
                      type="button"
                      onClick={() => moderateExternal(item.id, "archive")}
                      className="border border-rule-strong bg-paper-sheet text-ink-faint text-sm px-4 py-2 rounded-sm hover:border-ink-muted hover:text-ink-muted transition-colors ml-auto"
                    >
                      Archive
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </main>
  );
}

function Field({ label, value }: { label: string; value: string | null }) {
  return (
    <div className="flex gap-2">
      <dt className="text-ink-muted shrink-0">{label}</dt>
      <dd className={value ? "text-ink" : "text-ink-faint italic"}>{value ?? "not extracted"}</dd>
    </div>
  );
}
