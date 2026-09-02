export type AssetSymbol = "BTC" | "ETH" | "SOL" | "BNB" | "XRP";

export const ASSETS: AssetSymbol[] = ["BTC", "ETH", "SOL", "BNB", "XRP"];

export const ASSET_META: Record<
  AssetSymbol,
  { name: string; colorVar: string; glyph: string }
> = {
  BTC: { name: "Bitcoin", colorVar: "var(--btc)", glyph: "₿" },
  ETH: { name: "Ethereum", colorVar: "var(--eth)", glyph: "Ξ" },
  SOL: { name: "Solana", colorVar: "var(--sol)", glyph: "◎" },
  BNB: { name: "BNB", colorVar: "var(--bnb)", glyph: "⬡" },
  XRP: { name: "XRP", colorVar: "var(--xrp)", glyph: "✕" },
};

export type MarketStatus =
  | "OPEN"
  | "LOCKED"
  | "LIVE"
  | "FINALIZING"
  | "SETTLEMENT_READY"
  | "RESOLVED"
  | "INCONCLUSIVE";

export const STATUS_LABEL: Record<MarketStatus, string> = {
  OPEN: "Open",
  LOCKED: "Predictions closed",
  LIVE: "Live",
  FINALIZING: "Finalizing",
  SETTLEMENT_READY: "Ready to settle",
  RESOLVED: "Resolved",
  INCONCLUSIVE: "Inconclusive",
};

export type Market = {
  id: number;
  startISO: string;
  endISO: string;
  status: MarketStatus;
  pools: Record<AssetSymbol, number>;
  winner?: AssetSymbol | null;
  creator: string;
};

export function totalPool(market: Market) {
  return ASSETS.reduce((sum, asset) => sum + market.pools[asset], 0);
}

export function poolSharePct(market: Market, asset: AssetSymbol) {
  const total = totalPool(market);
  return total === 0 ? 0 : (market.pools[asset] / total) * 100;
}

export function fmtGen(value: number, digits = 1) {
  return `${value.toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })} GEN`;
}

export function fmtUtcTime(iso: string) {
  const date = new Date(iso);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

export function fmtUtcDate(iso: string) {
  return new Date(iso).toLocaleDateString("en-US", {
    timeZone: "UTC",
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

export function fmtUtcWindow(startISO: string, endISO: string) {
  return `${fmtUtcTime(startISO)} → ${fmtUtcTime(endISO)} UTC`;
}

export function fmtUtcFull(iso: string) {
  return `${fmtUtcDate(iso)} · ${fmtUtcTime(iso)} UTC`;
}

export function fmtUtcMarketWindow(startISO: string, endISO: string) {
  return `${fmtUtcDate(startISO)} · ${fmtUtcWindow(startISO, endISO)}`;
}

export function marketTimeline(market: Pick<Market, "startISO" | "endISO">) {
  const start = new Date(market.startISO).getTime();
  const end = new Date(market.endISO).getTime();
  return {
    bettingCloses: new Date(start - 60_000).toISOString(),
    performanceStarts: market.startISO,
    performanceEnds: market.endISO,
    settlementReady: new Date(end + 60_000).toISOString(),
    retryDeadline: new Date(end + 1_860_000).toISOString(),
  };
}

export function countdown(targetISO: string, now: number) {
  const difference = new Date(targetISO).getTime() - now;
  if (difference <= 0) return "00:00:00";
  const seconds = Math.floor(difference / 1000);
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${pad(Math.floor(seconds / 3600))}:${pad(
    Math.floor((seconds % 3600) / 60),
  )}:${pad(seconds % 60)}`;
}
