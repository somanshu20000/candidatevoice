import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { calculateHQS } from "@/utils/hqs";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import type { HiringSubmission } from "@/types/index";

interface Props {
  params: { slug: string };
}

const STAGE_LABELS: Record<string, string> = {
  applied: "Applied", screening: "Screening", technical: "Technical",
  hr: "HR", final: "Final",
};

function hqsColor(score: number): string {
  if (score >= 80) return "text-green-400";
  if (score >= 50) return "text-amber-400";
  return "text-[#F87171]";
}

function hqsBorderColor(score: number): string {
  if (score >= 80) return "border-green-400/30";
  if (score >= 50) return "border-amber-400/30";
  return "border-[#F87171]/30";
}

function confidenceBadge(confidence: string) {
  const cfg: Record<string, string> = {
    high:   "bg-green-400/10 text-green-400 border-green-400/30",
    medium: "bg-amber-400/10 text-amber-400 border-amber-400/30",
    low:    "bg-[#64748B]/10 text-[#64748B] border-[#334155]",
  };
  return cfg[confidence] ?? cfg.low;
}

function MetricRow({ label, value, suffix = "%" }: { label: string; value: number; suffix?: string }) {
  return (
    <div className="flex items-center justify-between py-2 border-b border-[#334155] last:border-0">
      <span className="text-sm text-[#94A3B8]">{label}</span>
      <span className="font-mono text-sm font-semibold text-white">{value}{suffix}</span>
    </div>
  );
}

function StageBar({ data }: { data: HiringSubmission[] }) {
  const total = data.length;
  const stages = Object.keys(STAGE_LABELS) as HiringSubmission["stage"][];
  const counts = stages.map((s) => ({
    stage: s,
    label: STAGE_LABELS[s],
    count: data.filter((d) => d.stage === s).length,
  })).filter((x) => x.count > 0);

  return (
    <div className="space-y-2">
      {counts.map(({ stage, label, count }) => (
        <div key={stage} className="flex items-center gap-3">
          <span className="text-xs text-[#64748B] w-20 shrink-0">{label}</span>
          <div className="flex-1 bg-[#0F172A] rounded-full h-2">
            <div
              className="bg-[#38BDF8] h-2 rounded-full transition-all"
              style={{ width: `${Math.round((count / total) * 100)}%` }}
            />
          </div>
          <span className="text-xs font-mono text-[#64748B] w-8 text-right">{count}</span>
        </div>
      ))}
    </div>
  );
}

export default async function CompanyPage({ params }: Props) {
  const companyName = decodeURIComponent(params.slug).replace(/-/g, " ");
  const supabase = createClient();

  const { data, error } = await supabase
    .from("hiring_submissions")
    .select("*")
    .ilike("company", companyName);

  const rows: HiringSubmission[] = (error || !data) ? [] : data;

  if (rows.length < 5) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-20 w-full flex-1 text-center">
          <p className="text-4xl mb-4">🔍</p>
          <h1 className="text-2xl font-bold text-white mb-2 capitalize">{companyName}</h1>
          <p className="text-[#94A3B8] mb-2">
            Not enough data yet for <span className="text-white font-medium capitalize">{companyName}</span>.
          </p>
          <p className="text-sm text-[#64748B] mb-8">
            Data is shown only when 5+ submissions exist.
          </p>
          <Link
            href="/submit"
            className="inline-flex items-center gap-2 bg-[#38BDF8] text-[#0F172A] px-5 py-2.5 text-sm font-semibold rounded hover:bg-[#7DD3FC] transition-colors"
          >
            Be the first to submit your experience →
          </Link>
        </main>
        <Footer />
      </div>
    );
  }

  const metrics = calculateHQS(rows)!;

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <Navbar />
      <main className="max-w-4xl mx-auto px-4 py-12 w-full flex-1">

        {/* Header */}
        <div className="mb-10 pb-8 border-b border-[#334155]">
          <h1 className="text-3xl font-bold text-white capitalize mb-1">{companyName}</h1>
          <p className="text-xs text-[#64748B]">Based on {metrics.total} anonymous submissions</p>
        </div>

        {/* HQS score */}
        <div className={`border ${hqsBorderColor(metrics.hqs)} bg-[#1E293B] rounded p-6 mb-8 flex items-center justify-between`}>
          <div>
            <p className="text-xs font-mono text-[#64748B] mb-1">Hiring Quality Score</p>
            <p className={`text-6xl font-mono font-bold ${hqsColor(metrics.hqs)}`}>{metrics.hqs}</p>
            <p className="text-xs text-[#64748B] mt-1">out of 100</p>
          </div>
          <div className="text-right">
            <span className={`inline-flex items-center border px-3 py-1 rounded-full text-xs font-mono font-semibold ${confidenceBadge(metrics.confidence)}`}>
              {metrics.confidence} confidence
            </span>
            <p className="text-xs text-[#475569] mt-2">{metrics.total} submissions</p>
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 mb-8">

          {/* Metrics */}
          <div className="border border-[#334155] bg-[#1E293B] rounded p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Breakdown</h2>
            <MetricRow label="Ghost Rate"           value={metrics.ghostRate} />
            <MetricRow label="Early Rejection Rate" value={metrics.earlyRejectRate} />
            <MetricRow label="Transparency Score"   value={metrics.transparencyRate} />
            <MetricRow label="Payment Risk"         value={metrics.paymentRate} />
            <MetricRow label="Response Speed Score" value={metrics.responseScore} suffix="" />
          </div>

          {/* Stage distribution */}
          <div className="border border-[#334155] bg-[#1E293B] rounded p-5">
            <h2 className="text-sm font-semibold text-white mb-4">Stage distribution</h2>
            <StageBar data={rows} />
          </div>
        </div>

        <p className="text-xs text-[#475569] text-center">
          Data shown only when 5+ submissions exist · All data is anonymized
        </p>
      </main>
      <Footer />
    </div>
  );
}
