"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  PREFERENCE_DIMENSION_KEYS,
  PREFERENCE_DIMENSION_LABELS,
  PREFERENCE_DIMENSION_HELP,
  isEvidenceBacked,
} from "@/lib/advisor";
import type { PreferenceDimensionKey, PreferenceVector } from "@/lib/advisor";

/**
 * Preference onboarding — nine-plus 1-5 priorities. Explicit user input only;
 * nothing here is inferred (the whole advisor rests on that). On save it PUTs
 * the vector and refreshes the server component so recommendations and any
 * "Fit for you" panels recompute against the new priorities.
 */
export default function PreferenceForm({ initial }: { initial: PreferenceVector }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // Default any unrated dimension to 3 (neutral) so every slider has a position;
  // the user moving it away from neutral is the signal.
  const [weights, setWeights] = useState<Record<string, number>>(() => {
    const w: Record<string, number> = {};
    for (const key of PREFERENCE_DIMENSION_KEYS) w[key] = initial[key] ?? 3;
    return w;
  });

  function set(key: PreferenceDimensionKey, value: number) {
    setWeights((w) => ({ ...w, [key]: value }));
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/advisor/preferences", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ preferences: weights }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? "Could not save. Please try again.");
        return;
      }
      setSaved(true);
      startTransition(() => router.refresh());
    } catch {
      setError("Could not save. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet">
      <h2 className="font-serif text-lg text-ink mb-1">Your priorities</h2>
      <p className="text-xs text-ink-muted mb-5">
        Rate how much each matters, 1 (not important) to 5 (essential). We only match
        priorities against real reported evidence — the rest we keep honest about.
      </p>

      <div className="space-y-4">
        {PREFERENCE_DIMENSION_KEYS.map((key) => {
          const backed = isEvidenceBacked(key);
          return (
            <div key={key} className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 items-center">
              <div className="min-w-0">
                <label htmlFor={`pref-${key}`} className="text-sm text-ink-soft">
                  {PREFERENCE_DIMENSION_LABELS[key]}
                  {!backed && (
                    <span className="ml-2 text-[10px] font-mono uppercase tracking-wider text-ink-faint">
                      not measured yet
                    </span>
                  )}
                </label>
                <p className="text-[11px] text-ink-muted">{PREFERENCE_DIMENSION_HELP[key]}</p>
              </div>
              <div className="flex items-center gap-3">
                <input
                  id={`pref-${key}`}
                  type="range"
                  min={1}
                  max={5}
                  step={1}
                  value={weights[key]}
                  onChange={(e) => set(key, Number(e.target.value))}
                  className="w-32 accent-accent"
                  aria-label={PREFERENCE_DIMENSION_LABELS[key]}
                />
                <span className="font-mono text-sm text-ink tnum w-3 text-right">{weights[key]}</span>
              </div>
            </div>
          );
        })}
      </div>

      <p className="text-[11px] text-ink-faint mt-4 leading-relaxed border-t border-rule pt-4">
        <span className="font-medium text-ink-muted">Why some say &ldquo;not measured yet&rdquo;:</span>{" "}
        we score a priority only from what candidates can report first-hand about
        the hiring process. Things like salary, day-to-day balance, growth or
        prestige come from working somewhere, not interviewing there — so we
        collect your priority but never guess a company&apos;s score on it. Your
        rating still shapes the ones we <em>can</em> measure.
      </p>

      <div className="flex items-center gap-3 mt-6">
        <button
          onClick={save}
          disabled={saving || pending}
          className="bg-accent text-paper-sheet text-sm font-medium px-5 py-2.5 rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
        >
          {saving || pending ? "Saving…" : "Save priorities"}
        </button>
        {saved && !error && <span className="text-xs text-good">Saved · recommendations updated below</span>}
        {error && <span className="text-xs text-bad">{error}</span>}
      </div>
    </div>
  );
}
