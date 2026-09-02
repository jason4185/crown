import { STATUS_LABEL, type MarketStatus } from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";

const STYLES: Record<MarketStatus, string> = {
  OPEN: "text-success border-success/35 bg-success/10",
  LOCKED: "text-muted-foreground border-border-strong bg-elevated",
  LIVE: "text-info border-info/35 bg-info/10",
  FINALIZING: "text-warning border-warning/35 bg-warning/10",
  SETTLEMENT_READY: "text-warning border-warning/40 bg-warning/10",
  RESOLVED: "text-gold border-gold/40 bg-gold-soft",
  INCONCLUSIVE: "text-muted-foreground border-border-strong bg-elevated",
};

export function StatusBadge({
  status,
  className,
}: {
  status: MarketStatus;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium uppercase tracking-wider",
        STYLES[status],
        className,
      )}
    >
      {(status === "OPEN" || status === "LIVE") && (
        <span className="h-1.5 w-1.5 rounded-full bg-current" />
      )}
      {STATUS_LABEL[status]}
    </span>
  );
}
