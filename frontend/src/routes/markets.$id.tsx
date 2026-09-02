import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { useAccount } from "wagmi";
import { Check, Crown, HelpCircle, X } from "lucide-react";
import { AssetIcon } from "@/components/crown/AssetIcon";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import { StatusBadge } from "@/components/crown/StatusBadge";
import { ActionPanel } from "@/components/crown/ActionPanel";
import { LivePerformanceChart } from "@/components/crown/LivePerformanceChart";
import {
  ASSETS,
  fmtGen,
  fmtUtcFull,
  fmtUtcMarketWindow,
  poolSharePct,
  totalPool,
  type Market,
} from "@/lib/crown/presentation";
import {
  getMarket,
  formatCrownGen,
  getResolution,
  getUserPosition,
  type CrownMarket,
  type CrownResolution,
} from "@/lib/crown/contract";
import { isCrownMarketNotFound } from "@/lib/crown/errors";

export const Route = createFileRoute("/markets/$id")({
  head: ({ params }) => ({
    meta: [
      { title: "Crown Market — Which crypto takes the Crown?" },
      {
        name: "description",
        content:
          "A Crown market for relative performance across BTC, ETH, SOL, BNB and XRP over an exact 4-hour UTC window.",
      },
      {
        property: "og:title",
        content: "Crown — 4H crypto relative-performance market",
      },
      {
        property: "og:description",
        content:
          "Stake 1–10 GEN on one asset. 2-of-3 exchange consensus resolves the winner.",
      },
    ],
  }),
  component: MarketDetail,
});

function Section({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section className="surface p-5">
      <h2 className="text-sm font-semibold">{title}</h2>
      <div className="mt-4">{children}</div>
    </section>
  );
}

function PoolComposition({ market }: { market: Market }) {
  const total = totalPool(market);
  return (
    <div className="space-y-3">
      {ASSETS.map((a) => {
        const share = poolSharePct(market, a);
        const isWinner = market.winner === a;
        return (
          <div key={a}>
            <div className="flex items-center gap-3">
              <AssetIcon asset={a} size="sm" />
              <span className="text-sm font-medium">{a}</span>
              {isWinner && (
                <span className="text-[10px] font-semibold uppercase tracking-wider text-gold">
                  Crown
                </span>
              )}
              <span className="tabular ml-auto text-sm">
                {fmtGen(market.pools[a])}
              </span>
              <span className="tabular w-24 text-right text-xs text-muted-foreground">
                {share.toFixed(1)}% of pool
              </span>
            </div>
            <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-elevated">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${share}%`,
                  backgroundColor: `var(--${a.toLowerCase()})`,
                }}
              />
            </div>
          </div>
        );
      })}
      <p className="pt-1 text-xs text-muted-foreground">
        Pool share, not probability. Bars show how staked GEN is distributed —
        total pool{" "}
        <span className="tabular text-foreground">{fmtGen(total)}</span>.
      </p>
    </div>
  );
}

function Timeline({ market }: { market: CrownMarket }) {
  const timestamp = (value: bigint) =>
    new Date(Number(value) * 1000).toISOString();
  const steps = [
    {
      label: "Betting closes",
      iso: timestamp(market.onchain.bettingCloseTimestamp),
    },
    {
      label: "Performance starts",
      iso: timestamp(market.onchain.performanceStartTimestamp),
    },
    {
      label: "Performance ends",
      iso: timestamp(market.onchain.performanceEndTimestamp),
    },
    {
      label: "Settlement ready",
      iso: timestamp(market.onchain.settlementReadyTimestamp),
    },
    {
      label: "Retry deadline",
      iso: timestamp(market.onchain.settlementRetryDeadline),
    },
  ];
  return (
    <ol className="relative space-y-4 border-l border-border pl-5">
      {steps.map((s) => (
        <li key={s.label} className="relative">
          <span className="absolute -left-[26px] top-1.5 h-2.5 w-2.5 rounded-full border border-border-strong bg-elevated" />
          <div className="text-sm font-medium">{s.label}</div>
          <div className="tabular text-xs text-muted-foreground">
            {fmtUtcFull(s.iso)}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Settlement({
  market,
  resolution,
  loading,
  error,
  onRetry,
}: {
  market: CrownMarket;
  resolution?: CrownResolution | undefined;
  loading: boolean;
  error: boolean;
  onRetry: () => void;
}) {
  const sources = resolution
    ? [
        {
          source: "Binance",
          state: resolution.binanceStatus,
          winner: resolution.binanceWinner,
        },
        {
          source: "Bitget",
          state: resolution.bitgetStatus,
          winner: resolution.bitgetWinner,
        },
        {
          source: "Gate",
          state: resolution.gateStatus,
          winner: resolution.gateWinner,
        },
      ]
    : [];
  return (
    <div>
      <div className="space-y-2">
        {loading && (
          <p className="text-sm text-muted-foreground">
            Loading settlement evidence…
          </p>
        )}
        {!loading && error && (
          <CrownErrorState
            title="Unable to load settlement details"
            message="We couldn't read the latest source consensus."
            onRetry={onRetry}
          />
        )}
        {!loading && !error && !resolution && (
          <p className="text-sm text-muted-foreground">
            Settlement details are not available yet.
          </p>
        )}
        {!error &&
          sources.map((s) => (
            <div
              key={s.source}
              className="flex items-center gap-3 rounded-lg border border-border bg-elevated px-3 py-2.5"
            >
              <span className="text-sm font-medium">{s.source}</span>
              <span
                className={
                  s.state === "VALID"
                    ? "rounded border border-success/35 bg-success/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-success"
                    : s.state === "UNAVAILABLE"
                      ? "rounded border border-destructive/35 bg-destructive/10 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-destructive"
                      : "rounded border border-border-strong px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground"
                }
              >
                {s.state}
              </span>
              <span className="ml-auto flex items-center gap-2 text-sm">
                {s.winner ? (
                  <>
                    <AssetIcon asset={s.winner} size="sm" />
                    {s.winner}
                  </>
                ) : (
                  <span className="text-muted-foreground">—</span>
                )}
              </span>
            </div>
          ))}
      </div>
      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-4 text-sm">
        <span className="text-muted-foreground">
          At least 2 of 3 valid sources
        </span>
        <span className="ml-auto flex items-center gap-2">
          {!error &&
            ((resolution?.finalWinner ?? market.winner) ? (
              <>
                <Check className="h-4 w-4 text-gold" />
                <span className="text-muted-foreground">Contract winner</span>
                <span className="font-semibold text-gold">
                  {resolution?.finalWinner ?? market.winner}
                </span>
                <span className="tabular text-muted-foreground">
                  · Consensus{" "}
                  {resolution?.consensusCount ??
                    market.onchain.consensusCount.toString()}
                  /3
                </span>
              </>
            ) : market.status === "INCONCLUSIVE" ? (
              <>
                <X className="h-4 w-4 text-destructive" />
                <span className="text-muted-foreground">
                  No consensus — INCONCLUSIVE
                </span>
              </>
            ) : (
              <span className="text-muted-foreground">
                Settlement is still pending and may be retried.
              </span>
            ))}
        </span>
      </div>
    </div>
  );
}

const RULES = [
  "The market covers an exact canonical 4-hour UTC window. Entry closes before the performance window starts.",
  "Return for each asset is calculated as (Close − Open) / Open using the exact native 4H candle.",
  "Binance, Bitget and Gate each independently determine the asset with the highest % return.",
  "At least 2 of 3 valid source results must agree on the same asset for the market to resolve.",
  "A temporary source outage may leave the market unresolved during the retry window; settlement can be retried by anyone.",
  "If consensus is not reached by the retry deadline the market becomes INCONCLUSIVE and every user self-claims their original stake as a refund.",
  "Winners and refunds are claimed directly by the same wallet that owns the position.",
  "If the consensus-winning asset has a zero-GEN pool, the market becomes INCONCLUSIVE and all stakes are refundable.",
];

type MarketView = "performance" | "pool";

function defaultMarketView(status: Market["status"]): MarketView {
  return [
    "LIVE",
    "FINALIZING",
    "SETTLEMENT_READY",
    "RESOLVED",
    "INCONCLUSIVE",
  ].includes(status)
    ? "performance"
    : "pool";
}

function MarketViews({ market }: { market: Market }) {
  const initialView = defaultMarketView(market.status);
  const [view, setView] = useState<MarketView>(initialView);

  useEffect(() => {
    setView(initialView);
  }, [initialView, market.id]);

  return (
    <section className="surface p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Market view</h2>
        <div
          className="flex rounded-lg border border-border bg-elevated p-1"
          role="tablist"
          aria-label="Market data view"
        >
          {(
            [
              ["performance", "Live Performance"],
              ["pool", "Pool Composition"],
            ] as const
          ).map(([value, label]) => (
            <button
              key={value}
              type="button"
              role="tab"
              aria-selected={view === value}
              onClick={() => setView(value)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${
                view === value
                  ? "bg-card text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mt-5">
        {view === "performance" ? (
          <LivePerformanceChart market={market} />
        ) : (
          <PoolComposition market={market} />
        )}
      </div>
    </section>
  );
}

function MarketDetail() {
  const { id } = Route.useParams();
  const navigate = Route.useNavigate();
  const marketId = Number(id);
  const { address } = useAccount();
  const marketQuery = useQuery({
    queryKey: ["crown", "market", marketId],
    queryFn: () => getMarket(marketId),
    staleTime: 10_000,
  });
  const market = marketQuery.data;
  const positionQuery = useQuery({
    queryKey: ["crown", "position", marketId, address],
    queryFn: () => getUserPosition(marketId, address!),
    enabled: Boolean(address && market),
    staleTime: 10_000,
  });
  const resolutionQuery = useQuery({
    queryKey: ["crown", "resolution", marketId],
    queryFn: () => getResolution(marketId),
    enabled: Boolean(market),
    staleTime: 10_000,
  });

  if (marketQuery.isLoading) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center text-sm text-muted-foreground">
        Loading Crown market…
      </div>
    );
  }

  if (marketQuery.isError || !market) {
    const notFound =
      !marketQuery.isError || isCrownMarketNotFound(marketQuery.error);
    return (
      <div className="mx-auto max-w-3xl px-4 py-24 text-center">
        <CrownErrorState
          title={notFound ? "Market not found" : "Unable to load this market"}
          message={
            notFound
              ? "This Crown market could not be found on the connected network."
              : "We couldn't read the latest market state from GenLayer Bradbury."
          }
          onRetry={!notFound ? () => void marketQuery.refetch() : undefined}
          onSecondary={() =>
            void navigate({ to: "/markets", search: { q: "" } })
          }
          secondaryLabel="Back to Markets"
        />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1400px] px-4 py-10 sm:px-6">
      <nav className="text-xs text-muted-foreground">
        <Link
          to="/markets"
          search={{ q: "" }}
          className="hover:text-foreground"
        >
          Crypto
        </Link>{" "}
        · Crown · 4 Hour
      </nav>

      <div className="mt-3 flex flex-wrap items-start gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-2xl font-semibold tracking-tight sm:text-3xl">
            <Crown className="h-6 w-6 text-gold" />
            Which crypto takes the Crown?
          </h1>
          <div className="tabular mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="text-foreground">
              {fmtUtcMarketWindow(market.startISO, market.endISO)}
            </span>
            <span>·</span>
            <span>
              Total pool{" "}
              <span className="text-foreground">
                {formatCrownGen(market.onchain.totalPool)}
              </span>
            </span>
          </div>
        </div>
        <div className="ml-auto">
          <StatusBadge status={market.status} />
        </div>
      </div>

      <div className="mt-8 grid gap-6 lg:grid-cols-[1fr_380px]">
        <div className="space-y-6">
          <MarketViews market={market} />

          <Section title="Timeline (UTC)">
            <Timeline market={market} />
          </Section>

          <Section title="Settlement">
            <Settlement
              market={market}
              resolution={resolutionQuery.data}
              loading={resolutionQuery.isLoading}
              error={resolutionQuery.isError}
              onRetry={() => void resolutionQuery.refetch()}
            />
          </Section>

          <Section title="Rules">
            <ul className="space-y-2.5">
              {RULES.map((r) => (
                <li
                  key={r}
                  className="flex gap-2.5 text-sm text-muted-foreground"
                >
                  <HelpCircle className="mt-0.5 h-4 w-4 shrink-0 text-gold/70" />
                  <span>{r}</span>
                </li>
              ))}
            </ul>
          </Section>
        </div>

        <aside className="lg:sticky lg:top-24 lg:self-start">
          <ActionPanel
            market={market as CrownMarket}
            position={positionQuery.data ?? null}
            positionLoading={positionQuery.isLoading}
            positionError={positionQuery.isError}
            onRetryPosition={() => void positionQuery.refetch()}
          />
        </aside>
      </div>
    </div>
  );
}
