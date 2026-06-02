import Link from "next/link";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { calculateHQS } from "@/utils/hqs";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import type { HiringSubmission } from "@/types/index";
import {
  COOKIE_NAME,
  decodeUnlockedCompaniesCookie,
  normalizeCompanySlug,
} from "@/lib/unlock-cookie";

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
  const companySlug = normalizeCompanySlug(decodeURIComponent(params.slug));
  const companyName = companySlug.replace(/-/g, " ");
  const supabase = createClient();
  const cookieStore = cookies();
  const unlockedCompanies = decodeUnlockedCompaniesCookie(
    cookieStore.get(COOKIE_NAME)?.value
  );
  const isUnlocked = unlockedCompanies.includes(companySlug);

  const { data, error } = await supabase
    .from("hiring_submissions")
    .select("*")
    .eq("company", companySlug)
    .eq("is_approved", true);

  const rows: HiringSubmission[] = (error || !data) ? [] : data;

  if (rows.length === 0) {
    return (
      <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
        <Navbar />
        <main className="max-w-2xl mx-auto px-4 py-20 w-full flex-1 text-center">
          <p className="text-4xl mb-4">🔍</p>
          <h1 className="text-2xl font-bold text-white mb-2 capitalize">{companyName}</h1>
          <p className="text-[#94A3B8] mb-2">Not enough data yet.</p>
          <p className="text-sm text-[#64748B] mb-8">
            Be the first to reveal how this company hires.
          </p>
          <Link
            href={`/submit?company=${encodeURIComponent(companySlug)}`}
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
            {metrics.total >= 5 ? (
              <>
                <p className={`text-6xl font-mono font-bold ${hqsColor(metrics.hqs)}`}>{metrics.hqs}</p>
                <p className="text-xs text-[#64748B] mt-1">out of 100</p>
              </>
            ) : (
              <>
                <p className="text-2xl font-mono font-semibold text-[#64748B]">Not enough data</p>
                <p className="text-xs text-[#64748B] mt-1">Score available after 5+ submissions</p>
              </>
            )}
          </div>
          <div className="text-right">
            <span className={`inline-flex items-center border px-3 py-1 rounded-full text-xs font-mono font-semibold ${confidenceBadge(metrics.confidence)}`}>
              {metrics.confidence} confidence
            </span>
            <p className="text-xs text-[#475569] mt-2">{metrics.total} submissions</p>
          </div>
        </div>

        {isUnlocked ? (
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
        ) : (
          <div className="space-y-6 mb-8">
            <div className="border border-[#334155] bg-[#1E293B] rounded p-5">
              <h2 className="text-sm font-semibold text-white mb-3">Unlock full insights</h2>
              <p className="text-sm text-[#94A3B8] mb-3">
                - Ghost rate<br />
                - Rejection patterns<br />
                - Screening quality
              </p>
              <p className="text-xs text-[#64748B] mb-4">
                Submit your experience to unlock (2 mins, anonymous)
              </p>
              <Link
                href={`/submit?company=${encodeURIComponent(companySlug)}`}
                className="inline-flex items-center gap-2 bg-[#38BDF8] text-[#0F172A] px-4 py-2 text-sm font-semibold rounded hover:bg-[#7DD3FC] transition-colors"
              >
                Unlock insights →
              </Link>
            </div>

            <div className="relative border border-[#334155] bg-[#1E293B] rounded p-5 opacity-30 pointer-events-none select-none">
              <h2 className="text-sm font-semibold text-white mb-4">Breakdown</h2>
              {["Ghost Rate", "Early Rejection Rate", "Transparency Score", "Payment Risk", "Response Speed Score"].map((label) => (
                <div key={label} className="flex items-center justify-between py-2 border-b border-[#334155] last:border-0">
                  <span className="text-sm text-[#94A3B8]">{label}</span>
                  <span className="font-mono text-sm font-semibold text-white">—</span>
                </div>
              ))}
              <div className="absolute inset-0 flex items-center justify-center">
                <span className="border border-[#334155] bg-[#0F172A] px-3 py-1 rounded text-xs text-[#94A3B8]">
                  Locked
                </span>
              </div>
            </div>
          </div>
        )}

        <p className="text-xs text-[#475569] text-center">
          {isUnlocked
            ? "Full insights unlocked for this company · All data is anonymized"
            : "Summary visible · Submit to unlock full insights"}
        </p>
      </main>
      <Footer />
    </div>
  );
}
