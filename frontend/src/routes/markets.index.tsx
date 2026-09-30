import { useMemo, useState } from "react";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import { EnergyMarketCard } from "@/components/crown/EnergyMarketCard";
import { MarketCard } from "@/components/crown/MarketCard";
import {
  getMarketsPage,
  getOpenMarketsPage,
  type CrownMarket,
} from "@/lib/crown/contract";
import {
  getEnergyMarketsPage,
  getEnergyOpenMarketsPage,
  type EnergyMarket,
} from "@/lib/crown/energy";
import {
  fmtUtcDate,
  fmtUtcWindow,
  STATUS_LABEL,
} from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/markets/")({
  validateSearch: (search) => ({
    q: typeof search["q"] === "string" ? search["q"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Crown Markets — Crypto and Energy" },
      {
        name: "description",
        content:
          "Browse Crown crypto and energy markets settled by multi-source GenLayer consensus.",
      },
    ],
  }),
  component: MarketsPage,
});

const TABS = [
  { key: "all", label: "All" },
  { key: "open", label: "Open" },
  { key: "live", label: "Live" },
  { key: "ready", label: "Ready to Settle" },
  { key: "resolved", label: "Resolved" },
] as const;
type LifecycleTab = (typeof TABS)[number]["key"];
type FamilyTab = "ALL" | "CRYPTO" | "ENERGY";
type LoadedMarket = CrownMarket | EnergyMarket;

function matchesTab(status: string, tab: LifecycleTab) {
  if (tab === "all") return true;
  if (tab === "open") return status === "OPEN";
  if (tab === "live") return status === "LIVE" || status === "FINALIZING";
  if (tab === "ready") return status === "SETTLEMENT_READY";
  return status === "RESOLVED" || status === "INCONCLUSIVE";
}

function searchText(market: LoadedMarket) {
  if (market.family === "CRYPTO") {
    return [
      "crypto",
      "relative performance",
      "4h",
      ...Object.keys(market.pools),
      fmtUtcDate(market.startISO),
      fmtUtcWindow(market.startISO, market.endISO),
      market.status,
      STATUS_LABEL[market.status],
    ];
  }
  return [
    "energy",
    market.marketType,
    market.asset,
    market.durationLabel,
    String(market.durationSeconds),
    "wti",
    "brent",
    "natural gas",
    "dominance",
    "up down",
    ...Object.keys(market.pools),
    fmtUtcDate(market.startISO),
    fmtUtcWindow(market.startISO, market.endISO),
    market.status,
    STATUS_LABEL[market.status],
  ];
}

function matchesSearch(market: LoadedMarket, query: string) {
  const normalized = query.trim().toLowerCase();
  return (
    !normalized ||
    searchText(market).join(" ").toLowerCase().includes(normalized)
  );
}

function PageControls({
  count,
  hasMore,
  canPrevious,
  onPrevious,
  onNext,
}: {
  count: number;
  hasMore: boolean;
  canPrevious: boolean;
  onPrevious: () => void;
  onNext: () => void;
}) {
  return (
    <div className="mt-8 flex items-center justify-between gap-3 text-sm">
      <button
        type="button"
        onClick={onPrevious}
        disabled={!canPrevious}
        className="rounded-md border border-border bg-elevated px-3 py-2 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
      >
        Previous page
      </button>
      <span className="text-xs text-muted-foreground">
        Bounded on-chain page · {count} markets
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasMore}
        className="rounded-md border border-border bg-elevated px-3 py-2 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
      >
        Next page
      </button>
    </div>
  );
}

export function MarketsPage() {
  const [family, setFamily] = useState<FamilyTab>("ALL");
  const [tab, setTab] = useState<LifecycleTab>("all");
  const [offset, setOffset] = useState(0);
  const [offsetHistory, setOffsetHistory] = useState<number[]>([]);
  const locationSearch = useLocation({
    select: (location) => location.search,
  }) as Record<string, unknown>;
  const q = typeof locationSearch["q"] === "string" ? locationSearch["q"] : "";
  const open = tab === "open";
  const cryptoQuery = useQuery({
    queryKey: [
      "crown",
      open ? "open-markets" : "markets",
      "CRYPTO",
      offset,
      25,
    ],
    queryFn: () =>
      open ? getOpenMarketsPage(offset, 25) : getMarketsPage(offset, 25),
    enabled: family !== "ENERGY",
    staleTime: 15_000,
  });
  const energyQuery = useQuery({
    queryKey: [
      "crown",
      open ? "open-markets" : "markets",
      "ENERGY",
      offset,
      25,
    ],
    queryFn: () =>
      open
        ? getEnergyOpenMarketsPage(offset, 25)
        : getEnergyMarketsPage(offset, 25),
    enabled: family !== "CRYPTO",
    staleTime: 15_000,
  });
  const loading =
    (family !== "ENERGY" && cryptoQuery.isLoading) ||
    (family !== "CRYPTO" && energyQuery.isLoading);
  const error =
    (family !== "ENERGY" && cryptoQuery.isError) ||
    (family !== "CRYPTO" && energyQuery.isError);
  const loadedMarkets = useMemo<LoadedMarket[]>(
    () => [
      ...(family !== "ENERGY" ? (cryptoQuery.data?.markets ?? []) : []),
      ...(family !== "CRYPTO" ? (energyQuery.data?.markets ?? []) : []),
    ],
    [cryptoQuery.data, energyQuery.data, family],
  );
  const markets = loadedMarkets.filter(
    (market) => matchesTab(market.status, tab) && matchesSearch(market, q),
  );
  const hasMore =
    (family !== "ENERGY" && Boolean(cryptoQuery.data?.hasMore)) ||
    (family !== "CRYPTO" && Boolean(energyQuery.data?.hasMore));
  const retry = () => {
    if (family !== "ENERGY") void cryptoQuery.refetch();
    if (family !== "CRYPTO") void energyQuery.refetch();
  };
  const selectFamily = (next: FamilyTab) => {
    setFamily(next);
    setOffset(0);
    setOffsetHistory([]);
  };
  const selectTab = (next: LifecycleTab) => {
    setTab(next);
    setOffset(0);
    setOffsetHistory([]);
  };

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Markets</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Explore Crown crypto races and Energy markets, each settled from the
          correct deployed contract.
        </p>
        {q.trim() && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing loaded markets matching “{q.trim()}”.
          </p>
        )}
      </header>
      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {(["ALL", "CRYPTO", "ENERGY"] as const).map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => selectFamily(item)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              family === item
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item === "ALL"
              ? "All Markets"
              : item === "CRYPTO"
                ? "Crypto"
                : "Energy"}
          </button>
        ))}
      </div>
      <div className="mt-2 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => selectTab(item.key)}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              tab === item.key
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            <span className="tabular ml-2 text-xs text-muted-foreground">
              {
                loadedMarkets.filter((market) =>
                  matchesTab(market.status, item.key),
                ).length
              }
            </span>
          </button>
        ))}
      </div>
      {loading ? (
        <div className="surface mt-8 p-12 text-center text-sm text-muted-foreground">
          Loading Crown markets…
        </div>
      ) : error ? (
        <div className="mt-8">
          <CrownErrorState
            title="Unable to load Crown markets"
            message="We couldn't read the selected Crown market family from GenLayer Studio Next."
            onRetry={retry}
          />
        </div>
      ) : markets.length === 0 ? (
        <div className="surface mt-8 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {q.trim()
              ? "No loaded Crown markets match your search."
              : family === "ENERGY"
                ? "No Energy markets yet."
                : family === "CRYPTO"
                  ? "No Crypto markets yet."
                  : "No Crown markets found."}
          </p>
          {(tab === "open" || family === "ENERGY") && (
            <Link
              to="/create"
              className="mt-4 inline-flex rounded-md bg-gold px-4 py-2 text-sm font-medium text-gold-foreground hover:bg-gold/90"
            >
              Create Market
            </Link>
          )}
        </div>
      ) : (
        <>
          <div className="mt-8 grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
            {markets.map((market) =>
              market.family === "CRYPTO" ? (
                <MarketCard key={`CRYPTO:${market.id}`} market={market} />
              ) : (
                <EnergyMarketCard key={`ENERGY:${market.id}`} market={market} />
              ),
            )}
          </div>
          <PageControls
            count={loadedMarkets.length}
            hasMore={hasMore}
            canPrevious={offsetHistory.length > 0}
            onPrevious={() =>
              setOffsetHistory((history) => {
                const next = [...history];
                setOffset(next.pop() ?? 0);
                return next;
              })
            }
            onNext={() => {
              setOffsetHistory((history) => [...history, offset]);
              setOffset(
                Math.max(
                  cryptoQuery.data?.nextOffset ?? 0,
                  energyQuery.data?.nextOffset ?? 0,
                ),
              );
            }}
          />
        </>
      )}
    </div>
  );
}
