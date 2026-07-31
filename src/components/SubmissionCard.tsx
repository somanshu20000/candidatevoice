import Link from "next/link";
import type { SubmissionCardData } from "@/types/index";
import { formatReportedMonth } from "@/utils/date";
import StageBadge from "./StageBadge";

export default function SubmissionCard({ submission }: { submission: SubmissionCardData }) {
  return (
    <Link
      href={`/company/${submission.company.slug}`}
      className="group flex flex-col border border-rule bg-paper-sheet rounded-sm p-5 shadow-sheet hover:border-rule-strong hover:shadow-sheet-lg transition-all"
    >
      <div className="flex items-start justify-between gap-3 mb-3">
        <span className="font-serif text-lg leading-snug text-ink capitalize truncate group-hover:text-accent transition-colors">
          {submission.company.name}
        </span>
        <StageBadge stage={submission.rejection_stage} />
      </div>

      <p className="text-sm text-ink-soft mb-2">{submission.role_title}</p>

      <p className="text-xs text-ink-muted leading-relaxed clamp-2 mb-4">
        {submission.experience_text}
      </p>

      <p className="mt-auto text-[11px] font-mono text-ink-faint">
        {formatReportedMonth(submission.reported_month)}
      </p>
    </Link>
  );
}
