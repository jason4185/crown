import { useEffect, useState } from "react";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { toast } from "sonner";
import {
  Crown,
  Lock,
  RefreshCw,
  ShieldCheck,
  Timer,
  Wallet,
} from "lucide-react";
import { AssetIcon } from "./AssetIcon";
import { Countdown } from "./Countdown";
import { TransactionDialog } from "./TransactionDialog";
import { CrownErrorState } from "./CrownErrorState";
import { StatusBadge } from "./StatusBadge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  formatCrownGen,
  formatCrownGenInput,
  getProtocolConfig,
  parseCrownGen,
  writeCrownTransaction,
  type CrownMarket,
  type CrownPosition,
  type CrownProtocolConfig,
  type TxProgress,
  type TxStage,
} from "@/lib/crown/contract";
import { GENLAYER_CHAIN_ID } from "@/lib/crown/config";
import { getCrownErrorCopy } from "@/lib/crown/errors";
import {
  ASSETS,
  fmtUtcMarketWindow,
  type AssetSymbol,
} from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";

function Panel({ children }: { children: React.ReactNode }) {
  return <div className="surface p-5">{children}</div>;
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular font-medium">{value}</span>
    </div>
  );
}

type TransactionState = {
  title: string;
  details: Array<[string, string]>;
  open: boolean;
  stage: TxStage;
  error?: string | undefined;
  hash?: string | undefined;
};

export function ActionPanel({
  market,
  position: rawPosition,
  positionLoading = false,
  positionError = false,
  onRetryPosition,
}: {
  market: CrownMarket;
  position: CrownPosition | null;
  positionLoading?: boolean;
  positionError?: boolean;
  onRetryPosition?: (() => void) | undefined;
}) {
  const position = rawPosition?.hasPosition ? rawPosition : null;
  const { address, chainId, connector, isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["crown", "config"],
    queryFn: getProtocolConfig,
    staleTime: 300_000,
  });
  const config = configQuery.data;
  const [selected, setSelected] = useState<AssetSymbol | null>(
    position?.selectedAsset ?? null,
  );
  const [amount, setAmount] = useState("1");
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState<TransactionState | null>(null);

  useEffect(() => {
    setSelected(position?.selectedAsset ?? null);
  }, [position?.selectedAsset, address]);

  const minStake = config?.minStake ?? 0n;
  const maxStake = config?.maxStake ?? 0n;
  const remaining = position ? position.remainingStakeCapacity : maxStake;
  const total = formatCrownGen(market.onchain.totalPool);
  const timelineEnd = market.endISO;

  const invalidate = async () => {
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["crown", "market", market.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["crown", "position", market.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["crown", "resolution", market.id],
      }),
      queryClient.invalidateQueries({ queryKey: ["crown", "markets"] }),
      queryClient.invalidateQueries({ queryKey: ["crown", "open-markets"] }),
    ]);
  };

  const ensureWallet = () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return false;
    }
    if (chainId !== GENLAYER_CHAIN_ID) {
      toast.error("Wrong network", {
        description: "Switch to GenLayer Bradbury to continue.",
      });
      openChainModal?.();
      return false;
    }
    return true;
  };

  const runTransaction = async ({
    title,
    details,
    functionName,
    args,
    value = 0n,
    waitForFinality = false,
    successTitle,
    successDescription,
  }: {
    title: string;
    details: Array<[string, string]>;
    functionName: string;
    args: unknown[];
    value?: bigint;
    waitForFinality?: boolean;
    successTitle?: string;
    successDescription?: string;
  }): Promise<boolean> => {
    if (!ensureWallet() || !address) return false;
    setBusy(true);
    setTransaction({ title, details, open: true, stage: "preparing" });
    try {
      await writeCrownTransaction({
        address,
        connector,
        functionName,
        args,
        value,
        waitForFinality,
        onProgress: (progress: TxProgress) =>
          setTransaction((current) =>
            current
              ? {
                  ...current,
                  stage: progress.stage,
                  hash: progress.hash ?? current.hash,
                }
              : current,
          ),
      });
      await invalidate();
      setTransaction((current) =>
        current ? { ...current, stage: "success" } : current,
      );
      toast.success(successTitle ?? `${title} confirmed`, {
        description: successDescription,
      });
      return true;
    } catch (error) {
      const copy = getCrownErrorCopy(error);
      const message = `${copy.title}: ${copy.message}`;
      setTransaction((current) =>
        current ? { ...current, stage: "failed", error: message } : current,
      );
      toast.error(copy.title, { description: copy.message });
      return false;
    } finally {
      setBusy(false);
    }
  };

  const submitPosition = async () => {
    if (!ensureWallet()) return;
    if (!selected) {
      toast.error("Select an asset", {
        description: "Choose BTC, ETH, SOL, BNB, or XRP before staking.",
      });
      return;
    }
    if (
      position &&
      (!position.canTopUp || position.selectedAsset !== selected)
    ) {
      toast.error("Your asset is locked", {
        description:
          "You already chose another asset in this market. A wallet can back only one asset per market.",
      });
      return;
    }
    let stake: bigint;
    try {
      stake = parseCrownGen(amount);
    } catch (error) {
      toast.error("Invalid stake amount", {
        description: "Enter a valid GEN amount with up to 18 decimals.",
      });
      return;
    }
    if (stake < minStake) {
      toast.error("Stake too small", {
        description: `Each stake addition must be at least ${formatCrownGen(minStake)}.`,
      });
      return;
    }
    if (stake > remaining) {
      toast.error("Stake limit reached", {
        description: `You can stake a maximum of ${formatCrownGen(maxStake)} in this market.`,
      });
      return;
    }
    const succeeded = await runTransaction({
      title: position ? `Top up ${selected}` : `Predict ${selected}`,
      details: [
        ["Asset", selected],
        ["Stake", formatCrownGen(stake)],
        ["Market window", fmtUtcMarketWindow(market.startISO, market.endISO)],
      ],
      functionName: "place_position",
      args: [BigInt(market.id), selected],
      value: stake,
      successTitle: position ? "Position updated" : "Prediction placed",
      successDescription: position
        ? `${formatCrownGen(stake)} was added to your ${selected} position.`
        : `You backed ${selected} with ${formatCrownGen(stake)}.`,
    });
    if (succeeded) setAmount("1");
  };

  const claim = async () => {
    if (!position?.claimAvailable || position.claimableAmount <= 0n) return;
    await runTransaction({
      title: position.claimType === "REFUND" ? "Claim refund" : "Claim payout",
      details: [
        ["Type", position.claimType],
        ["Amount", formatCrownGen(position.claimableAmount)],
        ["Market window", fmtUtcMarketWindow(market.startISO, market.endISO)],
      ],
      functionName: "claim",
      args: [BigInt(market.id)],
      waitForFinality: true,
      successTitle:
        position.claimType === "REFUND" ? "Refund claimed" : "Claim successful",
      successDescription:
        position.claimType === "REFUND"
          ? "Your original stake was refunded."
          : "Your payout was claimed.",
    });
  };

  const settle = async () => {
    await runTransaction({
      title: "Settle Crown market",
      details: [
        ["Market window", fmtUtcMarketWindow(market.startISO, market.endISO)],
        ["Settlement", "Permissionless"],
      ],
      functionName: "settle_market",
      args: [BigInt(market.id)],
      successTitle: "Settlement request completed",
      successDescription:
        "The latest Crown state will determine whether the market resolved or remains retryable.",
    });
  };

  const closeTransaction = (open: boolean) => {
    if (!busy && !open) setTransaction(null);
    else
      setTransaction((current) => (current ? { ...current, open } : current));
  };

  const positionAsset = position?.selectedAsset ?? selected;
  const positionRows =
    positionAsset && position
      ? [
          <Row key="pick" label="Your Pick" value={positionAsset} />,
          <Row
            key="stake"
            label="Your Stake"
            value={formatCrownGen(position.totalStake)}
          />,
        ]
      : null;

  const disconnectedContent = (
    <>
      <div className="flex items-center gap-2 text-sm font-semibold">
        <Wallet className="h-4 w-4 text-gold" /> Connect your wallet
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Connect an injected wallet to view your position or place a prediction
        while the market is open.
      </p>
      <Button
        className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
        onClick={() => openConnectModal?.()}
      >
        Connect Wallet
      </Button>
      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <span className="text-xs text-muted-foreground">Market status</span>
        <StatusBadge status={market.status} />
      </div>
    </>
  );

  let content: React.ReactNode;
  if (!isConnected) {
    content = disconnectedContent;
  } else if (positionError) {
    content = (
      <CrownErrorState
        title="Unable to load your position"
        message="We couldn't read your wallet's position for this market."
        onRetry={onRetryPosition}
      />
    );
  } else if (positionLoading) {
    content = (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading your position…
      </div>
    );
  } else if (configQuery.isError) {
    content = (
      <CrownErrorState
        title="Protocol configuration unavailable"
        message="We couldn't read Crown's current limits and timing rules."
        onRetry={() => void configQuery.refetch()}
      />
    );
  } else if (configQuery.isPending || !config) {
    content = (
      <div className="flex items-center justify-center p-8 text-sm text-muted-foreground">
        Loading Crown protocol rules…
      </div>
    );
  } else if (market.status === "OPEN") {
    const locked = Boolean(position?.hasPosition);
    const canTopUp = Boolean(position?.canTopUp);
    content = (
      <>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {locked ? "Your position" : "Make a prediction"}
          </h3>
          <span className="text-xs text-muted-foreground">
            Closes in{" "}
            <Countdown
              targetISO={
                market.onchain.bettingCloseTimestamp
                  ? new Date(
                      Number(market.onchain.bettingCloseTimestamp) * 1000,
                    ).toISOString()
                  : market.startISO
              }
              className="text-foreground"
            />
          </span>
        </div>
        {locked && position?.selectedAsset ? (
          <div className="mt-4 space-y-1">
            <div className="flex items-center gap-3 rounded-lg border border-gold/40 bg-gold-soft p-3">
              <AssetIcon asset={position.selectedAsset} />
              <div>
                <div className="text-xs text-muted-foreground">Your Pick</div>
                <div className="text-sm font-semibold">
                  {position.selectedAsset}
                </div>
              </div>
              <Lock className="ml-auto h-4 w-4 text-muted-foreground" />
            </div>
            <Row
              label="Your Stake"
              value={formatCrownGen(position.totalStake)}
            />
            <Row label="Remaining Capacity" value={formatCrownGen(remaining)} />
            <Row
              label={`${position.selectedAsset} pool`}
              value={formatCrownGen(
                market.onchain.pools[position.selectedAsset],
              )}
            />
            <Row label="Total pool" value={total} />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-5 gap-2">
            {ASSETS.map((asset) => (
              <button
                key={asset}
                type="button"
                onClick={() => setSelected(asset)}
                aria-pressed={selected === asset}
                className={cn(
                  "flex flex-col items-center gap-1.5 rounded-lg border border-border bg-elevated px-1 py-2.5 text-xs font-medium transition-colors hover:border-border-strong",
                  selected === asset && "gold-ring bg-gold-soft text-gold",
                )}
              >
                <AssetIcon asset={asset} size="sm" />
                {asset}
              </button>
            ))}
          </div>
        )}
        {(!locked || canTopUp) && (
          <div className="mt-4 space-y-3">
            <label
              className="block text-xs text-muted-foreground"
              htmlFor={`stake-${market.id}`}
            >
              Stake amount (GEN)
            </label>
            <Input
              id={`stake-${market.id}`}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              className="tabular h-11 border-border bg-elevated text-base"
            />
            <div className="flex gap-2">
              {[1, 2, 5].map((quick) => (
                <Button
                  key={quick}
                  variant="outline"
                  size="sm"
                  className="flex-1 border-border bg-elevated"
                  onClick={() => {
                    let current = 0n;
                    try {
                      current = parseCrownGen(amount);
                    } catch {
                      // The submit path reports malformed input.
                    }
                    const next =
                      current + BigInt(quick) * 1_000_000_000_000_000_000n;
                    setAmount(
                      formatCrownGenInput(next > remaining ? remaining : next),
                    );
                  }}
                >
                  +{quick}
                </Button>
              ))}
              <Button
                variant="outline"
                size="sm"
                className="flex-1 border-border bg-elevated"
                onClick={() => setAmount(formatCrownGenInput(remaining))}
              >
                Max
              </Button>
            </div>
            <div className="rounded-lg border border-border bg-elevated/60 p-3">
              <Row
                label={
                  positionAsset ? `${positionAsset} pool` : "Selected pool"
                }
                value={
                  positionAsset
                    ? formatCrownGen(market.onchain.pools[positionAsset])
                    : "—"
                }
              />
              <Row label="Total pool" value={total} />
            </div>
            <Button
              className="h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
              disabled={busy || !config || (isConnected && !positionAsset)}
              onClick={() => void submitPosition()}
            >
              {!isConnected
                ? "Connect Wallet"
                : position
                  ? `Add to ${positionAsset} Position`
                  : positionAsset
                    ? `Predict ${positionAsset}`
                    : "Select an asset"}
            </Button>
          </div>
        )}
        {locked && !canTopUp && (
          <p className="mt-4 rounded-lg border border-border bg-elevated p-3 text-xs text-muted-foreground">
            Your remaining capacity is below the {formatCrownGen(minStake)}{" "}
            minimum addition.
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">
          One asset per wallet per market. Stake {formatCrownGen(minStake)}–
          {formatCrownGen(maxStake)} cumulatively.
        </p>
      </>
    );
  } else if (market.status === "LOCKED") {
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4 text-muted-foreground" /> Predictions closed
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Entry for this market has closed. New positions are no longer
          accepted.
        </p>
        {positionRows && <div className="mt-4 space-y-1">{positionRows}</div>}
        <div className="mt-4 rounded-lg border border-border bg-elevated p-3 text-center">
          <div className="text-xs text-muted-foreground">
            Performance starts in
          </div>
          <Countdown targetISO={market.startISO} className="text-2xl" />
        </div>
      </>
    );
  } else if (market.status === "LIVE") {
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          {positionRows ? (
            <Timer className="h-4 w-4 text-info" />
          ) : (
            <Lock className="h-4 w-4 text-muted-foreground" />
          )}{" "}
          {positionRows ? "Performance window live" : "Predictions closed"}
        </div>
        {!positionRows && (
          <p className="mt-2 text-sm text-muted-foreground">
            You didn't enter this market before the betting window closed. New
            positions are not allowed once the 4-hour performance window begins.
          </p>
        )}
        {positionRows && <div className="mt-4 space-y-1">{positionRows}</div>}
        <div className="mt-4 rounded-lg border border-border bg-elevated p-3 text-center">
          <div className="text-xs text-muted-foreground">
            Performance window live
          </div>
          <div className="mt-1 text-xs text-muted-foreground">Ends in</div>
          <Countdown targetISO={timelineEnd} className="text-2xl" />
        </div>
      </>
    );
  } else if (market.status === "FINALIZING") {
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          {positionRows ? (
            <RefreshCw className="h-4 w-4 text-warning" />
          ) : (
            <Lock className="h-4 w-4 text-muted-foreground" />
          )}{" "}
          {positionRows ? "Performance window ended" : "Predictions closed"}
        </div>
        {positionRows ? (
          <p className="mt-2 text-sm text-muted-foreground">
            Performance window ended. Settlement becomes available after the
            protocol grace period.
          </p>
        ) : (
          <p className="mt-2 text-sm text-muted-foreground">
            This market has finished its 4-hour performance window. New
            positions are no longer accepted.
          </p>
        )}
        {positionRows && <div className="mt-4 space-y-1">{positionRows}</div>}
        {!positionRows && (
          <div className="mt-4 rounded-lg border border-border bg-elevated p-3 text-center">
            <div className="text-sm font-medium">Finalizing</div>
            <div className="mt-1 text-xs text-muted-foreground">
              Waiting for the market to become settlement eligible.
            </div>
          </div>
        )}
      </>
    );
  } else if (market.status === "SETTLEMENT_READY") {
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-warning" /> Ready to settle
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Settlement is permissionless — anyone can request it. If a source is
          temporarily unavailable, the market remains pending and can be retried
          during Crown's retry window.
        </p>
        {positionRows && <div className="mt-4 space-y-1">{positionRows}</div>}
        <Button
          className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
          disabled={busy || !market.onchain.settlementAvailable || !config}
          onClick={() => void settle()}
        >
          {!isConnected ? "Connect Wallet" : "Settle Market"}
        </Button>
      </>
    );
  } else if (market.status === "INCONCLUSIVE") {
    content = (
      <>
        <div className="text-sm font-semibold">Market inconclusive</div>
        <p className="mt-2 text-sm text-muted-foreground">
          No final winner was established under Crown's settlement rules.
          Original stakes are refundable — each user claims their own refund.
        </p>
        {position ? (
          <>
            <div className="mt-4 space-y-1">
              {positionRows}
              <Row
                label="Refundable"
                value={formatCrownGen(position.claimableAmount)}
              />
            </div>
            <Button
              className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
              disabled={
                busy || !position.claimAvailable || position.alreadyClaimed
              }
              onClick={() => void claim()}
            >
              {position.alreadyClaimed ? "Refund claimed" : "Claim refund"}
            </Button>
          </>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Connect the wallet that owns a position to claim its refund.
          </p>
        )}
      </>
    );
  } else {
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Crown className="h-4 w-4 text-gold" /> Market resolved
        </div>
        <div className="mt-4 flex items-center gap-3 rounded-lg border border-gold/40 bg-gold-soft p-3">
          {market.winner && <AssetIcon asset={market.winner} />}
          <div>
            <div className="text-xs text-muted-foreground">Contract winner</div>
            <div className="text-sm font-semibold text-gold">
              {market.winner ?? "—"}
            </div>
          </div>
          <span className="ml-auto text-xs text-muted-foreground">
            Consensus {market.onchain.consensusCount.toString()}/3
          </span>
        </div>
        {position ? (
          position.positionWon ? (
            <>
              <div className="mt-4 space-y-1">
                {positionRows}
                <Row
                  label="Claimable"
                  value={formatCrownGen(position.claimableAmount)}
                />
              </div>
              <Button
                className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
                disabled={
                  busy || !position.claimAvailable || position.alreadyClaimed
                }
                onClick={() => void claim()}
              >
                {position.alreadyClaimed
                  ? "Claimed"
                  : `Claim ${formatCrownGen(position.claimableAmount)}`}
              </Button>
            </>
          ) : (
            <div className="mt-4 space-y-1">
              {positionRows}
              <p className="mt-3 rounded-lg border border-border bg-elevated p-3 text-sm text-muted-foreground">
                Your position lost. {market.winner ?? "The winning asset"} took
                the Crown for this window.
              </p>
            </div>
          )
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            You did not enter this market.
          </p>
        )}
      </>
    );
  }

  return (
    <>
      <Panel>{content}</Panel>
      {transaction && (
        <TransactionDialog
          open={transaction.open}
          onOpenChange={closeTransaction}
          title={transaction.title}
          details={transaction.details}
          stage={transaction.stage}
          error={transaction.error}
          hash={transaction.hash}
        />
      )}
    </>
  );
}
