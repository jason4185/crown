import { useEffect, useRef, useState } from "react";
import {
  ArrowUpRight,
  Check,
  CircleDashed,
  Loader2,
  Wallet,
} from "lucide-react";
import {
  GenLayerTransactionPanel,
  type TrackedStatus,
} from "@genlayer/transaction-kit-react";
import type { SubmitInput, TransactionKit } from "@genlayer/transaction-kit";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  GENLAYER_EXPLORER_URL,
  GENLAYER_NETWORK_NAME,
} from "@/lib/crown/config";
import {
  nativeValueFromGen,
  toSubmitInput,
  type CrownTransactionRequest,
} from "@/lib/crown/contract";

type TxState =
  | "Review"
  | "Awaiting wallet"
  | "Submitted"
  | "Processing"
  | "Accepted"
  | "Failed";

function stateFromStatus(status: TrackedStatus): TxState {
  const name = status.statusName?.toUpperCase();
  if (name === "ACCEPTED" || name === "FINALIZED") {
    return status.successful === true &&
      status.executionResultName?.toUpperCase() === "FINISHED_WITH_RETURN"
      ? "Accepted"
      : "Failed";
  }
  if (status.successful === false || status.phase === "decided")
    return "Failed";
  if (status.phase === "submitted" || status.phase === "pending")
    return "Submitted";
  if (status.phase === "processing") return "Processing";
  return "Failed";
}

function explorerUrl(hash?: string) {
  return hash ? `${GENLAYER_EXPLORER_URL.replace(/\/$/, "")}/tx/${hash}` : null;
}

export function TransactionDialog({
  open,
  onOpenChange,
  title,
  details,
  kit,
  tx,
  userValueGen,
  finalized = false,
  onAccepted,
  onFailed,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  details: Array<[string, string]>;
  kit: TransactionKit | null;
  tx: CrownTransactionRequest | null;
  userValueGen?: string | undefined;
  finalized?: boolean | undefined;
  onAccepted?: ((status: TrackedStatus) => void) | undefined;
  onFailed?: ((status: TrackedStatus) => void) | undefined;
}) {
  const [state, setState] = useState<TxState>("Review");
  const [status, setStatus] = useState<TrackedStatus | null>(null);
  const wasOpen = useRef(false);
  const sdkTx = useRef<SubmitInput | null>(null);
  const sdkValue = useRef<bigint | undefined>(undefined);

  useEffect(() => {
    if (open && !wasOpen.current) {
      wasOpen.current = true;
      setState("Review");
      setStatus(null);
      sdkTx.current = null;
      sdkValue.current = undefined;
    } else if (!open) {
      wasOpen.current = false;
      setState("Review");
      setStatus(null);
      sdkTx.current = null;
      sdkValue.current = undefined;
    }
  }, [open]);

  const handleStatus = (next: TrackedStatus) => {
    setStatus(next);
    const nextState = stateFromStatus(next);
    setState(nextState);
    if (nextState === "Accepted") onAccepted?.(next);
    if (nextState === "Failed") onFailed?.(next);
  };

  const confirm = () => {
    if (!kit || !tx || sdkTx.current) return;
    try {
      sdkTx.current = toSubmitInput(tx);
      sdkValue.current =
        userValueGen === undefined
          ? undefined
          : nativeValueFromGen(userValueGen);
      setState("Awaiting wallet");
    } catch (cause) {
      const failed: TrackedStatus = {
        phase: "decided",
        statusName: "ERROR",
        successful: false,
        executionResultName:
          cause instanceof Error
            ? cause.message
            : "Unable to prepare transaction",
      };
      setStatus(failed);
      setState("Failed");
      onFailed?.(failed);
    }
  };

  const running =
    state !== "Review" && state !== "Accepted" && state !== "Failed";
  const hash = status?.genlayerTxId || status?.evmTxHash;
  const canClose = !running;

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!nextOpen && !canClose) return;
        onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="border-border bg-card sm:max-w-md">
        <DialogHeader>
          <DialogTitle>
            {state === "Accepted"
              ? "Transaction accepted"
              : state === "Failed"
                ? "Transaction failed"
                : title}
          </DialogTitle>
        </DialogHeader>

        {state === "Review" ? (
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
        ) : (
          <div className="flex flex-col items-center py-8 text-center">
            <span className="grid size-14 place-items-center rounded-full border border-border bg-elevated">
              {state === "Accepted" ? (
                <Check className="size-6 text-success" />
              ) : state === "Failed" ? (
                <CircleDashed className="size-6 text-destructive" />
              ) : state === "Awaiting wallet" ? (
                <Wallet className="size-6 text-gold" />
              ) : (
                <Loader2 className="size-6 animate-spin text-gold" />
              )}
            </span>
            <h3 className="mt-4 font-semibold">{state}</h3>
            <p className="mt-1 max-w-xs break-all text-sm text-muted-foreground">
              {state === "Failed"
                ? status?.executionResultName ||
                  "The network rejected the transaction."
                : state === "Awaiting wallet"
                  ? "Review fees and confirm this transaction in your wallet."
                  : state === "Accepted"
                    ? "The transaction reached a successful accepted or finalized state."
                    : hash || "Waiting for the network"}
            </p>
            {hash && (
              <a
                href={explorerUrl(hash) ?? undefined}
                target="_blank"
                rel="noreferrer"
                className="mt-3 inline-flex items-center gap-1 text-xs text-gold hover:underline"
              >
                View transaction <ArrowUpRight className="size-3" />
              </a>
            )}
          </div>
        )}

        <DialogFooter>
          {state === "Review" && (
            <div className="w-full space-y-3">
              {!kit || !tx ? (
                <p className="text-sm text-destructive">
                  Connect a wallet on {GENLAYER_NETWORK_NAME} before confirming.
                </p>
              ) : null}
              <div className="flex w-full flex-col-reverse gap-2 sm:flex-row sm:justify-end">
                <Button variant="outline" onClick={() => onOpenChange(false)}>
                  Cancel
                </Button>
                <Button
                  onClick={confirm}
                  disabled={!kit || !tx || Boolean(sdkTx.current)}
                >
                  Confirm transaction
                </Button>
              </div>
            </div>
          )}
          {running && kit && sdkTx.current && (
            <div className="w-full">
              <GenLayerTransactionPanel
                kit={kit}
                tx={sdkTx.current}
                {...(sdkValue.current === undefined
                  ? {}
                  : { userValue: sdkValue.current })}
                network={GENLAYER_NETWORK_NAME}
                theme="dark"
                trackUntil={finalized ? "finalized" : "decided"}
                onDone={handleStatus}
              />
            </div>
          )}
          {state === "Accepted" && (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Done
            </Button>
          )}
          {state === "Failed" && (
            <Button className="w-full" onClick={() => onOpenChange(false)}>
              Close
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
