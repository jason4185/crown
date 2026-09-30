import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import {
  Check,
  Flame,
  Lock,
  RefreshCw,
  ShieldCheck,
  Wallet,
} from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import { StatusBadge } from "@/components/crown/StatusBadge";
import { TransactionDialog } from "@/components/crown/TransactionDialog";
import { Countdown } from "@/components/crown/Countdown";
import { GENLAYER_CHAIN_ID } from "@/lib/crown/config";
import { getCrownErrorCopy } from "@/lib/crown/errors";
import { useCrownTransactionKit } from "@/lib/crown/kit";
import { formatCrownGenInput } from "@/lib/crown/contract";
import {
  energyMarketTitle,
  energyOutcomeLabel,
  formatEnergyGen,
  getEnergyConfig,
  getEnergyEvidence,
  getEnergyMarket,
  getEnergyPosition,
  getEnergyMarketsPage,
  parseCrownGen,
  crownEnergyTransaction,
  type EnergyMarket,
  type EnergyPosition,
  type EnergySettlementEvidence,
} from "@/lib/crown/energy";
import {
  fmtGen,
  fmtUtcFull,
  fmtUtcMarketWindow,
} from "@/lib/crown/presentation";

export const Route = createFileRoute("/energy/$id")({
  head: () => ({
    meta: [
      { title: "Crown Energy Market" },
      {
        name: "description",
        content: "Crown Energy markets for exact 1H and 2H UTC windows.",
      },
    ],
  }),
  component: EnergyMarketDetail,
});

function PoolComposition({ market }: { market: EnergyMarket }) {
  const keys =
    market.marketType === "UP_DOWN"
      ? ["UP", "DOWN"]
      : ["WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS"];
  const total = market.onchain.totalPool;
  return (
    <div className="space-y-3">
      {keys.map((key) => {
        const amount = market.onchain.outcomePools[key] ?? 0n;
        const share = total === 0n ? 0 : Number((amount * 1000n) / total) / 10;
        return (
          <div key={key}>
            <div className="flex items-center gap-3">
              <span className="inline-flex h-6 w-6 items-center justify-center rounded-full border border-gold/35 bg-gold-soft text-[10px] font-semibold text-gold">
                {key === "UP" ? "↑" : key === "DOWN" ? "↓" : "E"}
              </span>
              <span className="text-sm font-medium">
                {energyOutcomeLabel(key)}
              </span>
              {market.winner === key && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gold">
                  Crown
                </span>
              )}
              <span className="tabular ml-auto text-sm">
                {formatEnergyGen(amount)}
              </span>
              <span className="tabular w-24 text-right text-xs text-muted-foreground">
                {share.toFixed(1)}% of pool
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full bg-gold"
                style={{ width: `${share}%` }}
              />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted-foreground">
        Pool share, not probability. Total pool{" "}
        <span className="tabular text-foreground">
          {formatEnergyGen(total)}
        </span>
        .
      </p>
    </div>
  );
}

function Evidence({
  evidence,
  loading,
  error,
  onRetry,
}: {
  evidence?: EnergySettlementEvidence | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  if (loading)
    return (
      <p className="text-sm text-muted-foreground">
        Loading settlement evidence…
      </p>
    );
  if (error)
    return (
      <CrownErrorState
        title="Unable to load settlement evidence"
        message="The contract did not return the current source evidence."
        onRetry={onRetry}
      />
    );
  if (!evidence)
    return (
      <p className="text-sm text-muted-foreground">
        Evidence becomes available after a settlement attempt.
      </p>
    );
  return (
    <div className="space-y-2">
      {evidence.sources.map((source) => (
        <div
          key={source.source}
          className="flex items-center gap-3 rounded-lg border border-border bg-elevated px-3 py-2.5"
        >
          <span className="text-sm font-medium">{source.source}</span>
          <span
            className={
              source.status === "VALID"
                ? "rounded border border-success/35 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success"
                : "rounded border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
            }
          >
            {source.status}
          </span>
          <span className="ml-auto text-sm">
            {source.winner ? energyOutcomeLabel(source.winner) : "—"}
          </span>
        </div>
      ))}
      <p className="border-t border-border pt-3 text-xs text-muted-foreground">
        Settlement requires 2 of 3 valid source agreements.
      </p>
    </div>
  );
}

function EnergyActionPanel({
  market,
  position,
  positionLoading,
  positionError,
  onRetryPosition,
}: {
  market: EnergyMarket;
  position: EnergyPosition | null;
  positionLoading: boolean;
  positionError: boolean;
  onRetryPosition: () => void;
}) {
  const { address, chainId, connector, isConnected } = useAccount();
  const kit = useCrownTransactionKit(address, connector);
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const queryClient = useQueryClient();
  const configQuery = useQuery({
    queryKey: ["crown", "energy", "config"],
    queryFn: getEnergyConfig,
    staleTime: 300_000,
  });
  const [selected, setSelected] = useState<string | null>(
    position?.selectedOutcome ?? null,
  );
  const [amount, setAmount] = useState("1");
  const [transaction, setTransaction] = useState<{
    open: boolean;
    tx: ReturnType<typeof crownEnergyTransaction>;
    title: string;
    details: Array<[string, string]>;
    userValueGen?: string;
    finalized?: boolean;
  } | null>(null);
  useEffect(
    () => setSelected(position?.selectedOutcome ?? null),
    [position?.selectedOutcome, address],
  );
  const config = configQuery.data;
  const invalidate = () =>
    Promise.all([
      queryClient.invalidateQueries({
        queryKey: ["crown", "energy", "market", market.id],
      }),
      queryClient.invalidateQueries({
        queryKey: ["crown", "energy", "position", market.id, address],
      }),
      queryClient.invalidateQueries({
        queryKey: ["crown", "energy", "markets"],
      }),
    ]);
  const ensureWallet = () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return false;
    }
    if (chainId !== GENLAYER_CHAIN_ID) {
      toast.error("Wrong network", {
        description: "Switch to GenLayer Studio Next to continue.",
      });
      openChainModal?.();
      return false;
    }
    return true;
  };
  const run = (
    method: Parameters<typeof crownEnergyTransaction>[0],
    args: (bigint | number | string)[],
    details: Array<[string, string]>,
    value?: bigint,
    finalized = false,
  ) => {
    if (!ensureWallet()) return;
    try {
      setTransaction({
        open: true,
        tx: crownEnergyTransaction(method, args),
        title:
          method === "settle_market"
            ? "Settle Energy market"
            : method === "claim_refund"
              ? "Claim Energy refund"
              : method === "claim"
                ? "Claim Energy payout"
                : "Confirm Energy transaction",
        details,
        ...(value && value > 0n
          ? { userValueGen: formatCrownGenInput(value) }
          : {}),
        finalized,
      });
    } catch (error) {
      const copy = getCrownErrorCopy(error);
      toast.error(copy.title, { description: copy.message });
    }
  };
  const submit = () => {
    if (!ensureWallet() || !config) return;
    if (!selected) {
      toast.error("Choose an outcome", {
        description: "Select an Energy outcome before betting.",
      });
      return;
    }
    if (
      position?.hasPosition &&
      (!position.canTopUp || position.selectedOutcome !== selected)
    ) {
      toast.error("Your outcome is locked", {
        description: "A wallet can back only one outcome per Energy market.",
      });
      return;
    }
    let stake: bigint;
    try {
      stake = parseCrownGen(amount);
    } catch {
      toast.error("Invalid stake amount", {
        description: "Enter a valid GEN amount.",
      });
      return;
    }
    const remaining =
      position?.remainingCapacity ?? config.maximumBetPerWalletPerMarket;
    if (stake < config.minimumBet) {
      toast.error("Stake too small", {
        description: `Each bet must be at least ${formatEnergyGen(config.minimumBet)}.`,
      });
      return;
    }
    if (stake > remaining) {
      toast.error("Stake limit reached", {
        description: `The maximum cumulative stake is ${formatEnergyGen(config.maximumBetPerWalletPerMarket)}.`,
      });
      return;
    }
    run(
      "place_bet",
      [BigInt(market.id), selected],
      [
        ["Outcome", energyOutcomeLabel(selected)],
        ["Stake", formatEnergyGen(stake)],
        ["Market window", fmtUtcMarketWindow(market.startISO, market.endISO)],
      ],
      stake,
    );
  };
  const settle = () =>
    run(
      "settle_market",
      [BigInt(market.id)],
      [
        ["Market window", fmtUtcMarketWindow(market.startISO, market.endISO)],
        ["Settlement", "Permissionless"],
      ],
    );
  const claim = () =>
    run(
      market.status === "INCONCLUSIVE" ? "claim_refund" : "claim",
      [BigInt(market.id)],
      [
        ["Type", market.status === "INCONCLUSIVE" ? "REFUND" : "PAYOUT"],
        ["Market window", fmtUtcMarketWindow(market.startISO, market.endISO)],
      ],
      undefined,
      true,
    );
  const close = (open: boolean) => {
    if (!open) {
      setTransaction(null);
      void invalidate();
    }
  };
  if (!isConnected)
    return (
      <div className="surface p-5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Wallet className="h-4 w-4 text-gold" /> Connect your wallet
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Connect to view your Energy position or participate in this market.
        </p>
        <Button
          className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
          onClick={() => openConnectModal?.()}
        >
          Connect Wallet
        </Button>
      </div>
    );
  if (positionLoading)
    return (
      <div className="surface p-8 text-center text-sm text-muted-foreground">
        Loading your Energy position…
      </div>
    );
  if (positionError)
    return (
      <CrownErrorState
        title="Unable to load your position"
        message="We couldn't read your Energy position from the deployed contract."
        onRetry={onRetryPosition}
      />
    );
  let content: React.ReactNode;
  if (market.status === "OPEN") {
    const outcomes =
      market.marketType === "UP_DOWN"
        ? ["UP", "DOWN"]
        : ["WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS"];
    const locked = Boolean(position?.hasPosition);
    content = (
      <>
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-semibold">
            {locked ? "Your position" : "Make a prediction"}
          </h3>
          <span className="text-xs text-muted-foreground">
            Open until start
          </span>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          {outcomes.map((outcome) => (
            <button
              key={outcome}
              type="button"
              disabled={locked && position?.selectedOutcome !== outcome}
              onClick={() => setSelected(outcome)}
              className={`rounded-lg border px-2 py-3 text-xs font-medium transition-colors ${selected === outcome ? "gold-ring bg-gold-soft text-gold" : "border-border bg-elevated hover:border-border-strong"}`}
            >
              {energyOutcomeLabel(outcome)}
            </button>
          ))}
        </div>
        <div className="mt-4 space-y-3">
          <label
            className="block text-xs text-muted-foreground"
            htmlFor={`energy-stake-${market.id}`}
          >
            Stake amount (GEN)
          </label>
          <Input
            id={`energy-stake-${market.id}`}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="tabular h-11 border-border bg-elevated text-base"
          />
          <Button
            className="h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
            disabled={!selected || Boolean(transaction) || !config}
            onClick={submit}
          >
            {locked
              ? `Add to ${energyOutcomeLabel(selected ?? "")}`
              : `Bet ${energyOutcomeLabel(selected ?? "")}`}
          </Button>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          One outcome per wallet. Same-outcome top-ups only, up to{" "}
          {config
            ? formatEnergyGen(config.maximumBetPerWalletPerMarket)
            : "40 GEN"}
          .
        </p>
      </>
    );
  } else if (market.status === "SETTLEMENT_READY")
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <ShieldCheck className="h-4 w-4 text-warning" /> Ready to settle
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Settlement is permissionless. Any connected wallet can request the
          2-of-3 source resolution.
        </p>
        <Button
          className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
          disabled={Boolean(transaction)}
          onClick={settle}
        >
          Settle Market
        </Button>
      </>
    );
  else if (market.status === "RESOLVED" || market.status === "INCONCLUSIVE")
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          {market.status === "RESOLVED" ? (
            <Check className="h-4 w-4 text-gold" />
          ) : (
            <RefreshCw className="h-4 w-4 text-muted-foreground" />
          )}{" "}
          {market.status === "RESOLVED"
            ? "Market resolved"
            : "Market inconclusive"}
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          {market.status === "RESOLVED"
            ? `Winner: ${energyOutcomeLabel(market.winner ?? "—")}`
            : "No backed consensus winner was finalized. Original stakes are refundable."}
        </p>
        {position?.claimAvailable && (
          <Button
            className="mt-4 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90"
            disabled={Boolean(transaction)}
            onClick={claim}
          >
            {market.status === "INCONCLUSIVE" ? "Claim refund" : "Claim payout"}
          </Button>
        )}
      </>
    );
  else
    content = (
      <>
        <div className="flex items-center gap-2 text-sm font-semibold">
          <Lock className="h-4 w-4 text-muted-foreground" /> Predictions closed
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          The betting window is closed. No new Energy bets can be placed.
        </p>
        {position?.hasPosition && (
          <div className="mt-4 rounded-lg border border-gold/35 bg-gold-soft p-3 text-sm">
            Your pick:{" "}
            <span className="font-semibold">
              {energyOutcomeLabel(position.selectedOutcome ?? "—")}
            </span>
            <span className="ml-3 tabular">
              {formatEnergyGen(position.stake)}
            </span>
          </div>
        )}
        <div className="mt-4 rounded-lg border border-border bg-elevated p-3 text-center text-xs text-muted-foreground">
          {market.status === "LIVE" ? (
            <>
              Ends in{" "}
              <Countdown
                targetISO={market.endISO}
                className="text-foreground"
              />
            </>
          ) : market.status === "FINALIZING" ? (
            "Settlement is being prepared."
          ) : (
            "Awaiting the next market state."
          )}
        </div>
      </>
    );
  return (
    <div className="surface p-5">
      {content}
      {transaction && (
        <TransactionDialog
          open={transaction.open}
          onOpenChange={close}
          title={transaction.title}
          details={transaction.details}
          kit={kit}
          tx={transaction.tx}
          userValueGen={transaction.userValueGen}
          finalized={transaction.finalized}
          onAccepted={() => {
            void invalidate();
            setTransaction(null);
            toast.success("Energy transaction accepted");
          }}
          onFailed={(status) =>
            toast.error("Energy transaction failed", {
              description:
                status.executionResultName ??
                "The contract rejected the transaction.",
            })
          }
        />
      )}
    </div>
  );
}

function EnergyMarketDetail() {
  const { id } = Route.useParams();
  const marketId = Number(id);
  const { address } = useAccount();
  const marketQuery = useQuery({
    queryKey: ["crown", "energy", "market", marketId],
    queryFn: () => getEnergyMarket(marketId),
    enabled: Number.isSafeInteger(marketId) && marketId > 0,
    staleTime: 10_000,
  });
  const positionQuery = useQuery({
    queryKey: ["crown", "energy", "position", marketId, address],
    queryFn: () => getEnergyPosition(marketId, address!),
    enabled: Boolean(address) && Number.isSafeInteger(marketId) && marketId > 0,
    staleTime: 10_000,
  });
  const market = marketQuery.data;
  const evidenceQuery = useQuery({
    queryKey: ["crown", "energy", "evidence", marketId],
    queryFn: () => getEnergyEvidence(marketId),
    enabled: Boolean(market?.onchain.evidenceAvailable),
    staleTime: 15_000,
  });
  if (marketQuery.isPending)
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-24 text-center text-sm text-muted-foreground">
        Loading Energy market…
      </div>
    );
  if (marketQuery.isError || !market)
    return (
      <div className="mx-auto max-w-[1100px] px-4 py-16">
        <CrownErrorState
          title="Energy market unavailable"
          message="We couldn't read this market from the deployed Crown Energy contract."
          onRetry={() => void marketQuery.refetch()}
        />
      </div>
    );
  const timeline = [
    { label: "Market starts", value: market.startISO },
    { label: "Market ends", value: market.endISO },
    {
      label: "Retry deadline",
      value: new Date(
        Number(market.onchain.settlementDeadline) * 1000,
      ).toISOString(),
    },
  ];
  return (
    <div className="mx-auto max-w-[1100px] px-4 py-10 sm:px-6">
      <Link
        to="/markets"
        search={{ q: "" }}
        className="text-sm text-muted-foreground hover:text-foreground"
      >
        ← Back to markets
      </Link>
      <header className="mt-6 flex flex-wrap items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
            <Flame className="h-4 w-4" /> Energy · {market.marketType} ·{" "}
            {market.durationLabel}
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            {energyMarketTitle(market)}
          </h1>
          <p className="mt-2 text-sm text-muted-foreground">
            {fmtUtcMarketWindow(market.startISO, market.endISO)}
          </p>
        </div>
        <StatusBadge status={market.status} />
      </header>
      <div className="mt-8 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="space-y-6">
          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Pool composition</h2>
            <div className="mt-4">
              <PoolComposition market={market} />
            </div>
          </section>
          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Settlement evidence</h2>
            <div className="mt-4">
              <Evidence
                evidence={evidenceQuery.data}
                loading={evidenceQuery.isPending}
                error={evidenceQuery.isError}
                onRetry={() => void evidenceQuery.refetch()}
              />
            </div>
          </section>
          <section className="surface p-5">
            <h2 className="text-sm font-semibold">Energy market rules</h2>
            <p className="mt-3 text-sm leading-6 text-muted-foreground">
              {market.marketType === "UP_DOWN"
                ? "The selected asset is evaluated UP or DOWN from its exact start-to-close price direction."
                : "WTI Crude, Brent, and Natural Gas compete on percentage return over the same exact UTC window."}{" "}
              Bets use pari-mutuel pools and settlement requires 2-of-3
              independent sources.
            </p>
          </section>
        </div>
        <div className="space-y-6">
          <EnergyActionPanel
            market={market}
            position={positionQuery.data ?? null}
            positionLoading={positionQuery.isPending}
            positionError={positionQuery.isError}
            onRetryPosition={() => void positionQuery.refetch()}
          />
          <section className="surface p-5">
            <h2 className="text-sm font-semibold">UTC timeline</h2>
            <div className="mt-4 space-y-3">
              {timeline.map((item) => (
                <div
                  key={item.label}
                  className="flex items-center justify-between gap-4 border-b border-border pb-3 text-sm last:border-0 last:pb-0"
                >
                  <span className="text-muted-foreground">{item.label}</span>
                  <span className="tabular text-right font-medium">
                    {fmtUtcFull(item.value)}
                  </span>
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}
