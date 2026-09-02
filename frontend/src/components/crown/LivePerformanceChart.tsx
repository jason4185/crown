import { useQuery } from "@tanstack/react-query";
import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipProps,
} from "recharts";
import { AssetIcon } from "./AssetIcon";
import { Button } from "@/components/ui/button";
import {
  ASSETS,
  ASSET_META,
  fmtUtcFull,
  type AssetSymbol,
  type Market,
} from "@/lib/crown/presentation";
import {
  getLivePerformanceSeries,
  type LivePerformancePoint,
} from "@/lib/crown/binance-live";
import {
  ChartContainer,
  ChartTooltip,
  type ChartConfig,
} from "@/components/ui/chart";

const CHART_CONFIG = Object.fromEntries(
  ASSETS.map((asset) => [
    asset,
    { label: asset, color: ASSET_META[asset].colorVar },
  ]),
) as ChartConfig;

const CHART_STATUSES: Market["status"][] = [
  "LIVE",
  "FINALIZING",
  "SETTLEMENT_READY",
  "RESOLVED",
  "INCONCLUSIVE",
];

function formatPercent(value: number) {
  if (Object.is(value, -0)) return "0.00%";
  return `${value > 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function formatTime(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("en-US", {
    timeZone: "UTC",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

function PerformanceTooltip({
  active,
  payload,
  label,
}: TooltipProps<number, string>) {
  if (!active || !payload?.length || typeof label !== "number") return null;

  return (
    <div className="min-w-[9rem] rounded-lg border border-border/60 bg-background px-3 py-2 text-xs shadow-xl">
      <div className="mb-2 font-medium text-foreground">
        {formatTime(label)} UTC
      </div>
      <div className="grid gap-1.5">
        {ASSETS.map((asset) => {
          const item = payload.find((entry) => String(entry.dataKey) === asset);
          const value = typeof item?.value === "number" ? item.value : null;
          if (value === null || !Number.isFinite(value)) return null;
          return (
            <div key={asset} className="flex items-center gap-2">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: ASSET_META[asset].colorVar }}
              />
              <span className="text-muted-foreground">{asset}</span>
              <span className="tabular ml-auto font-medium text-foreground">
                {formatPercent(value)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function getCurrentLeader(points: LivePerformancePoint[]) {
  const latest = points.at(-1);
  if (!latest || points.length < 2) return null;

  const ranked = ASSETS.map((asset) => ({ asset, value: latest[asset] })).sort(
    (a, b) => b.value - a.value,
  );
  const leader = ranked[0];
  const runnerUp = ranked[1];
  if (
    !leader ||
    !runnerUp ||
    Math.abs(leader.value - runnerUp.value) < 0.000001
  ) {
    return null;
  }
  return leader;
}

function ChartLegend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-2">
      {ASSETS.map((asset) => (
        <div key={asset} className="flex items-center gap-1.5 text-xs">
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: ASSET_META[asset].colorVar }}
          />
          <span className="text-muted-foreground">{asset}</span>
        </div>
      ))}
    </div>
  );
}

function LoadingState() {
  return (
    <div className="mt-5 flex h-[300px] items-center justify-center rounded-lg border border-border bg-elevated/40 text-sm text-muted-foreground">
      Loading Binance performance…
    </div>
  );
}

export function LivePerformanceChart({ market }: { market: Market }) {
  const performanceStartTimestamp = Math.floor(
    new Date(market.startISO).getTime() / 1000,
  );
  const performanceEndTimestamp = Math.floor(
    new Date(market.endISO).getTime() / 1000,
  );
  const chartAvailable = CHART_STATUSES.includes(market.status);
  const isLive = market.status === "LIVE";
  const showCurrentLeader = ["LIVE", "FINALIZING", "SETTLEMENT_READY"].includes(
    market.status,
  );
  const query = useQuery({
    queryKey: [
      "binance-live-performance",
      market.id,
      performanceStartTimestamp,
      performanceEndTimestamp,
    ],
    queryFn: () =>
      getLivePerformanceSeries(
        performanceStartTimestamp,
        performanceEndTimestamp,
      ),
    enabled: chartAvailable && typeof window !== "undefined",
    retry: 1,
    staleTime: isLive ? 25_000 : Infinity,
    refetchInterval: isLive ? 30_000 : false,
    refetchIntervalInBackground: false,
  });

  const leader =
    showCurrentLeader && query.data
      ? getCurrentLeader(query.data.points)
      : null;

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-gold">
            Live Performance
          </div>
          <div className="mt-1 text-sm text-muted-foreground">
            Relative return since market open
          </div>
        </div>
        <span className="rounded-full border border-border-strong bg-elevated px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
          Binance • Informational only
        </span>
      </div>

      {market.status === "OPEN" || market.status === "LOCKED" ? (
        <div className="mt-5 rounded-lg border border-border bg-elevated/50 p-4 text-sm text-muted-foreground">
          Performance begins at {fmtUtcFull(market.startISO)}. The live race
          will appear once the Crown window starts.
        </div>
      ) : query.isPending ? (
        <LoadingState />
      ) : query.isError || !query.data ? (
        <div className="mt-5 rounded-lg border border-border bg-elevated/50 p-4 text-sm text-muted-foreground">
          <p>Live performance temporarily unavailable.</p>
          {query.isError && (
            <Button
              variant="outline"
              size="sm"
              className="mt-3 border-border-strong"
              onClick={() => void query.refetch()}
            >
              Retry
            </Button>
          )}
        </div>
      ) : (
        <>
          <div className="mt-5 flex flex-wrap items-stretch gap-3">
            {leader && (
              <div className="flex min-w-[11rem] items-center gap-3 rounded-lg border border-border bg-elevated/60 px-3 py-2.5">
                <AssetIcon asset={leader.asset} size="sm" />
                <div>
                  <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    Current Binance leader · Informational
                  </div>
                  <div className="mt-0.5 flex items-baseline gap-2">
                    <span className="text-sm font-semibold">
                      {leader.asset}
                    </span>
                    <span className="tabular text-sm text-success">
                      {formatPercent(leader.value)}
                    </span>
                  </div>
                </div>
              </div>
            )}
            {market.status === "FINALIZING" && (
              <div className="flex items-center rounded-lg border border-warning/30 bg-warning/10 px-3 py-2.5 text-xs text-warning">
                Awaiting settlement consensus
              </div>
            )}
            {market.status === "SETTLEMENT_READY" && (
              <div className="flex items-center rounded-lg border border-gold/30 bg-gold-soft px-3 py-2.5 text-xs text-gold">
                Ready for permissionless settlement
              </div>
            )}
            {market.status === "RESOLVED" && market.winner && (
              <div className="flex items-center rounded-lg border border-gold/30 bg-gold-soft px-3 py-2.5 text-xs text-gold">
                Contract winner: {market.winner}
              </div>
            )}
            {market.status === "INCONCLUSIVE" && (
              <div className="flex items-center rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2.5 text-xs text-destructive">
                Market resolved inconclusive
              </div>
            )}
          </div>

          <div className="mt-5 min-w-0">
            <ChartContainer
              config={CHART_CONFIG}
              className="h-[300px] w-full min-w-0 aspect-auto"
            >
              <LineChart
                data={query.data.points}
                margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
              >
                <CartesianGrid
                  stroke="var(--border)"
                  strokeDasharray="3 3"
                  vertical={false}
                />
                <XAxis
                  dataKey="timestamp"
                  type="number"
                  domain={[
                    performanceStartTimestamp * 1000,
                    performanceEndTimestamp * 1000,
                  ]}
                  tickFormatter={formatTime}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={24}
                />
                <YAxis
                  tickFormatter={formatPercent}
                  tick={{ fill: "var(--muted-foreground)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  width={56}
                  domain={["auto", "auto"]}
                />
                <ReferenceLine
                  y={0}
                  stroke="var(--gold)"
                  strokeDasharray="4 4"
                  strokeOpacity={0.7}
                />
                <ChartTooltip
                  cursor={{ stroke: "var(--border-strong)" }}
                  content={<PerformanceTooltip />}
                />
                {ASSETS.map((asset) => (
                  <Line
                    key={asset}
                    type="monotone"
                    dataKey={asset}
                    name={asset}
                    stroke={`var(--color-${asset})`}
                    strokeWidth={2}
                    dot={false}
                    activeDot={{ r: 3, strokeWidth: 0 }}
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ChartContainer>
            <ChartLegend />
          </div>
        </>
      )}

      <div className="mt-4 border-t border-border pt-3 text-xs text-muted-foreground">
        <p>Live performance — informational only</p>
        <p className="mt-1">
          Settlement uses native 4H candles from Binance, Bitget and Gate.
        </p>
      </div>
    </div>
  );
}
