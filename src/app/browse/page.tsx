"use client";

import { useState } from "react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SubmissionCard from "@/components/SubmissionCard";
import { submissions, companies } from "@/data/mockData";
import type { RejectionStage } from "@/data/mockData";

const STAGES: { value: RejectionStage | "all"; label: string }[] = [
  { value: "all",         label: "All Stages"   },
  { value: "applied",     label: "Applied"      },
  { value: "screened",    label: "Screened"     },
  { value: "interviewed", label: "Interviewed"  },
  { value: "offered",     label: "Offer Rescinded" },
];

const INDUSTRIES = ["All Industries", ...Array.from(new Set(companies.map((c) => c.industry)))];
const COMPANIES  = ["All Companies",  ...companies.map((c) => c.name)];

const PAGE_SIZE = 9;

export default function BrowsePage() {
  const [company,  setCompany]  = useState("All Companies");
  const [stage,    setStage]    = useState<RejectionStage | "all">("all");
  const [industry, setIndustry] = useState("All Industries");
  const [page,     setPage]     = useState(1);

  const filtered = submissions.filter((s) => {
    if (company  !== "All Companies"  && s.company.name     !== company)  return false;
    if (stage    !== "all"            && s.rejection_stage  !== stage)    return false;
    if (industry !== "All Industries" && s.company.industry !== industry) return false;
    return true;
  });

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const paginated  = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  function handleFilter() {
    setPage(1);
  }

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12 w-full flex-1">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-white mb-1">Browse Submissions</h1>
          <p className="text-sm text-[#64748B]">{filtered.length} submissions found</p>
        </div>

        {/* Filter bar */}
        <div className="flex flex-wrap gap-3 mb-8 p-4 border border-[#334155] bg-[#1E293B] rounded">
          <select
            value={company}
            onChange={(e) => { setCompany(e.target.value); handleFilter(); }}
            className="bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#38BDF8]"
          >
            {COMPANIES.map((c) => <option key={c}>{c}</option>)}
          </select>

          <select
            value={stage}
            onChange={(e) => { setStage(e.target.value as RejectionStage | "all"); handleFilter(); }}
            className="bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#38BDF8]"
          >
            {STAGES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          <select
            value={industry}
            onChange={(e) => { setIndustry(e.target.value); handleFilter(); }}
            className="bg-[#0F172A] border border-[#334155] text-[#94A3B8] text-sm rounded px-3 py-1.5 focus:outline-none focus:border-[#38BDF8]"
          >
            {INDUSTRIES.map((i) => <option key={i}>{i}</option>)}
          </select>

          <button
            onClick={() => { setCompany("All Companies"); setStage("all"); setIndustry("All Industries"); setPage(1); }}
            className="text-xs text-[#64748B] hover:text-[#38BDF8] transition-colors ml-auto"
          >
            Clear filters
          </button>
        </div>

        {/* Grid */}
        {paginated.length === 0 ? (
          <div className="border border-[#334155] rounded p-12 text-center">
            <p className="text-[#64748B]">No submissions match your filters.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
            {paginated.map((sub) => (
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
