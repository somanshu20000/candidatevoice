import type { CardRejectionStage } from "@/types/index";

// Tints are desaturated and paired with a darker text tone so each pill reads
// as ink stamped on paper rather than a glowing chip. Recolored from the old
// dark theme, where light text on 20%-alpha fills was inverted for a navy page.
//
// EVERY LABEL DESCRIBES A STAGE, NOT AN OUTCOME. The `final` entry previously
// read "Offer Rescinded" in red, which was stamped on every submission that
// reached the final round regardless of what actually happened — including
// candidates still waiting, rejected without any offer, or who accepted one.
// The card has no access to `outcome`, so it cannot make that claim, and
// asserting a rescinded offer against a named employer is exactly the kind of
// unverified statement this project is built to avoid. Reaching the final round
// is also not a negative result, so the tint is no longer an alarm colour.
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
  final: {
    label: "Final round",
    color: "bg-accent-wash text-accent border-[#C6D2E0]",
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
