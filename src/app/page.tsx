import Link from "next/link";
import { ArrowRight, Shield, Eye, Globe } from "lucide-react";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SubmissionCard from "@/components/SubmissionCard";
import CompanySearch from "@/components/CompanySearch";
import { createClient } from "@/lib/supabase/server";
import { reasonLabel, reasonSummary } from "@/utils/labels";
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
  /** YYYY-MM from public_submissions — never a raw timestamp. */
  reported_month: string | null;
};

function toSlug(name: string) {
  return name.trim().toLowerCase().replace(/\s+/g, "-");
}

export default async function HomePage() {
  const supabase = createClient();
  // public_submissions, not the base table: the view already filters to
  // approved-and-not-rejected AND coarsens created_at to reported_month.
  // Selecting a raw timestamp beside a company and role was an anonymity leak.
  const { data } = await supabase
    .from("public_submissions")
    .select(`
      id,
      company,
      role,
      stage,
      reason,
      reported_month
    `)
    // Candidate-only (migration 0020): this feed reads as "recent rejections",
    // which stage/reason only mean for someone who interviewed. An employee or
    // former_employee row has stage=null/reason=null and would otherwise show
    // up here mislabeled by mapStage's null-falls-through-to-"final" default.
    .eq("reporter_type", "candidate")
    .order("reported_month", { ascending: false })
    .limit(10);

  const rows = (data ?? []) as SubmissionRow[];

  const recentSubmissions: SubmissionCardData[] = rows
    .map((row) => {
      // Maps the reported stage to its card label. `final` means the candidate
      // reached the final round — it asserts nothing about the outcome.
      const mappedStage =
        row.stage === "applied"
          ? "applied"
          : row.stage === "screening"
            ? "screened"
            : row.stage === "final"
              ? "final"
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
        rejection_reason: reasonLabel(row.reason),
        experience_text: reasonSummary(row.reason),
        reported_month: row.reported_month,
      };
    });

  return (
    <div className="min-h-screen flex flex-col">
      <Navbar />

      {/* Hero */}
      <section className="max-w-6xl mx-auto px-4 pt-20 pb-16 w-full">
        <div className="max-w-3xl">
          <span className="inline-flex items-center border border-rule bg-paper-sheet px-3 py-1 text-[10px] font-mono uppercase tracking-wider text-ink-muted mb-8 rounded-sm">
            Open Source · MIT · CC0 Data
          </span>
          <h1 className="font-serif text-5xl md:text-6xl lg:text-7xl tracking-tight text-ink leading-[1.05] mb-6">
            Know the process<br />before you apply
          </h1>
          <p className="text-lg text-ink-soft max-w-xl mb-9 leading-relaxed">
            Crowdsourced, anonymized rejection experiences from real candidates.
            No names. No spin. Just signal.
          </p>
          <div className="flex items-center gap-3 flex-wrap">
            <Link
              href="/submit"
              className="inline-flex items-center gap-2 bg-accent text-paper-sheet px-6 py-3 text-sm font-medium rounded-sm hover:bg-accent-hover transition-colors"
            >
              Share Your Experience
              <ArrowRight className="h-4 w-4" />
            </Link>
            <Link
              href="/browse"
              className="inline-flex items-center gap-2 border border-rule-strong bg-paper-sheet text-ink-soft px-6 py-3 text-sm font-medium rounded-sm hover:border-ink-faint hover:text-ink transition-colors"
            >
              Browse Data
            </Link>
          </div>
        </div>
      </section>

      {/* Company Search */}
      <CompanySearch />

      {/* How It Works */}
      <section className="max-w-6xl mx-auto px-4 py-20 w-full">
        <h2 className="font-serif text-2xl text-ink mb-8">How it works</h2>
        <div className="grid md:grid-cols-3 gap-5">
          {steps.map((step) => (
            <div
              key={step.num}
              className="border border-rule bg-paper-sheet rounded-sm p-6 shadow-sheet"
            >
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-xs tracking-wider text-accent">
                  {step.num}
                </span>
                <step.icon className="h-4 w-4 text-ink-faint" />
              </div>
              <h3 className="font-serif text-lg text-ink mb-1.5">{step.title}</h3>
              <p className="text-sm text-ink-muted leading-relaxed">
                {step.description}
              </p>
            </div>
          ))}
        </div>
      </section>

      {/* Recent Submissions */}
      <section className="max-w-6xl mx-auto px-4 pb-20 w-full">
        <div className="flex items-center justify-between mb-6">
          <h2 className="font-serif text-2xl text-ink">Recent submissions</h2>
          <Link
            href="/browse"
            className="text-sm text-accent hover:text-accent-hover hover:underline"
          >
            View all →
          </Link>
        </div>
        {recentSubmissions.length === 0 ? (
          <div className="border border-dashed border-rule-strong bg-paper-sheet rounded-sm p-16 text-center">
            <p className="text-sm text-ink-muted">
              No data yet — be the first to contribute
            </p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-5">
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
