import { useMemo, useState } from "react";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useInfiniteQuery, useQueries } from "@tanstack/react-query";
import { getAddress, type Address } from "viem";
import {
  Activity,
  ArrowRight,
  CheckCircle2,
  Crown,
  Loader2,
} from "lucide-react";
import { AssetIcon } from "@/components/crown/AssetIcon";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import { StatusBadge } from "@/components/crown/StatusBadge";
import { Button } from "@/components/ui/button";
import {
  formatCrownGen,
  getMarket,
  getMarketsPage,
  getUserPosition,
  type CrownMarket,
  type CrownPosition,
} from "@/lib/crown/contract";
import { fmtUtcMarketWindow } from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";
import { useAccount } from "wagmi";

export const Route = createFileRoute("/activity")({
  head: () => ({
    meta: [
      { title: "Crown Activity — Your markets and positions" },
      {
        name: "description",
        content:
          "View Crown markets and positions derived from current on-chain contract state.",
      },
    ],
  }),
  component: ActivityPage,
});

type ActivityTab = "positions" | "created" | "settled";

type PositionRow = {
  market: CrownMarket;
  position: CrownPosition;
};

function sameAddress(left: string, right: Address) {
  try {
    return getAddress(left) === getAddress(right);
  } catch {
    return false;
  }
}

function ActivityPositionCard({ market, position }: PositionRow) {
  const settled =
    market.status === "RESOLVED" || market.status === "INCONCLUSIVE";
  const result = settled
    ? market.status === "INCONCLUSIVE"
      ? position.alreadyClaimed
        ? "Refund claimed"
        : "Refund available"
      : position.positionWon
        ? "Won"
        : "Lost"
    : "Pending";
  const claimState = position.alreadyClaimed
    ? position.claimType === "REFUND"
      ? "Refund claimed"
      : "Payout claimed"
    : position.claimAvailable
      ? position.claimType === "REFUND"
        ? "Refund available"
        : "Claim available"
      : "No claim available";

  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Crown market</div>
          <div className="tabular mt-1 text-sm">
            {fmtUtcMarketWindow(market.startISO, market.endISO)}
          </div>
        </div>
        <StatusBadge status={market.status} />
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-lg border border-gold/35 bg-gold-soft p-3">
        {position.selectedAsset && <AssetIcon asset={position.selectedAsset} />}
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Your pick
          </div>
          <div className="text-sm font-semibold">
            {position.selectedAsset ?? "—"}
          </div>
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
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Result</span>
          <span className={cn(position.positionWon && "text-gold")}>
            {result}
          </span>
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Claim state</span>
          <span>{claimState}</span>
        </div>
        <div className="flex justify-between gap-3 text-sm">
          <span className="text-muted-foreground">Claimable</span>
          <span className="tabular">
            {position.claimAvailable
              ? formatCrownGen(position.claimableAmount)
              : "—"}
          </span>
        </div>
        {market.winner && (
          <div className="flex justify-between gap-3 text-sm">
            <span className="text-muted-foreground">Final winner</span>
            <span className="font-medium text-gold">{market.winner}</span>
          </div>
        )}
      </div>
      <div className="mt-5 border-t border-border pt-4">
        <Link
          to="/markets/$id"
          params={{ id: String(market.id) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-2 text-xs font-medium transition-colors hover:border-gold/45 hover:text-gold"
        >
          View Market <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function CreatedMarketCard({ market }: { market: CrownMarket }) {
  return (
    <article className="surface p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-xs text-muted-foreground">Crown market</div>
          <div className="tabular mt-1 text-sm">
            {fmtUtcMarketWindow(market.startISO, market.endISO)}
          </div>
        </div>
        <StatusBadge status={market.status} />
      </div>
      <div className="mt-5 flex items-center gap-3 rounded-lg border border-gold/35 bg-gold-soft p-3">
        <Crown className="h-5 w-5 text-gold" />
        <div>
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Market creator
          </div>
          <div className="text-sm font-semibold">Created by you</div>
        </div>
        <div className="ml-auto text-right">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            Total pool
          </div>
          <div className="tabular text-sm font-medium">
            {formatCrownGen(market.onchain.totalPool)}
          </div>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
        <span className="text-muted-foreground">
          {market.winner ? `Winner: ${market.winner}` : "No final winner yet"}
        </span>
        <Link
          to="/markets/$id"
          params={{ id: String(market.id) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-2 text-xs font-medium transition-colors hover:border-gold/45 hover:text-gold"
        >
          View Market <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}

function ActivityPage() {
  const { address } = useAccount();
  const { openConnectModal } = useConnectModal();
  const [tab, setTab] = useState<ActivityTab>("positions");
  const marketsQuery = useInfiniteQuery({
    queryKey: ["crown", "activity-markets", address],
    queryFn: ({ pageParam }) => getMarketsPage(pageParam, 25),
    initialPageParam: 0,
    getNextPageParam: (page) => (page.hasMore ? page.nextOffset : undefined),
    enabled: Boolean(address),
    staleTime: 15_000,
  });
  const marketPreviews = useMemo(
    () => marketsQuery.data?.pages.flatMap((page) => page.markets) ?? [],
    [marketsQuery.data],
  );
  const marketQueries = useQueries({
    queries: marketPreviews.map((market) => ({
      queryKey: ["crown", "market", market.id],
      queryFn: () => getMarket(market.id),
      enabled: Boolean(address),
      staleTime: 15_000,
    })),
  });
  const positionQueries = useQueries({
    queries: marketPreviews.map((market) => ({
      queryKey: ["crown", "position", market.id, address],
      queryFn: () => getUserPosition(market.id, address!),
      enabled: Boolean(address),
      staleTime: 10_000,
    })),
  });
  const detailedMarkets = marketPreviews.map(
    (_, index) => marketQueries[index]?.data ?? null,
  );
  const positions = marketPreviews.flatMap((preview, index) => {
    const position = positionQueries[index]?.data;
    const market = detailedMarkets[index] ?? preview;
    return position?.hasPosition && position.selectedAsset
      ? [{ market, position }]
      : [];
  });
  const createdMarkets = detailedMarkets.filter(
    (market): market is CrownMarket =>
      Boolean(market && address && sameAddress(market.creator, address)),
  );
  const settled = positions.filter(
    ({ market }) =>
      market.status === "RESOLVED" || market.status === "INCONCLUSIVE",
  );
  const queryError =
    marketsQuery.isError ||
    marketQueries.some((query) => query.isError) ||
    positionQueries.some((query) => query.isError);
  const loading =
    marketsQuery.isLoading ||
    marketQueries.some((query) => query.isLoading) ||
    positionQueries.some((query) => query.isLoading);
  const visibleRows =
    tab === "positions" ? positions : tab === "settled" ? settled : [];
  const retryActivity = () => {
    void Promise.all([
      marketsQuery.refetch(),
      ...marketQueries.map((query) => query.refetch()),
      ...positionQueries.map((query) => query.refetch()),
    ]);
  };

  if (!address) {
    return (
      <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
        <header>
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
            <Activity className="h-4 w-4" /> Activity
          </div>
          <h1 className="mt-3 text-3xl font-semibold tracking-tight">
            Your Crown activity
          </h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Your Crown markets and positions derived from current on-chain
            contract state.
          </p>
        </header>
        <div className="surface mt-8 p-12 text-center">
          <h2 className="text-base font-semibold">Connect your wallet</h2>
          <p className="mx-auto mt-2 max-w-sm text-sm text-muted-foreground">
            Connect your wallet to view your Crown activity.
          </p>
          <Button
            className="mt-5 bg-gold text-gold-foreground hover:bg-gold/90"
            onClick={() => openConnectModal?.()}
          >
            Connect Wallet
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1000px] px-4 py-10 sm:px-6">
      <header>
        <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
          <Activity className="h-4 w-4" /> Activity
        </div>
        <h1 className="mt-3 text-3xl font-semibold tracking-tight">
          Your Crown activity
        </h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Your Crown markets and positions derived from current on-chain
          contract state.
        </p>
      </header>

      <div className="mt-6 flex items-center gap-2 rounded-lg border border-border bg-elevated/50 p-3 text-xs text-muted-foreground">
        <CheckCircle2 className="h-4 w-4 shrink-0 text-gold" />
        Activity is derived from loaded Crown markets; the contract does not
        expose a chronological wallet history.
      </div>

      <div className="mt-8 flex flex-wrap gap-1 border-b border-border">
        {(
          [
            ["positions", "Positions"],
            ["created", "Created Markets"],
            ["settled", "Settled"],
          ] as const
        ).map(([key, label]) => {
          const count =
            key === "positions"
              ? positions.length
              : key === "created"
                ? createdMarkets.length
                : settled.length;
          return (
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
              {label}{" "}
              <span className="tabular ml-1 text-xs text-muted-foreground">
                {count}
              </span>
            </button>
          );
        })}
      </div>

      {loading ? (
        <div className="surface mt-8 flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading Crown activity…
        </div>
      ) : queryError ? (
        <div className="mt-8">
          <CrownErrorState
            title="Unable to load Crown activity"
            message="We couldn't read the latest markets and positions from GenLayer Bradbury."
            onRetry={retryActivity}
          />
        </div>
      ) : tab === "created" ? (
        createdMarkets.length === 0 ? (
          <div className="surface mt-8 p-12 text-center text-sm text-muted-foreground">
            No Crown markets created by this wallet in the loaded markets.
          </div>
        ) : (
          <div className="mt-8 space-y-4">
            {createdMarkets.map((market) => (
              <CreatedMarketCard key={market.id} market={market} />
            ))}
          </div>
        )
      ) : visibleRows.length === 0 ? (
        <div className="surface mt-8 p-12 text-center text-sm text-muted-foreground">
          {tab === "settled"
            ? "No settled Crown positions in the loaded markets."
            : "No Crown positions found in the loaded markets."}
        </div>
      ) : (
        <div className="mt-8 space-y-4">
          {visibleRows.map(({ market, position }) => (
            <ActivityPositionCard
              key={market.id}
              market={market}
              position={position}
            />
          ))}
        </div>
      )}

      {marketsQuery.hasNextPage && (
        <div className="mt-8 flex justify-center">
          <Button
            variant="outline"
            disabled={marketsQuery.isFetchingNextPage}
            onClick={() => void marketsQuery.fetchNextPage()}
          >
            {marketsQuery.isFetchingNextPage ? "Loading…" : "Load More"}
          </Button>
        </div>
      )}
    </div>
  );
}
