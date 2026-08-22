import Link from "next/link";
import { redirect } from "next/navigation";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/server";
import { loadCompanyAnalytics } from "@/lib/evidence";
import type { CompanyAnalytics } from "@/lib/evidence";
import { computeFit } from "@/lib/advisor";
import type { FitResult } from "@/lib/advisor";
import { buildActionPlan } from "@/lib/fingerprint/actions";
import type { ActionPlan } from "@/lib/fingerprint/actions";
import type { BehaviouralDimensionKey } from "@/lib/fingerprint/behavioural";
import { readCandidateVector, hasPreferences, readCandidateId } from "@/lib/candidate/server";
import { isCompanySaved } from "@/lib/candidate/saved";
import { createAdminClient } from "@/lib/supabase/server";
import { normalizeCompanySlug } from "@/lib/company-slug";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Bar from "@/components/charts/Bar";
import Radar from "@/components/charts/Radar";
import SaveButton from "@/components/SaveButton";

export const dynamic = "force-dynamic"; // reads a per-visitor cookie

/** Hard cap — a comparison of more than this stops being scannable. */
const MAX_COMPANIES = 4;

interface Column {
  slug: string;
  displayName: string;
  organizationId: string | null;
  analytics: CompanyAnalytics | null; // null → in the directory but no evidence yet
  fit: FitResult | null;
  plan: ActionPlan | null;
  saved: boolean;
}

function parseCompanies(raw: string | string[] | undefined): string[] {
  const csv = Array.isArray(raw) ? raw.join(",") : (raw ?? "");
  const seen = new Set<string>();
  for (const part of csv.split(",")) {
    const slug = normalizeCompanySlug(part);
    if (slug) seen.add(slug);
  }
  return [...seen].slice(0, MAX_COMPANIES);
}

function dimRate(a: CompanyAnalytics | null, key: BehaviouralDimensionKey): number | null {
  if (!a) return null;
  const d = a.fingerprint.dimensions.find((x) => x.key === key);
  return d && !d.suppressed ? d.metric.value : null;
}

const VERDICT_LABEL: Record<ActionPlan["verdict"], string> = {
  apply: "Worth applying",
  apply_with_caution: "Apply with caution",
  insufficient: "Not enough data",
};
const VERDICT_CLS: Record<ActionPlan["verdict"], string> = {
  apply: "text-good border-[#C5DBCC] bg-[#E8F0EA]",
  apply_with_caution: "text-warn border-[#E3D4AE] bg-[#F4EEDD]",
  insufficient: "text-ink-muted border-rule-strong bg-paper-sunk",
};

function pct(v: number | null): string {
  return v === null ? "—" : `${Math.round(v * 100)}%`;
}

export default async function ComparePage({
  searchParams,
}: {
  searchParams: { companies?: string | string[]; add?: string };
}) {
  // Plain-GET-form "add": merge ?add into the list and redirect to a canonical
  // ?companies= URL. No client JS — same server-first pattern as the cohort form.
  const current = parseCompanies(searchParams.companies);
  const toAdd = normalizeCompanySlug(searchParams.add ?? "");
  if (toAdd && !current.includes(toAdd)) {
    const merged = [...current, toAdd].slice(0, MAX_COMPANIES);
    redirect(`/compare?companies=${encodeURIComponent(merged.join(","))}`);
  }

  const vector = await readCandidateVector();
  const usePrefs = hasPreferences(vector);

  const supabase = createClient() as unknown as SupabaseClient;
  const analytics = current.length > 0 ? await loadCompanyAnalytics(supabase).catch(() => null) : null;
  const bySlug = new Map<string, CompanyAnalytics>();
  if (analytics) for (const c of [...analytics.ranked, ...analytics.unranked]) bySlug.set(c.slug, c);

  // For requested slugs with no evidence, still resolve a display name (and
  // id, for the save button) so the column reads honestly ("no reports yet")
  // rather than vanishing.
  const missing = current.filter((s) => !bySlug.has(s));
  const infoBySlug = new Map<string, { id: string; displayName: string }>();
  if (missing.length > 0) {
    const { data } = await supabase.from("organizations").select("id, slug, display_name").in("slug", missing);
    for (const o of (data ?? []) as { id: string; slug: string; display_name: string }[]) {
      infoBySlug.set(o.slug, { id: o.id, displayName: o.display_name });
    }
  }

  // Saved state (Phase 2, product-experience audit) — read-only, same
  // cv_candidate cookie the advisor uses. RLS on candidate_saved_companies
  // needs the service-role client, unlike the anon `supabase` above.
  const candidateId = readCandidateId();
  const adminClient = candidateId ? (createAdminClient() as unknown as SupabaseClient) : null;

  const columns: Column[] = await Promise.all(
    current.map(async (slug) => {
      const a = bySlug.get(slug) ?? null;
      const organizationId = a?.organizationId ?? infoBySlug.get(slug)?.id ?? null;
      const saved =
        candidateId && adminClient && organizationId
          ? await isCompanySaved(adminClient, candidateId, organizationId).catch(() => false)
          : false;
      return {
        slug,
        displayName: a?.displayName ?? infoBySlug.get(slug)?.displayName ?? slug.replace(/-/g, " "),
        organizationId,
        analytics: a,
        fit: a && usePrefs ? computeFit(vector, a.fingerprint) : null,
        plan: a ? buildActionPlan(a.fingerprint, a.hqs) : null,
        saved,
      };
    })
  );

  // Radar comparison (Phase 5, product-experience audit) — same dimRate/HQS
  // reduction the table rows already use, just reshaped for a multi-axis
  // chart instead of a column of bars. Ghosting is inverted (100 - rate) so
  // every axis reads "higher is better," matching the table's own Ghosted bar.
  const RADAR_COLORS = ["text-accent", "text-good", "text-warn", "text-bad"];
  const radarAxes = ["Ghosting safety", "Offer rate", "Transparency", "Hiring quality"];
  const radarSeries = columns.map((c, i) => {
    const ghosting = dimRate(c.analytics, "ghosting");
    const offer = dimRate(c.analytics, "offer_probability");
    const transparency = dimRate(c.analytics, "transparency");
    const hqs = c.analytics?.hqs?.score ?? null;
    return {
      key: c.slug,
      label: c.displayName,
      colorClass: RADAR_COLORS[i % RADAR_COLORS.length],
      values: [
        ghosting === null ? null : 100 * (1 - ghosting),
        offer === null ? null : 100 * offer,
        transparency === null ? null : 100 * transparency,
        hqs,
      ],
    };
  });

  const removeHref = (slug: string) => {
    const rest = current.filter((s) => s !== slug);
    return rest.length ? `/compare?companies=${encodeURIComponent(rest.join(","))}` : "/compare";
  };

  const rows: { label: string; cell: (c: Column) => React.ReactNode }[] = [
    {
      label: "Verdict",
      cell: (c) =>
        c.plan ? (
          <span className={`inline-flex items-center border px-2 py-0.5 rounded-full text-[10px] font-mono uppercase tracking-wider ${VERDICT_CLS[c.plan.verdict]}`}>
            {VERDICT_LABEL[c.plan.verdict]}
          </span>
        ) : (
          <span className="text-xs text-ink-faint">No reports yet</span>
        ),
    },
    {
      label: "Hiring Quality Score",
      cell: (c) =>
        c.analytics?.hqs ? (
          <div className="w-24">
            <span className="font-serif text-2xl text-ink tnum">{c.analytics.hqs.score}</span>
            <Bar value={c.analytics.hqs.score} tone={c.analytics.hqs.score >= 70 ? "good" : c.analytics.hqs.score >= 40 ? "warn" : "bad"} className="mt-1" />
          </div>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
    ...(usePrefs
      ? [{ label: "Fit for you", cell: (c: Column) => (c.fit?.score != null ? <span className="font-serif text-xl text-ink tnum">{c.fit.score}</span> : <span className="text-ink-faint">—</span>) }]
      : []),
    {
      label: "Ghosted",
      cell: (c) => {
        const rate = dimRate(c.analytics, "ghosting");
        return (
          <div className="w-24">
            <span className="tnum text-ink-soft">{pct(rate)}</span>
            {/* Ghosting: LOWER is better, so the bar is inverted (100 - rate) and keeps the same good/bad reading as every other bar on this page. */}
            <Bar value={rate === null ? null : 100 * (1 - rate)} tone={rate === null ? "neutral" : rate <= 0.1 ? "good" : rate >= 0.25 ? "bad" : "warn"} className="mt-1" />
          </div>
        );
      },
    },
    {
      label: "Got an offer",
      cell: (c) => {
        const rate = dimRate(c.analytics, "offer_probability");
        return (
          <div className="w-24">
            <span className="tnum text-ink-soft">{pct(rate)}</span>
            <Bar value={rate === null ? null : 100 * rate} tone={rate === null ? "neutral" : rate >= 0.4 ? "good" : rate <= 0.15 ? "bad" : "warn"} className="mt-1" />
          </div>
        );
      },
    },
    {
      label: "Told why (transparency)",
      cell: (c) => {
        const rate = dimRate(c.analytics, "transparency");
        return (
          <div className="w-24">
            <span className="tnum text-ink-soft">{pct(rate)}</span>
            <Bar value={rate === null ? null : 100 * rate} tone={rate === null ? "neutral" : rate >= 0.7 ? "good" : rate <= 0.4 ? "bad" : "warn"} className="mt-1" />
          </div>
        );
      },
    },
    {
      label: "Evidence",
      cell: (c) =>
        c.analytics ? (
          <span className="text-[11px] font-mono text-ink-faint tnum">
            {c.analytics.base.rawTotal} reports · {c.analytics.base.effectiveN.toFixed(1)} eff
          </span>
        ) : (
          <span className="text-ink-faint">—</span>
        ),
    },
  ];

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />
      <main className="max-w-5xl mx-auto px-4 py-14 w-full flex-1">
        <div className="mb-8 pb-8 border-b border-rule">
          <h1 className="font-serif text-4xl text-ink mb-2">Compare companies</h1>
          <p className="text-ink-soft leading-relaxed">
            Put companies side by side on what candidates actually reported — verdict, hiring
            quality, ghosting, offer odds{usePrefs ? ", and your personal fit" : ""}. Every number
            traces to evidence; a blank means not enough reports yet.
          </p>
        </div>

        {/* Add a company — plain GET form, server merges + redirects. */}
        <form method="get" action="/compare" className="flex flex-wrap items-end gap-3 mb-8">
          <input type="hidden" name="companies" value={current.join(",")} />
          <div className="flex-1 min-w-[200px]">
            <label htmlFor="add" className="block text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-1.5">
              Add a company {current.length >= MAX_COMPANIES && <span className="text-ink-faint">(max {MAX_COMPANIES} reached)</span>}
            </label>
            <input
              id="add"
              name="add"
              placeholder="e.g. Stripe"
              disabled={current.length >= MAX_COMPANIES}
              className="w-full bg-paper border border-rule text-ink text-sm rounded-sm px-3 py-2.5 shadow-press focus:outline-none focus:border-accent transition-colors placeholder:text-ink-faint disabled:opacity-40"
            />
          </div>
          <button
            type="submit"
            disabled={current.length >= MAX_COMPANIES}
            className="bg-accent text-paper-sheet px-4 py-2.5 text-sm font-medium rounded-sm hover:bg-accent-hover disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
          >
            Add →
          </button>
        </form>

        {columns.length === 0 ? (
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-12 text-center">
            <p className="text-ink-soft mb-1">Nothing to compare yet.</p>
            <p className="text-sm text-ink-muted">Add two or more companies above to put them side by side.</p>
          </div>
        ) : (
          <div className="overflow-x-auto border border-rule bg-paper-sheet rounded-sm shadow-sheet">
            <table className="w-full border-collapse">
              <thead>
                <tr className="border-b border-rule">
                  <th className="text-left p-4 w-40 sticky left-0 bg-paper-sheet" />
                  {columns.map((c) => (
                    <th key={c.slug} className="text-left p-4 min-w-[160px] align-top">
                      <Link href={`/company/${encodeURIComponent(c.slug)}`} className="font-serif text-lg text-ink capitalize hover:text-accent transition-colors">
                        {c.displayName}
                      </Link>
                      <Link href={removeHref(c.slug)} className="block text-[10px] font-mono uppercase tracking-wider text-ink-faint hover:text-bad mt-1">
                        × remove
                      </Link>
                      {c.organizationId && (
                        <SaveButton
                          organizationId={c.organizationId}
                          initialSaved={c.saved}
                          className={`mt-2 inline-flex items-center gap-1.5 text-[10px] font-mono uppercase tracking-wider transition-colors ${
                            c.saved ? "text-accent" : "text-ink-faint hover:text-ink"
                          }`}
                        />
                      )}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {rows.map((row) => (
                  <tr key={row.label} className="border-b border-rule last:border-0">
                    <td className="p-4 text-xs text-ink-muted align-middle sticky left-0 bg-paper-sheet">{row.label}</td>
                    {columns.map((c) => (
                      <td key={c.slug} className="p-4 align-middle">{row.cell(c)}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {columns.length >= 2 && (
          <div className="border border-rule bg-paper-sheet rounded-sm shadow-sheet p-6 sm:p-8 mt-8">
            <h2 className="font-serif text-lg text-ink mb-1">Shape of the difference</h2>
            <p className="text-xs text-ink-muted mb-5">
              Ghosting safety, offer rate, transparency and hiring quality on one chart — every axis reads
              higher-is-better. A company missing a plotted dimension is left off rather than shown at zero.
            </p>
            <Radar axes={radarAxes} series={radarSeries} />
          </div>
        )}

        {!usePrefs && columns.length > 0 && (
          <p className="text-[11px] text-ink-faint mt-4">
            Want a personal fit column?{" "}
            <Link href="/advisor" className="text-accent hover:text-accent-hover underline">Set your priorities</Link>{" "}
            and they&apos;ll be scored against your preferences.
          </p>
        )}
      </main>
      <Footer />
    </div>
  );
}
