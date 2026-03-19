import Link from "next/link";
import type { Submission } from "@/data/mockData";
import { getRelativeDate } from "@/data/mockData";
import StageBadge from "./StageBadge";

export default function SubmissionCard({ submission }: { submission: Submission }) {
  return (
    <Link
      href={`/company/${submission.company.slug}`}
      className="block border border-[#334155] bg-[#1E293B] rounded p-4 hover:border-[#38BDF8]/50 transition-colors group"
    >
      <div className="flex items-start justify-between gap-2 mb-2">
        <div>
          <span className="text-sm font-semibold text-white group-hover:text-[#38BDF8] transition-colors">
            {submission.company.name}
          </span>
          <span className="ml-2 text-[11px] font-mono text-[#64748B]">
            {submission.company.industry}
          </span>
        </div>
        <StageBadge stage={submission.rejection_stage} />
      </div>

      <p className="text-sm text-[#94A3B8] mb-2">{submission.role_title}</p>

      <p className="text-xs text-[#64748B] leading-relaxed line-clamp-2 mb-3">
        {submission.experience_text}
      </p>

      <p className="text-[11px] font-mono text-[#475569]">
        {getRelativeDate(submission.created_at)}
      </p>
    </Link>
  );
}
