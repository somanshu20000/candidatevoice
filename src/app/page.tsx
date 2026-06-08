import Link from "next/link";
import { ArrowRight, Shield, Eye, Globe } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SubmissionCard from "@/components/SubmissionCard";
import CompanySearch from "@/components/CompanySearch";
import { createClient } from "@/lib/supabase/server";
import type { SubmissionCardData } from "@/types/index";

const steps = [
  {
    num: "01",
    title: "Submit anonymously",
    description: "Share your rejection experience without revealing your identity.",
    icon: Shield,
  },
  {
    num: "02",
    title: "Moderation review",
    description: "Every submission is reviewed before publication.",
    icon: Eye,
  },
  {
    num: "03",
    title: "Goes public",
    description: "Approved submissions become searchable data for all candidates.",
    icon: Globe,
  },
];

type SubmissionRow = {
  id: string;
  company: string;
  role: string;
  stage: "applied" | "screening" | "technical" | "hr" | "final";
  reason: string;
  created_at: string;
};

function toSlug(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export default async function HomePage() {
  const supabase = createClient();
  const { data } = await supabase
    .from("hiring_submissions")
    .select(`
      id,
      company,
      role,
      stage,
      reason,
      created_at
    `)
    .eq("is_approved", true)
    .order("created_at", { ascending: false })
    .limit(10);

  const rows = (data ?? []) as SubmissionRow[];

  const recentSubmissions: SubmissionCardData[] = rows
    .map((row) => {
      const mappedStage =
        row.stage === "applied"
          ? "applied"
          : row.stage === "screening"
            ? "screened"
            : row.stage === "final"
              ? "offered"
              : "interviewed";

      return {
        id: row.id,
        company: {
          id: row.company,
          slug: toSlug(row.company),
          name: row.company,
          industry: "Unknown",
          domain: "",
        },
        role_title: row.role,
        rejection_stage: mappedStage,
        rejection_reason: row.reason ?? "",
        experience_text: row.reason ?? "No additional details provided.",
        created_at: row.created_at,
      };
    });

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 w-full">
        <div className="max-w-3xl">
          <span className="inline-flex items-center border border-[#334155] bg-[#1E293B] px-3 py-1 text-xs font-mono text-[#64748B] mb-6 rounded">
            Open Source · MIT · CC0 Data
          </span>
          <h1 className="text-4xl md:text-5xl lg:text-6xl font-bold tracking-tight text-white leading-tight mb-4">
            Know the process<br />before you apply
          </h1>
          <p className="text-lg text-[#94A3B8] max-w-xl mb-8 leading-relaxed">
            Crowdsourced, anonymized rejection experiences from real candidates.
            No names. No spin. Just signal.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/submit"
              className="inline-flex items-center gap-2 bg-[#38BDF8] text-[#0F172A] px-5 py-2.5 text-sm font-semibold rounded hover:bg-[#7DD3FC] transition-colors"
            >
              Share Your Experience
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/browse"
              className="inline-flex items-center gap-2 border border-[#334155] text-[#94A3B8] px-5 py-2.5 text-sm font-medium rounded hover:border-[#38BDF8]/50 hover:text-white transition-colors"
            >
              Browse Data
            </Link>
          </div>
        </div>
      </section>

      {/* Company Search */}
      <CompanySearch />

      {/* How It Works */}
      <section className="max-w-6xl mx-auto px-4 py-16 w-full">
        <h2 className="text-xl font-semibold text-white mb-8">How it works</h2>
        <div className="grid md:grid-cols-3 gap-4">
          {steps.map((step) => (
            <div key={step.num} className="border border-[#334155] bg-[#1E293B] rounded p-5">
              <div className="flex items-center gap-3 mb-3">
                <span className="font-mono text-sm text-[#38BDF8] font-semibold">{step.num}</span>
                <step.icon className="h-4 w-4 text-[#64748B]" />
              </div>
              <h3 className="text-sm font-semibold text-white mb-1">{step.title}</h3>
              <p className="text-sm text-[#64748B] leading-relaxed">{step.description}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Submissions */}
      <section className="max-w-6xl mx-auto px-4 pb-16 w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-xl font-semibold text-white">Recent submissions</h2>
          <Link href="/browse" className="text-sm text-[#38BDF8] hover:underline">
            View all →
          </Link>
        </div>
        {recentSubmissions.length === 0 ? (
          <div className="border border-[#334155] rounded p-12 text-center">
            <p className="text-[#64748B]">No data yet — be the first to contribute</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {recentSubmissions.map((sub) => (
              <SubmissionCard key={sub.id} submission={sub} />
            ))}
          </div>
        )}
      </section>

      <Footer />
    </div>
  );
}
