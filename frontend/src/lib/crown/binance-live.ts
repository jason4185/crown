import { ASSETS, type AssetSymbol } from "./presentation";

const BINANCE_API = "https://api.binance.com";
const NATIVE_INTERVAL = "4h";
const PROGRESSION_INTERVAL = "5m";
const CANDLE_SECONDS = 4 * 60 * 60;
const FIVE_MINUTE_SECONDS = 5 * 60;
const MAX_PROGRESSION_POINTS = CANDLE_SECONDS / FIVE_MINUTE_SECONDS;

type BinanceKline = unknown[];

export type LivePerformancePoint = {
  timestamp: number;
} & Record<AssetSymbol, number>;

export type LivePerformanceSeries = {
  points: LivePerformancePoint[];
  baselinePrices: Record<AssetSymbol, number>;
};

function assertCrownWindow(
  performanceStartTimestamp: number,
  performanceEndTimestamp: number,
) {
  if (
    !Number.isSafeInteger(performanceStartTimestamp) ||
    !Number.isSafeInteger(performanceEndTimestamp) ||
    performanceStartTimestamp < 0 ||
    performanceEndTimestamp - performanceStartTimestamp !== CANDLE_SECONDS ||
    performanceStartTimestamp % CANDLE_SECONDS !== 0
  ) {
    throw new Error("Invalid Crown 4H performance window.");
  }
}

function parseTimestamp(value: unknown, label: string) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`Binance ${label} timestamp is malformed.`);
  }
  const timestamp = Number(value);
  if (!Number.isSafeInteger(timestamp) || timestamp < 0) {
    throw new Error(`Binance ${label} timestamp is malformed.`);
  }
  return timestamp;
}

function parsePositivePrice(value: unknown, label: string) {
  if (typeof value !== "number" && typeof value !== "string") {
    throw new Error(`Binance ${label} price is malformed.`);
  }
  const price = Number(value);
  if (!Number.isFinite(price) || price <= 0) {
    throw new Error(`Binance ${label} price is invalid.`);
  }
  return price;
}

async function fetchKlines(
  params: Record<string, string>,
): Promise<BinanceKline[]> {
  const url = new URL("/api/v3/klines", BINANCE_API);
  Object.entries(params).forEach(([key, value]) => {
    url.searchParams.set(key, value);
  });

  const response = await fetch(url, {
    headers: { Accept: "application/json" },
  });
  if (!response.ok) {
    throw new Error(`Binance returned HTTP ${response.status}.`);
  }

  const payload: unknown = await response.json();
  if (!Array.isArray(payload) || !payload.every(Array.isArray)) {
    throw new Error("Binance returned a malformed candle response.");
  }
  return payload as BinanceKline[];
}

async function fetchBaseline(
  asset: AssetSymbol,
  performanceStartTimestamp: number,
  performanceEndTimestamp: number,
) {
  const startMs = performanceStartTimestamp * 1000;
  const endMs = performanceEndTimestamp * 1000;
  const rows = await fetchKlines({
    symbol: `${asset}USDT`,
    interval: NATIVE_INTERVAL,
    timeZone: "0",
    startTime: String(startMs),
    endTime: String(endMs - 1),
    limit: "1",
  });

  const row = rows[0];
  if (!row || row.length < 6) {
    throw new Error(`Binance returned no valid 4H baseline for ${asset}.`);
  }

  const returnedTimestamp = parseTimestamp(row[0], `${asset} baseline`);
  if (returnedTimestamp !== startMs) {
    throw new Error(`Binance ${asset} baseline is outside the Crown window.`);
  }

  return parsePositivePrice(row[1], `${asset} baseline open`);
}

async function fetchProgression(
  asset: AssetSymbol,
  performanceStartTimestamp: number,
  performanceEndTimestamp: number,
) {
  const startMs = performanceStartTimestamp * 1000;
  const endMs = performanceEndTimestamp * 1000;
  const rows = await fetchKlines({
    symbol: `${asset}USDT`,
    interval: PROGRESSION_INTERVAL,
    timeZone: "0",
    startTime: String(startMs),
    endTime: String(endMs - 1),
    limit: String(MAX_PROGRESSION_POINTS),
  });

  const candles = new Map<number, number>();
  let previousTimestamp = -1;
  for (const row of rows) {
    if (row.length < 6) {
      throw new Error(`Binance returned a malformed 5m candle for ${asset}.`);
    }
    const timestamp = parseTimestamp(row[0], `${asset} 5m`);
    if (
      timestamp < startMs ||
      timestamp >= endMs ||
      timestamp % (FIVE_MINUTE_SECONDS * 1000) !== 0 ||
      timestamp <= previousTimestamp ||
      candles.has(timestamp)
    ) {
      throw new Error(`Binance returned an invalid 5m window for ${asset}.`);
    }
    previousTimestamp = timestamp;
    candles.set(timestamp, parsePositivePrice(row[4], `${asset} 5m close`));
  }

  return candles;
}

function commonTimestamps(
  candlesByAsset: Record<AssetSymbol, Map<number, number>>,
) {
  const firstAsset = ASSETS[0];
  if (!firstAsset) return [];

  const timestamps = new Set(candlesByAsset[firstAsset].keys());
  for (const asset of ASSETS.slice(1)) {
    for (const timestamp of timestamps) {
      if (!candlesByAsset[asset].has(timestamp)) {
        timestamps.delete(timestamp);
      }
    }
  }
  return [...timestamps].sort((a, b) => a - b);
}

export async function getLivePerformanceSeries(
  performanceStartTimestamp: number,
  performanceEndTimestamp: number,
): Promise<LivePerformanceSeries> {
  assertCrownWindow(performanceStartTimestamp, performanceEndTimestamp);

  const baselineEntries = await Promise.all(
    ASSETS.map(
      async (asset) =>
        [
          asset,
          await fetchBaseline(
            asset,
            performanceStartTimestamp,
            performanceEndTimestamp,
          ),
        ] as const,
    ),
  );
  const baselinePrices = Object.fromEntries(baselineEntries) as Record<
    AssetSymbol,
    number
  >;

  const progressionEntries = await Promise.all(
    ASSETS.map(
      async (asset) =>
        [
          asset,
          await fetchProgression(
            asset,
            performanceStartTimestamp,
            performanceEndTimestamp,
          ),
        ] as const,
    ),
  );
  const candlesByAsset = Object.fromEntries(progressionEntries) as Record<
    AssetSymbol,
    Map<number, number>
  >;
  const startMs = performanceStartTimestamp * 1000;
  const timestamps = commonTimestamps(candlesByAsset).filter(
    (timestamp) => timestamp > startMs,
  );

  const points: LivePerformancePoint[] = [
    {
      timestamp: startMs,
      BTC: 0,
      ETH: 0,
      SOL: 0,
      BNB: 0,
      XRP: 0,
    },
    ...timestamps.map((timestamp) => {
      const point = { timestamp } as LivePerformancePoint;
      for (const asset of ASSETS) {
        const close = candlesByAsset[asset].get(timestamp);
        if (close === undefined) {
          throw new Error(`Binance data is incomplete for ${asset}.`);
        }
        const baseline = baselinePrices[asset];
        const returnPct = ((close - baseline) / baseline) * 100;
        if (!Number.isFinite(returnPct)) {
          throw new Error(`Binance return is invalid for ${asset}.`);
        }
        point[asset] = returnPct;
      }
      return point;
    }),
  ];

  return { points, baselinePrices };
}
