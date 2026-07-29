"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import Link from "next/link";
import SubmissionCard from "@/components/SubmissionCard";
import CompanyCard from "@/components/CompanyCard";
import { supabase } from "@/lib/supabase/browser";
import { listCompanies, type CompanyListItem } from "@/lib/company-intelligence/directory";
import { normalizeCompanySlug } from "@/lib/company-slug";
import { reasonLabel, reasonSummary } from "@/utils/labels";
import type { HiringStage, SubmissionCardData } from "@/types/index";

type CardStage = "applied" | "screened" | "interviewed" | "final";

type BrowseRow = {
  id: string;
  company: string;
  role: string;
  stage: HiringStage;
  reason: string | null;
  created_at: string;
};

const STAGES: { value: HiringStage | "all"; label: string }[] = [
  { value: "all", label: "All Stages" },
  { value: "applied", label: "Applied" },
  { value: "screening", label: "Screening" },
  { value: "technical", label: "Technical" },
  { value: "hr", label: "HR" },
  { value: "final", label: "Final" },
];

const PAGE_SIZE = 9;

const SELECT_CLS =
  "bg-paper border border-rule text-ink-soft text-sm rounded-sm px-3 py-2 shadow-press focus:outline-none focus:border-accent transition-colors";

export default function BrowsePage() {
  const [company, setCompany] = useState("All Companies");
  const [stage, setStage] = useState<HiringStage | "all">("all");
  const [page, setPage] = useState(1);
  const [companyOptions, setCompanyOptions] = useState<string[]>(["All Companies"]);
  const [rows, setRows] = useState<SubmissionCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [companies, setCompanies] = useState<CompanyListItem[]>([]);
  const [companyTotal, setCompanyTotal] = useState(0);
  const [companiesLoading, setCompaniesLoading] = useState(true);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    [totalCount]
  );

  // A preview of the company directory. The full, paginated, searchable list
  // lives at /companies; this shows the first handful with a link through.
  useEffect(() => {
    async function loadCompanies() {
      try {
        const { items, total } = await listCompanies(supabase, { limit: 6, offset: 0 });
        setCompanies(items);
        setCompanyTotal(total);
      } catch {
        setCompanies([]);
      } finally {
        setCompaniesLoading(false);
      }
    }
    loadCompanies();
  }, []);

  // Maps the reported stage to its card label. `final` means the candidate
  // reached the final round — it asserts nothing about the outcome.
  function mapStage(stageValue: HiringStage): CardStage {
    if (stageValue === "applied") return "applied";
    if (stageValue === "screening") return "screened";
    if (stageValue === "technical" || stageValue === "hr") return "interviewed";
    return "final";
  }

  useEffect(() => {
    async function loadCompanyOptions() {
      const { data } = await supabase
        .from("hiring_submissions")
        .select("company")
        .eq("is_approved", true)
        .order("company", { ascending: true });

      const unique = Array.from(
        new Set((data ?? []).map((item) => item.company).filter(Boolean))
      );
      setCompanyOptions(["All Companies", ...unique]);
    }

    loadCompanyOptions();
  }, []);

  useEffect(() => {
    async function loadSubmissions() {
      let countQuery = supabase
        .from("hiring_submissions")
        .select("*", { count: "exact", head: true })
        .eq("is_approved", true);

      let dataQuery = supabase
        .from("hiring_submissions")
        .select("id, company, role, stage, reason, created_at")
        .eq("is_approved", true)
        .order("created_at", { ascending: false })
        .range((page - 1) * PAGE_SIZE, page * PAGE_SIZE - 1);

      if (company !== "All Companies") {
        countQuery = countQuery.eq("company", company);
        dataQuery = dataQuery.eq("company", company);
      }
      if (stage !== "all") {
        countQuery = countQuery.eq("stage", stage);
        dataQuery = dataQuery.eq("stage", stage);
      }

      const [{ count }, { data }] = await Promise.all([countQuery, dataQuery]);
      setTotalCount(count ?? 0);

      const mapped = ((data ?? []) as BrowseRow[]).map((row) => ({
        id: row.id,
        company: {
          id: row.company,
          slug: normalizeCompanySlug(row.company),
          name: row.company,
          industry: "Unknown",
          domain: "",
        },
        role_title: row.role,
        rejection_stage: mapStage(row.stage),
        rejection_reason: reasonLabel(row.reason),
        experience_text: reasonSummary(row.reason),
        created_at: row.created_at,
      }));

      setRows(mapped);
    }

    loadSubmissions();
  }, [company, stage, page]);

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-14 w-full flex-1">
        <div className="mb-8 pb-6 border-b border-rule">
          <h1 className="font-serif text-3xl text-ink mb-1">Browse</h1>
          <p className="text-sm text-ink-muted">Companies and candidate hiring reports.</p>
        </div>

        {/* Companies directory preview */}
        <section className="mb-12">
          <div className="flex items-center justify-between mb-5">
            <h2 className="font-serif text-2xl text-ink">Companies</h2>
            <Link
              href="/companies"
              className="text-sm text-accent hover:text-accent-hover hover:underline"
            >
              View all{companyTotal > 0 ? ` ${companyTotal}` : ""} →
            </Link>
          </div>
          {companiesLoading ? (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  className="h-28 border border-rule bg-paper-sheet rounded-sm animate-pulse"
                />
              ))}
            </div>
          ) : companies.length === 0 ? (
            <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-10 text-center">
              <p className="text-sm text-ink-muted">No companies yet.</p>
            </div>
          ) : (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
              {companies.map((c) => (
                <CompanyCard key={c.slug} company={c} />
              ))}
            </div>
          )}
        </section>

        {/* Hiring reports */}
        <section>
          <div className="flex items-baseline justify-between mb-5">
            <h2 className="font-serif text-2xl text-ink">Hiring reports</h2>
            <span className="text-sm text-ink-muted tnum">{totalCount} found</span>
          </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-8 p-4 border border-rule bg-paper-sheet rounded-sm shadow-sheet">
          <select
            aria-label="Filter by company"
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setPage(1);
            }}
            className={SELECT_CLS}
          >
            {companyOptions.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>

          <select
            aria-label="Filter by stage"
            value={stage}
            onChange={(e) => {
              setStage(e.target.value as HiringStage | "all");
              setPage(1);
            }}
            className={SELECT_CLS}
          >
            {STAGES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>

          <button
            onClick={() => {
              setCompany("All Companies");
              setStage("all");
              setPage(1);
            }}
            className="text-xs text-ink-muted hover:text-accent transition-colors ml-auto"
          >
            Clear filters
          </button>
        </div>

        {/* Grid */}
        {rows.length === 0 ? (
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
            <p className="text-sm text-ink-muted">No submissions match your filters.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5 mb-10">
            {rows.map((sub) => (
              <SubmissionCard key={sub.id} submission={sub} />
            ))}
          </div>
        )}

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-center gap-2">
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="text-xs font-mono border border-rule bg-paper-sheet px-3 py-2 rounded-sm text-ink-soft hover:border-rule-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs font-mono text-ink-muted px-3 tnum">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-xs font-mono border border-rule bg-paper-sheet px-3 py-2 rounded-sm text-ink-soft hover:border-rule-strong disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
        </section>
      </main>

      <Footer />
    </div>
  );
}
