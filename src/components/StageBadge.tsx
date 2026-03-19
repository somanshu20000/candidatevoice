import type { RejectionStage } from "@/data/mockData";

const stageConfig: Record<RejectionStage, { label: string; color: string }> = {
  applied:    { label: "Applied",              color: "bg-[#64748B]/20 text-[#94A3B8] border-[#64748B]/30" },
  screened:   { label: "Screened",             color: "bg-[#D97706]/20 text-[#FCD34D] border-[#D97706]/30" },
  interviewed:{ label: "Interviewed",          color: "bg-[#EA580C]/20 text-[#FB923C] border-[#EA580C]/30" },
  offered:    { label: "Offer Rescinded",      color: "bg-[#DC2626]/20 text-[#F87171] border-[#DC2626]/30" },
};

export default function StageBadge({ stage }: { stage: RejectionStage }) {
  const { label, color } = stageConfig[stage];
  return (
    <span className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-mono font-medium ${color}`}>
      {label}
    </span>
  );
}
