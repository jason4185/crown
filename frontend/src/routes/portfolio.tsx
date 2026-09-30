import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useConnectModal, useChainModal } from "@rainbow-me/rainbowkit";
import { useAccount } from "wagmi";
import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowRight,
  Check,
  CircleDollarSign,
  Clock3,
  History,
  Layers3,
  Loader2,
} from "lucide-react";
import { toast } from "sonner";
import { AssetIcon } from "@/components/crown/AssetIcon";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import { StatusBadge } from "@/components/crown/StatusBadge";
import { TransactionDialog } from "@/components/crown/TransactionDialog";
import { Button } from "@/components/ui/button";
import {
  formatCrownGen,
  crownTransaction,
  getMarketsPage,
  getUserPosition,
  type CrownMarket,
  type CrownPosition,
  type CrownTransactionRequest,
} from "@/lib/crown/contract";
import { GENLAYER_CHAIN_ID } from "@/lib/crown/config";
import { getCrownErrorCopy } from "@/lib/crown/errors";
import { useCrownTransactionKit } from "@/lib/crown/kit";
import { fmtUtcMarketWindow } from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";
import {
  energyOutcomeLabel,
  formatEnergyGen,
  getEnergyMarketsPage,
  getEnergyPosition,
  type EnergyMarket,
  type EnergyPosition,
} from "@/lib/crown/energy";

export const Route = createFileRoute("/portfolio")({
  head: () => ({
    meta: [
      { title: "Crown Portfolio — Your positions" },
      {
        name: "description",
        content:
          "Track Crown positions, claimable payouts, and refundable stakes.",
      },
    ],
  }),
  component: PortfolioPage,
});

type PortfolioTab = "active" | "claimable" | "history";
const ACTIVE_STATUSES = new Set([
  "OPEN",
  "LOCKED",
  "LIVE",
  "FINALIZING",
  "SETTLEMENT_READY",
]);

function StatCard({
  icon: Icon,
  label,
  value,
  detail,
}: {
  icon: typeof CircleDollarSign;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div className="surface p-5">
      <div className="flex items-center gap-2 text-xs text-muted-foreground">
        <Icon className="h-4 w-4 text-gold" />
        {label}
      </div>
      <div className="tabular mt-3 text-2xl font-semibold tracking-tight">
        {value}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">{detail}</div>
    </div>
  );
}

function ClaimButton({
  market,
  position,
}: {
  market: CrownMarket;
  position: CrownPosition;
}) {
  const { address, chainId, connector, isConnected } = useAccount();
  const kit = useCrownTransactionKit(address, connector);
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const [transaction, setTransaction] = useState<{
    open: boolean;
    tx: CrownTransactionRequest;
  } | null>(null);
  if (
    !position.claimAvailable ||
    position.alreadyClaimed ||
    position.claimableAmount <= 0n
  )
    return null;
  const claim = async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    if (chainId !== GENLAYER_CHAIN_ID) {
      toast.error("Wrong network", {
        description: "Switch to GenLayer Studio Next to continue.",
      });
      openChainModal?.();
      return;
    }
    setBusy(true);
    try {
      setTransaction({
        open: true,
        tx: crownTransaction("claim", [BigInt(market.id)]),
      });
    } catch (error) {
      const copy = getCrownErrorCopy(error);
      toast.error(copy.title, { description: copy.message });
      setBusy(false);
    }
  };
  return (
    <>
      <Button
        className="ml-auto bg-gold text-gold-foreground hover:bg-gold/90"
        disabled={busy}
        onClick={() => void claim()}
      >
        {busy ? (
          <Loader2 className="h-4 w-4 animate-spin" />
        ) : position.claimType === "REFUND" ? (
          "Claim refund"
        ) : (
          `Claim ${formatCrownGen(position.claimableAmount)}`
        )}
      </Button>
      {transaction && (
        <TransactionDialog
          open={transaction.open}
          onOpenChange={(open) => {
            if (!open) {
              setTransaction(null);
              setBusy(false);
            }
          }}
          title={
            position.claimType === "REFUND" ? "Claim refund" : "Claim payout"
          }
          details={[
            ["Type", position.claimType],
            ["Amount", formatCrownGen(position.claimableAmount)],
            [
              "Market window",
              fmtUtcMarketWindow(market.startISO, market.endISO),
            ],
          ]}
          kit={kit}
          tx={transaction.tx}
          finalized
          onAccepted={() => {
            void Promise.all([
              queryClient.invalidateQueries({
                queryKey: ["crown", "market", market.id],
              }),
              queryClient.invalidateQueries({
                queryKey: ["crown", "position", market.id],
              }),
            ]).then(() => {
              setBusy(false);
              toast.success(
                position.claimType === "REFUND"
                  ? "Refund claimed"
                  : "Claim successful",
                {
                  description:
                    position.claimType === "REFUND"
                      ? "Your original stake was refunded."
                      : "Your payout was claimed.",
                },
              );
            });
          }}
          onFailed={(status) => {
            setBusy(false);
            const copy = getCrownErrorCopy(
              new Error(
                status.executionResultName ?? "Crown transaction failed",
              ),
            );
            toast.error(copy.title, { description: copy.message });
          }}
        />
      )}
    </>
  );
}

function PositionCard({
  market,
  position,
}: {
  market: CrownMarket;
  position: CrownPosition;
}) {
  const won = position.positionWon;
  const refund = position.claimType === "REFUND";
  const result =
    market.status === "RESOLVED"
      ? won
        ? "Won"
        : "Lost"
      : market.status === "INCONCLUSIVE"
        ? "Refundable"
        : "Pending";
  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Crown market</div>
          <div className="tabular mt-1 text-sm text-foreground">
            {fmtUtcMarketWindow(market.startISO, market.endISO)}
          </div>
        </div>
        <StatusBadge status={market.status} />
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-lg border border-gold/35 bg-gold-soft p-3">
        <AssetIcon asset={position.selectedAsset!} />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Your pick
          </div>
          <div className="text-sm font-semibold">{position.selectedAsset}</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Stake
          </div>
          <div className="tabular text-sm font-medium">
            {formatCrownGen(position.totalStake)}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Window</span>
          <span className="tabular">4H UTC</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Result</span>
          <span className={cn(won && "text-gold")}>{result}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Claimable</span>
          <span className="tabular">
            {position.claimAvailable
              ? formatCrownGen(position.claimableAmount)
              : "—"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Market pool</span>
          <span className="tabular">
            {formatCrownGen(market.onchain.pools[position.selectedAsset!])}
          </span>
        </div>
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4">
        <Link
          to="/markets/$id"
          params={{ id: String(market.id) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-2 text-xs font-medium transition-colors hover:border-gold/45 hover:text-gold"
        >
          View Market <ArrowRight className="h-3.5 w-3.5" />
        </Link>
        <ClaimButton market={market} position={position} />
      </div>
      {refund && (
        <p className="mt-3 text-xs text-muted-foreground">
          This market is inconclusive; the original stake is refundable.
        </p>
      )}
    </article>
  );
}

function EnergyPositionCard({
  market,
  position,
}: {
  market: EnergyMarket;
  position: EnergyPosition;
}) {
  const settled =
    market.status === "RESOLVED" || market.status === "INCONCLUSIVE";
  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-gold">Energy · {market.marketType}</div>
          <div className="tabular mt-1 text-sm">
            {fmtUtcMarketWindow(market.startISO, market.endISO)}
          </div>
        </div>
        <StatusBadge status={market.status} />
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-lg border border-gold/35 bg-gold-soft p-3">
        <span className="inline-flex h-8 w-8 items-center justify-center rounded-full border border-gold/35 bg-gold-soft text-gold">
          E
        </span>
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Your pick
          </div>
          <div className="text-sm font-semibold">
            {energyOutcomeLabel(position.selectedOutcome ?? "—")}
          </div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Stake
          </div>
          <div className="tabular text-sm font-medium">
            {formatEnergyGen(position.stake)}
          </div>
        </div>
      </div>
      <div className="mt-4 grid gap-x-5 gap-y-2 sm:grid-cols-2">
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Duration</span>
          <span className="tabular">{market.durationLabel}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Result</span>
          <span className={cn(position.positionWon && "text-gold")}>
            {settled
              ? market.status === "INCONCLUSIVE"
                ? "Refundable"
                : position.positionWon
                  ? "Won"
                  : "Lost"
              : "Pending"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Claim state</span>
          <span>
            {position.claimAvailable
              ? position.refundAvailable
                ? "Refund available"
                : "Payout available"
              : position.claimed || position.refunded
                ? "Claimed"
                : "No claim available"}
          </span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted-foreground">Claimable</span>
          <span className="tabular">
            {position.claimAvailable
              ? formatEnergyGen(position.claimableAmount)
              : "—"}
          </span>
        </div>
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <Link
          to="/energy/$id"
          params={{ id: String(market.id) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-2 text-xs font-medium transition-colors hover:border-gold/45 hover:text-gold"
        >
          View Energy Market <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function PortfolioPage() {
  const [tab, setTab] = useState<PortfolioTab>("active");
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const marketsQuery = useQuery({
    queryKey: ["crown", "portfolio-markets", 0, 25],
    queryFn: () => getMarketsPage(0, 25),
    enabled: Boolean(address),
    staleTime: 15_000,
  });
  const markets = marketsQuery.data?.markets ?? [];
  const positionQueries = useQueries({
    queries: markets.map((market) => ({
      queryKey: ["crown", "position", market.id, address],
      queryFn: () => getUserPosition(market.id, address!),
      enabled: Boolean(address),
      staleTime: 10_000,
    })),
  });
  const positionsLoading = positionQueries.some((query) => query.isLoading);
  const positionsError = positionQueries.some((query) => query.isError);
  const energyMarketsQuery = useQuery({
    queryKey: ["crown", "energy", "portfolio-markets", 0, 25],
    queryFn: () => getEnergyMarketsPage(0, 25),
    enabled: Boolean(address),
    staleTime: 15_000,
  });
  const energyMarkets = energyMarketsQuery.data?.markets ?? [];
  const energyPositionQueries = useQueries({
    queries: energyMarkets.map((market) => ({
      queryKey: ["crown", "energy", "position", market.id, address],
      queryFn: () => getEnergyPosition(market.id, address!),
      enabled: Boolean(address),
      staleTime: 10_000,
    })),
  });
  const energyRows = energyMarkets.flatMap((market, index) => {
    const position = energyPositionQueries[index]?.data;
    return position?.hasPosition ? [{ market, position }] : [];
  });
  const energyPositionsLoading = energyPositionQueries.some(
    (query) => query.isLoading,
  );
  const energyPositionsError = energyPositionQueries.some(
    (query) => query.isError,
  );
  const retryPortfolio = () => {
    void Promise.all([
      marketsQuery.refetch(),
      ...positionQueries.map((query) => query.refetch()),
      energyMarketsQuery.refetch(),
      ...energyPositionQueries.map((query) => query.refetch()),
    ]);
  };
  const rows = markets.flatMap((market, index) => {
    const position = positionQueries[index]?.data;
    return position?.hasPosition && position.selectedAsset
      ? [{ market, position }]
      : [];
  });
  const totals = useMemo(
    () => ({
      totalStaked: rows.reduce((sum, row) => sum + row.position.totalStake, 0n),
      claimable: rows.reduce(
        (sum, row) =>
          sum +
          (row.position.claimAvailable ? row.position.claimableAmount : 0n),
        0n,
      ),
      active: rows.filter((row) => ACTIVE_STATUSES.has(row.market.status))
        .length,
      settled: rows.filter(
        (row) =>
          row.market.status === "RESOLVED" ||
          row.market.status === "INCONCLUSIVE",
      ).length,
    }),
    [rows],
  );
  const combinedTotals = {
    totalStaked:
      totals.totalStaked +
      energyRows.reduce((sum, row) => sum + row.position.stake, 0n),
    claimable:
      totals.claimable +
      energyRows.reduce(
        (sum, row) =>
          sum +
          (row.position.claimAvailable ? row.position.claimableAmount : 0n),
        0n,
      ),
    active:
      totals.active +
      energyRows.filter((row) => ACTIVE_STATUSES.has(row.market.status)).length,
    settled:
      totals.settled +
      energyRows.filter(
        (row) =>
          row.market.status === "RESOLVED" ||
          row.market.status === "INCONCLUSIVE",
      ).length,
  };
  const filtered = rows.filter(({ market, position }) =>
    tab === "active"
      ? ACTIVE_STATUSES.has(market.status)
      : tab === "claimable"
        ? position.claimAvailable
        : market.status === "RESOLVED" || market.status === "INCONCLUSIVE",
  );
  const visibleEnergyRows = energyRows.filter(({ market, position }) =>
    tab === "active"
      ? ACTIVE_STATUSES.has(market.status)
      : tab === "claimable"
        ? position.claimAvailable
        : market.status === "RESOLVED" || market.status === "INCONCLUSIVE",
  );
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
          <Layers3 className="h-4 w-4" /> Portfolio
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Your Crown positions
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Positions loaded from a bounded page of Crown markets for the
          connected wallet.
        </p>
      </header>
      {!address ? (
        <div className="surface mt-8 p-12 text-center">
          <h2 className="text-base font-semibold">Connect your wallet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Connect an injected wallet to load your positions from Crown.
          </p>
          <Button
            className="mt-5 bg-gold text-gold-foreground hover:bg-gold/90"
            onClick={() => openConnectModal?.()}
          >
            Connect Wallet
          </Button>
        </div>
      ) : marketsQuery.isError ||
        positionsError ||
        energyMarketsQuery.isError ||
        energyPositionsError ? (
        <div className="mt-8">
          <CrownErrorState
            title="Unable to load Crown portfolio"
            message="We couldn't read the latest markets and positions from GenLayer Studio Next."
            onRetry={retryPortfolio}
          />
        </div>
      ) : positionsLoading ||
        energyMarketsQuery.isLoading ||
        energyPositionsLoading ? (
        <div className="surface mt-8 flex items-center justify-center p-12 text-sm text-muted-foreground">
          Loading your Crown positions…
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard
              icon={CircleDollarSign}
              label="Total Staked"
              value={formatCrownGen(combinedTotals.totalStaked)}
              detail="Across bounded Crypto and Energy pages"
            />
            <StatCard
              icon={CircleDollarSign}
              label="Claimable"
              value={formatCrownGen(combinedTotals.claimable)}
              detail="Payouts and refunds available"
            />
            <StatCard
              icon={Clock3}
              label="Active Positions"
              value={String(combinedTotals.active)}
              detail="Open through settlement-ready"
            />
            <StatCard
              icon={History}
              label="Settled Positions"
              value={String(combinedTotals.settled)}
              detail="Resolved or inconclusive"
            />
          </div>
          <div className="mt-10 flex flex-wrap gap-1 border-b border-border">
            {(
              [
                ["active", "Active"],
                ["claimable", "Claimable"],
                ["history", "History"],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
                  tab === key
                    ? "border-gold text-foreground"
                    : "border-transparent text-muted-foreground hover:text-foreground",
                )}
              >
                {label}
              </button>
            ))}
          </div>
          {filtered.length === 0 && visibleEnergyRows.length === 0 ? (
            <div className="surface mt-8 p-12 text-center">
              <Check className="mx-auto h-6 w-6 text-gold" />
              <h2 className="mt-4 text-base font-semibold">Nothing here yet</h2>
              <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
                {tab === "claimable"
                  ? "Claimable payouts and refunds will appear here after settlement."
                  : "Choose a Crown market to start building your portfolio."}
              </p>
              <Link
                to="/markets"
                search={{ q: "" }}
                className="mt-5 inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2.5 text-sm font-medium text-gold-foreground"
              >
                Browse markets <ArrowRight className="h-4 w-4" />
              </Link>
            </div>
          ) : (
            <div className="mt-8 space-y-8">
              {filtered.length > 0 && (
                <div className="grid gap-5 lg:grid-cols-2">
                  {filtered.map(({ market, position }) => (
                    <PositionCard
                      key={`CRYPTO:${market.id}`}
                      market={market}
                      position={position}
                    />
                  ))}
                </div>
              )}
              {visibleEnergyRows.length > 0 && (
                <div>
                  <div className="mb-3 text-xs uppercase tracking-[0.18em] text-gold">
                    Energy positions
                  </div>
                  <div className="grid gap-5 lg:grid-cols-2">
                    {visibleEnergyRows.map(({ market, position }) => (
                      <EnergyPositionCard
                        key={`ENERGY:${market.id}`}
                        market={market}
                        position={position}
                      />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
          <p className="mt-6 text-xs text-muted-foreground">
            Portfolio is intentionally bounded to the first 25 markets in each
            contract; neither contract enumerates user history onchain.
          </p>
        </>
      )}
    </div>
  );
}
