import { useState } from "react";
import { createFileRoute, Link, useLocation } from "@tanstack/react-router";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import { MarketCard } from "@/components/crown/MarketCard";
import {
  getMarketsPage,
  getOpenMarketsPage,
  type CrownMarketPage,
} from "@/lib/crown/contract";
import {
  fmtUtcDate,
  fmtUtcWindow,
  STATUS_LABEL,
} from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

export const Route = createFileRoute("/markets/")({
  validateSearch: (search) => ({
    q: typeof search["q"] === "string" ? search["q"] : "",
  }),
  head: () => ({
    meta: [
      { title: "Crown Markets — 4H Crypto Relative Performance" },
      {
        name: "description",
        content:
          "Browse Crown markets across every lifecycle stage. Predict which crypto performs best over the next canonical 4-hour UTC window.",
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

function matchesTab(status: string, tab: (typeof TABS)[number]["key"]) {
  if (tab === "all") return true;
  if (tab === "open") return status === "OPEN";
  if (tab === "live") return status === "LIVE" || status === "FINALIZING";
  if (tab === "ready") return status === "SETTLEMENT_READY";
  return status === "RESOLVED" || status === "INCONCLUSIVE";
}

function emptyMessage(tab: (typeof TABS)[number]["key"]) {
  if (tab === "all") return "No Crown markets found.";
  if (tab === "open") return "No open Crown markets right now.";
  if (tab === "live") return "No Crown markets are live right now.";
  if (tab === "ready") return "No markets are ready to settle.";
  return "No resolved Crown markets found.";
}

function matchesSearch(
  market: CrownMarketPage["markets"][number],
  query: string,
) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return [
    fmtUtcDate(market.startISO),
    fmtUtcWindow(market.startISO, market.endISO),
    market.status,
    STATUS_LABEL[market.status],
  ]
    .join(" ")
    .toLowerCase()
    .includes(normalized);
}

function PageControls({
  page,
  canPrevious,
  onPrevious,
  onNext,
}: {
  page: CrownMarketPage;
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
        Bounded on-chain page · {page.marketIds.length} markets
      </span>
      <button
        type="button"
        onClick={onNext}
        disabled={!page.hasMore}
        className="rounded-md border border-border bg-elevated px-3 py-2 text-muted-foreground transition-colors hover:border-border-strong hover:text-foreground disabled:opacity-40"
      >
        Next page
      </button>
    </div>
  );
}

export function MarketsPage() {
  const [tab, setTab] = useState<(typeof TABS)[number]["key"]>("all");
  const [offset, setOffset] = useState(0);
  const [offsetHistory, setOffsetHistory] = useState<number[]>([]);
  const locationSearch = useLocation({
    select: (location) => location.search,
  }) as Record<string, unknown>;
  const q = typeof locationSearch["q"] === "string" ? locationSearch["q"] : "";
  const query = useQuery({
    queryKey: [
      "crown",
      tab === "open" ? "open-markets" : "markets",
      offset,
      25,
    ],
    queryFn: () =>
      tab === "open"
        ? getOpenMarketsPage(offset, 25)
        : getMarketsPage(offset, 25),
    staleTime: 15_000,
  });
  const page = query.data;
  const loadedMarkets = page?.markets ?? [];
  const markets = loadedMarkets.filter(
    (market) => matchesTab(market.status, tab) && matchesSearch(market, q),
  );
  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">Markets</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Predict which asset has the highest percentage return over the next
          canonical 4-hour UTC window.
        </p>
        {q.trim() && (
          <p className="mt-3 text-xs text-muted-foreground">
            Showing loaded markets matching “{q.trim()}”.
          </p>
        )}
      </header>

      <div className="mt-6 flex flex-wrap gap-1 border-b border-border">
        {TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => {
              setTab(item.key);
              setOffset(0);
              setOffsetHistory([]);
            }}
            className={cn(
              "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
              tab === item.key
                ? "border-gold text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground",
            )}
          >
            {item.label}
            {page && (
              <span className="tabular ml-2 text-xs text-muted-foreground">
                {
                  page.markets.filter((market) =>
                    matchesTab(market.status, item.key),
                  ).length
                }
              </span>
            )}
          </button>
        ))}
      </div>

      {query.isLoading ? (
        <div className="surface mt-8 p-12 text-center text-sm text-muted-foreground">
          Loading Crown markets…
        </div>
      ) : query.isError ? (
        <div className="mt-8">
          <CrownErrorState
            title="Unable to load Crown markets"
            message="We couldn't read the latest markets from GenLayer Bradbury."
            onRetry={() => void query.refetch()}
          />
        </div>
      ) : markets.length === 0 ? (
        <div className="surface mt-8 p-12 text-center">
          <p className="text-sm text-muted-foreground">
            {q.trim()
              ? "No loaded Crown markets match your search."
              : emptyMessage(tab)}
          </p>
          {tab === "open" && (
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
            {markets.map((market) => (
              <MarketCard key={market.id} market={market} />
            ))}
          </div>
          {page && (
            <PageControls
              page={page}
              canPrevious={offsetHistory.length > 0}
              onPrevious={() => {
                setOffsetHistory((history) => {
                  const next = [...history];
                  setOffset(next.pop() ?? 0);
                  return next;
                });
              }}
              onNext={() => {
                setOffsetHistory((history) => [...history, offset]);
                setOffset(page.nextOffset);
              }}
            />
          )}
        </>
      )}
    </div>
  );
}
