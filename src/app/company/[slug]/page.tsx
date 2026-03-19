import { notFound } from "next/navigation";
import Navbar from "@/components/Navbar";
import Footer from "@/components/Footer";
import SubmissionCard from "@/components/SubmissionCard";
import StageBadge from "@/components/StageBadge";
import { companies, submissions } from "@/data/mockData";
import type { RejectionStage } from "@/data/mockData";

interface Props {
  params: { slug: string };
}

const STAGE_ORDER: RejectionStage[] = ["applied", "screened", "interviewed", "offered"];

export function generateStaticParams() {
  return companies.map((c) => ({ slug: c.slug }));
}

export default function CompanyPage({ params }: Props) {
  const company = companies.find((c) => c.slug === params.slug);
  if (!company) notFound();

  const companySubmissions = submissions
    .filter((s) => s.company.slug === params.slug)
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());

  // Stats
  const total = companySubmissions.length;
  const stageCounts = STAGE_ORDER.reduce<Record<RejectionStage, number>>(
    (acc, s) => {
      acc[s] = companySubmissions.filter((sub) => sub.rejection_stage === s).length;
      return acc;
    },
    { applied: 0, screened: 0, interviewed: 0, offered: 0 }
  );
  const mostCommonStage = STAGE_ORDER.reduce((a, b) =>
    stageCounts[a] >= stageCounts[b] ? a : b
  );

  return (
    <div className="min-h-screen bg-[#0F172A] text-white flex flex-col">
      <Navbar />

      <main className="max-w-6xl mx-auto px-4 py-12 w-full flex-1">
        {/* Company header */}
        <div className="mb-8 pb-8 border-b border-[#334155]">
          <p className="text-xs font-mono text-[#64748B] mb-2">{company.domain}</p>
          <h1 className="text-3xl font-bold text-white mb-1">{company.name}</h1>
          <span className="inline-block text-xs font-mono border border-[#334155] text-[#64748B] px-2 py-0.5 rounded">
            {company.industry}
          </span>
        </div>

        {/* Stats row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-10">
          <div className="border border-[#334155] bg-[#1E293B] rounded p-4">
            <p className="text-2xl font-mono font-semibold text-[#38BDF8]">{total}</p>
            <p className="text-xs text-[#64748B] mt-1">Total Rejections</p>
          </div>
          <div className="border border-[#334155] bg-[#1E293B] rounded p-4">
            <div className="mb-1">
              <StageBadge stage={mostCommonStage} />
            </div>
            <p className="text-xs text-[#64748B] mt-1">Most Common Stage</p>
          </div>
          {STAGE_ORDER.map((stage) => (
            stageCounts[stage] > 0 ? (
              <div key={stage} className="border border-[#334155] bg-[#1E293B] rounded p-4">
                <p className="text-2xl font-mono font-semibold text-white">{stageCounts[stage]}</p>
                <div className="mt-1">
                  <StageBadge stage={stage} />
                </div>
              </div>
            ) : null
          ))}
        </div>

        {/* Submissions */}
        <h2 className="text-lg font-semibold text-white mb-4">
          All submissions ({total})
        </h2>
        {companySubmissions.length === 0 ? (
          <div className="border border-[#334155] rounded p-12 text-center">
            <p className="text-[#64748B]">No submissions for this company yet.</p>
          </div>
        ) : (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-4">
            {companySubmissions.map((sub) => (
              <SubmissionCard key={sub.id} submission={sub} />
            ))}
          </div>
        )}
      </main>

      <Footer />
    </div>
  );
}
