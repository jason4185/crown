import { Check, Circle, Loader2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { TxStage } from "@/lib/crown/contract";

const STAGES: Array<{ key: TxStage; label: string }> = [
  { key: "preparing", label: "Preparing" },
  { key: "confirming", label: "Confirm in wallet" },
  { key: "submitted", label: "Submitted" },
  { key: "pending", label: "Waiting for confirmation" },
];

const ORDER: Record<TxStage, number> = {
  preparing: 0,
  confirming: 1,
  submitted: 2,
  pending: 3,
  success: 4,
  failed: 4,
};

export function TransactionDialog({
  open,
  onOpenChange,
  title,
  details,
  stage,
  error,
  hash,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  details: Array<[string, string]>;
  stage: TxStage;
  error?: string | undefined;
  hash?: string | undefined;
}) {
  const finished = stage === "success" || stage === "failed";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="rounded-lg border border-border bg-elevated p-3">
            {details.map(([label, value]) => (
              <div
                key={label}
                className="flex justify-between gap-4 py-1.5 text-sm"
              >
                <span className="text-muted-foreground">{label}</span>
                <span className="max-w-[65%] truncate text-right font-medium">
                  {value}
                </span>
              </div>
            ))}
          </div>

          {finished ? (
            <div
              className={`rounded-lg border p-3 text-sm ${
                stage === "success"
                  ? "border-success/30 bg-success/10 text-success"
                  : "border-destructive/30 bg-destructive/10 text-destructive"
              }`}
            >
              <div className="flex items-center gap-2 font-medium">
                {stage === "success" ? (
                  <Check className="h-4 w-4" />
                ) : (
                  <X className="h-4 w-4" />
                )}
                {stage === "success"
                  ? "Transaction confirmed"
                  : "Transaction failed"}
              </div>
              {error && <p className="mt-1 text-xs opacity-90">{error}</p>}
              {hash && (
                <p className="mt-1 truncate text-xs opacity-75">{hash}</p>
              )}
            </div>
          ) : (
            <ol className="space-y-2">
              {STAGES.map((item) => {
                const active = item.key === stage;
                const complete = ORDER[stage] > ORDER[item.key];
                return (
                  <li
                    key={item.key}
                    className="flex items-center gap-3 text-sm"
                  >
                    {active ? (
                      <Loader2 className="h-4 w-4 animate-spin text-gold" />
                    ) : complete ? (
                      <Check className="h-4 w-4 text-success" />
                    ) : (
                      <Circle className="h-4 w-4 text-muted-foreground" />
                    )}
                    <span
                      className={
                        active ? "font-medium" : "text-muted-foreground"
                      }
                    >
                      {item.label}
                    </span>
                  </li>
                );
              })}
            </ol>
          )}

          {finished && (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
