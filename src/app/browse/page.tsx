"use client";

import { useEffect, useMemo, useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SubmissionCard from "@/components/SubmissionCard";
import { supabase } from "@/lib/supabase/browser";
import { normalizeCompanySlug } from "@/lib/company-slug";
import type { HiringStage, SubmissionCardData } from "@/types/index";

type CardStage = "applied" | "screened" | "interviewed" | "offered";

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

export default function BrowsePage() {
  const [company, setCompany] = useState("All Companies");
  const [stage, setStage] = useState<HiringStage | "all">("all");
  const [page, setPage] = useState(1);
  const [companyOptions, setCompanyOptions] = useState<string[]>(["All Companies"]);
  const [rows, setRows] = useState<SubmissionCardData[]>([]);
  const [totalCount, setTotalCount] = useState(0);

  const totalPages = useMemo(
    () => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)),
    [totalCount]
  );

  function mapStage(stageValue: HiringStage): CardStage {
    if (stageValue === "applied") return "applied";
    if (stageValue === "screening") return "screened";
    if (stageValue === "technical" || stageValue === "hr") return "interviewed";
    return "offered";
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
        rejection_reason: row.reason ?? "",
        experience_text: row.reason ?? "No additional details provided.",
        created_at: row.created_at,
      }));

      setRows(mapped);
    }

    loadSubmissions();
  }, [company, stage, page]);

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12 w-full flex-1">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Browse Submissions</h1>
          <p className="text-sm text-[#64748B]">{totalCount} submissions found</p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-8 p-4 border border-[#334155] bg-[#1E293B] rounded">
          <select
            value={company}
            onChange={(e) => {
              setCompany(e.target.value);
              setPage(1);
            }}
            className="bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#38BDF8]"
          >
            {companyOptions.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>

          <select
            value={stage}
            onChange={(e) => {
              setStage(e.target.value as HiringStage | "all");
              setPage(1);
            }}
            className="bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#38BDF8]"
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
            className="text-xs text-[#64748B] hover:text-[#38BDF8] transition-colors ml-auto"
          >
            Clear filters
          </button>
        </div>

        {/* Grid */}
        {rows.length === 0 ? (
          <div className="border border-[#334155] rounded p-12 text-center">
            <p className="text-[#64748B]">No submissions match your filters.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
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
              className="text-xs font-mono border border-[#334155] px-3 py-1.5 rounded text-[#94A3B8] hover:border-[#38BDF8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              ← Prev
            </button>
            <span className="text-xs font-mono text-[#64748B] px-3">
              Page {page} of {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="text-xs font-mono border border-[#334155] px-3 py-1.5 rounded text-[#94A3B8] hover:border-[#38BDF8] disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Next →
            </button>
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
