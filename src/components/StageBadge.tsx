import type { CardRejectionStage } from "@/types/index";

// Tints are desaturated and paired with a darker text tone so each pill reads
// as ink stamped on paper rather than a glowing chip. Recolored from the old
// dark theme, where light text on 20%-alpha fills was inverted for a navy page.
const stageConfig: Record<CardRejectionStage, { label: string; color: string }> = {
  applied: {
    label: "Applied",
    color: "bg-paper-sunk text-ink-muted border-rule-strong",
  },
  screened: {
    label: "Screened",
    color: "bg-[#F4EEDD] text-warn border-[#E3D4AE]",
  },
  interviewed: {
    label: "Interviewed",
    color: "bg-[#F5E9DC] text-[#8A5426] border-[#E4CDB0]",
  },
  offered: {
    label: "Offer Rescinded",
    color: "bg-[#F5E2DF] text-bad border-[#E6C4BF]",
  },
};

export default function StageBadge({ stage }: { stage: CardRejectionStage }) {
  const { label, color } = stageConfig[stage];
  return (
    <span
      className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wide font-medium ${color}`}
    >
      {label}
    </span>
  );
}
