import { createClient } from "genlayer-js";
import { CalldataAddress, TransactionHashVariant } from "genlayer-js/types";
import type { SubmitInput } from "@genlayer/transaction-kit";
import { formatUnits, getAddress, isAddress, type Address } from "viem";
import type { MarketStatus } from "./presentation";
import {
  crownEnergyTransaction,
  formatCrownGen,
  nativeValueFromGen,
  parseCrownGen,
  type CrownReadState,
  type CrownTransactionRequest,
} from "./contract";
import { GENLAYER_CHAIN, requireCrownEnergyContractAddress } from "./config";

export const ENERGY_ASSETS = [
  "WTI_CRUDE",
  "BRENT_CRUDE",
  "NATURAL_GAS",
] as const;
export type EnergyAsset = (typeof ENERGY_ASSETS)[number];
export type EnergyMarketType = "UP_DOWN" | "DOMINANCE";
export type EnergyOutcome = EnergyAsset | "UP" | "DOWN";

export const ENERGY_DURATION_SECONDS = { "1H": 3600, "2H": 7200 } as const;
export type EnergyDurationLabel = keyof typeof ENERGY_DURATION_SECONDS;

type RawRecord = Record<string, unknown> & {
  state?: unknown;
  market_start?: unknown;
  market_end?: unknown;
  settlement_available?: unknown;
  market_id?: unknown;
  market_type?: unknown;
  duration_seconds?: unknown;
  asset?: unknown;
  reason?: unknown;
  winner?: unknown;
  settlement_deadline?: unknown;
  betting_open?: unknown;
  retry_window_active?: unknown;
  deadline_expired?: unknown;
  outcome_pools?: unknown;
  total_pool?: unknown;
  winning_pool?: unknown;
  claimed_pool?: unknown;
  remaining_pool?: unknown;
  evidence_available?: unknown;
  supported_assets?: unknown;
  market_types?: unknown;
  durations?: unknown;
  sources?: unknown;
  minimum_bet?: unknown;
  maximum_bet_per_wallet_per_market?: unknown;
  settlement_retry_window_seconds?: unknown;
  consensus_threshold?: unknown;
  markets?: unknown;
  market_ids?: unknown;
  next_offset?: unknown;
  has_more?: unknown;
  scanned_count?: unknown;
  selected_outcome?: unknown;
  selected_outcome_id?: unknown;
  market_state?: unknown;
  stake?: unknown;
  remaining_capacity?: unknown;
  can_top_up?: unknown;
  position_won?: unknown;
  position_lost?: unknown;
  claim_available?: unknown;
  refund_available?: unknown;
  claimed?: unknown;
  refunded?: unknown;
  claimable_amount?: unknown;
  source_winner?: unknown;
  source?: unknown;
  source_status?: unknown;
};

export type EnergyConfig = {
  minimumBet: bigint;
  maximumBetPerWalletPerMarket: bigint;
  retryWindowSeconds: number;
  sources: string[];
  assets: EnergyAsset[];
  marketTypes: EnergyMarketType[];
  durations: Record<EnergyDurationLabel, number>;
  consensusThreshold: number;
};

export type EnergyOnchainMarket = {
  marketId: bigint;
  marketType: EnergyMarketType;
  asset: EnergyAsset | "ENERGY";
  startTimestamp: bigint;
  endTimestamp: bigint;
  durationSeconds: bigint;
  state: string;
  reason: string;
  winner: string | null;
  settlementDeadline: bigint;
  bettingOpen: boolean;
  settlementAvailable: boolean;
  retryWindowActive: boolean;
  deadlineExpired: boolean;
  outcomePools: Record<string, bigint>;
  totalPool: bigint;
  winningPool: bigint;
  claimedPool: bigint;
  remainingPool: bigint;
  evidenceAvailable: boolean;
};

export type EnergyMarket = {
  family: "ENERGY";
  id: number;
  marketType: EnergyMarketType;
  asset: EnergyAsset | "ENERGY";
  durationSeconds: number;
  durationLabel: EnergyDurationLabel;
  startISO: string;
  endISO: string;
  status: MarketStatus;
  pools: Record<string, number>;
  winner: string | null;
  creator: string;
  onchain: EnergyOnchainMarket;
};

export type EnergyMarketPage = {
  markets: EnergyMarket[];
  marketIds: number[];
  nextOffset: number;
  hasMore: boolean;
  scannedCount?: number;
};

export type EnergyPosition = {
  hasPosition: boolean;
  marketState: string;
  marketType: EnergyMarketType;
  asset: EnergyAsset | "ENERGY";
  selectedOutcome: string | null;
  stake: bigint;
  remainingCapacity: bigint;
  canTopUp: boolean;
  winner: string | null;
  positionWon: boolean;
  positionLost: boolean;
  claimAvailable: boolean;
  refundAvailable: boolean;
  claimed: boolean;
  refunded: boolean;
  claimableAmount: bigint;
};

export type EnergySourceEvidence = {
  source: string;
  status: string;
  winner: string | null;
};

export type EnergySettlementEvidence = {
  marketId: number;
  marketType: EnergyMarketType;
  asset: EnergyAsset | "ENERGY";
  winner: string | null;
  sources: EnergySourceEvidence[];
};

function record(value: unknown, label: string): RawRecord {
  const parsed =
    typeof value === "string"
      ? (() => {
          try {
            return JSON.parse(value) as unknown;
          } catch {
            throw new Error(`${label} returned invalid JSON`);
          }
        })()
      : value;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${label} returned an invalid response`);
  }
  return parsed as RawRecord;
}

function required(value: unknown, field: string): unknown {
  if (value === undefined || value === null) {
    throw new Error(`Crown Energy response is missing ${field}`);
  }
  return value;
}

function text(value: unknown, field: string) {
  return String(required(value, field));
}

function bigintValue(value: unknown, field: string) {
  try {
    return typeof value === "bigint"
      ? value
      : BigInt(required(value, field) as string | number);
  } catch {
    throw new Error(`Crown Energy response field ${field} is not an integer`);
  }
}

function safeNumber(value: unknown, field: string) {
  const result = bigintValue(value, field);
  const number = Number(result);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Crown Energy response field ${field} exceeds safe range`);
  }
  return number;
}

function bool(value: unknown, field: string) {
  const result = required(value, field);
  if (typeof result !== "boolean") {
    throw new Error(`Crown Energy response field ${field} is not boolean`);
  }
  return result;
}

function asset(value: unknown, field: string, allowEnergy = false) {
  const result = text(value, field);
  if (allowEnergy && result === "ENERGY") return "ENERGY" as const;
  if (!ENERGY_ASSETS.includes(result as EnergyAsset)) {
    throw new Error(`Unsupported Energy asset in ${field}`);
  }
  return result as EnergyAsset;
}

function marketType(value: unknown): EnergyMarketType {
  const result = text(value, "market_type");
  if (result !== "UP_DOWN" && result !== "DOMINANCE") {
    throw new Error(`Unsupported Energy market type ${result}`);
  }
  return result;
}

function iso(seconds: bigint, field: string) {
  const value = new Date(safeNumber(seconds, field) * 1000);
  if (Number.isNaN(value.getTime())) throw new Error(`Invalid ${field}`);
  return value.toISOString();
}

function statusFor(recordValue: RawRecord): MarketStatus {
  const state = text(recordValue.state, "state");
  if (state === "RESOLVED") return "RESOLVED";
  if (state === "INCONCLUSIVE") return "INCONCLUSIVE";
  const now = Math.floor(Date.now() / 1000);
  const start = safeNumber(recordValue.market_start, "market_start");
  const end = safeNumber(recordValue.market_end, "market_end");
  if (state === "OPEN" && now < start) return "OPEN";
  if (now < end) return now < start ? "OPEN" : "LIVE";
  if (bool(recordValue.settlement_available, "settlement_available")) {
    return "SETTLEMENT_READY";
  }
  return "FINALIZING";
}

function durationLabel(seconds: number): EnergyDurationLabel {
  if (seconds === 3600) return "1H";
  if (seconds === 7200) return "2H";
  throw new Error(`Unsupported Energy duration ${seconds}`);
}

function pools(value: unknown) {
  const source = record(value, "outcome_pools");
  const result: Record<string, bigint> = {};
  for (const [key, item] of Object.entries(source)) {
    result[key] = bigintValue(item, `outcome_pools.${key}`);
  }
  return result;
}

function normalizeMarket(value: unknown): EnergyMarket {
  const item = record(value, "get_market");
  const id = bigintValue(item.market_id, "market_id");
  const type = marketType(item.market_type);
  const duration = safeNumber(item.duration_seconds, "duration_seconds");
  const onchain: EnergyOnchainMarket = {
    marketId: id,
    marketType: type,
    asset: asset(item.asset, "asset", true),
    startTimestamp: bigintValue(item.market_start, "market_start"),
    endTimestamp: bigintValue(item.market_end, "market_end"),
    durationSeconds: BigInt(duration),
    state: text(item.state, "state"),
    reason: text(item.reason, "reason"),
    winner: text(item.winner, "winner") || null,
    settlementDeadline: bigintValue(
      item.settlement_deadline,
      "settlement_deadline",
    ),
    bettingOpen: bool(item.betting_open, "betting_open"),
    settlementAvailable: bool(
      item.settlement_available,
      "settlement_available",
    ),
    retryWindowActive: bool(item.retry_window_active, "retry_window_active"),
    deadlineExpired: bool(item.deadline_expired, "deadline_expired"),
    outcomePools: pools(item.outcome_pools),
    totalPool: bigintValue(item.total_pool, "total_pool"),
    winningPool: bigintValue(item.winning_pool, "winning_pool"),
    claimedPool: bigintValue(item.claimed_pool, "claimed_pool"),
    remainingPool: bigintValue(item.remaining_pool, "remaining_pool"),
    evidenceAvailable: bool(item.evidence_available, "evidence_available"),
  };
  return {
    family: "ENERGY",
    id: safeNumber(id, "market_id"),
    marketType: type,
    asset: onchain.asset,
    durationSeconds: duration,
    durationLabel: durationLabel(duration),
    startISO: iso(onchain.startTimestamp, "market_start"),
    endISO: iso(onchain.endTimestamp, "market_end"),
    status: statusFor(item),
    pools: Object.fromEntries(
      Object.entries(onchain.outcomePools).map(([key, pool]) => [
        key,
        Number(formatUnits(pool, 18)),
      ]),
    ),
    winner: onchain.winner,
    creator: "",
    onchain,
  };
}

function createReadClient() {
  return createClient({ chain: GENLAYER_CHAIN } as Parameters<
    typeof createClient
  >[0]);
}

async function read(
  functionName: string,
  args: unknown[] = [],
  state: CrownReadState = "accepted",
) {
  return createReadClient().readContract({
    address: requireCrownEnergyContractAddress(),
    functionName,
    args: args as never,
    transactionHashVariant:
      state === "finalized"
        ? TransactionHashVariant.LATEST_FINAL
        : TransactionHashVariant.LATEST_NONFINAL,
  });
}

function calldataAddress(address: Address): CalldataAddress {
  const hex = getAddress(address).slice(2);
  const bytes = new Uint8Array(20);
  for (let index = 0; index < 20; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return new CalldataAddress(bytes);
}

export async function getEnergyConfig(): Promise<EnergyConfig> {
  const item = record(await read("get_config"), "get_config");
  const assets = required(item.supported_assets, "supported_assets");
  const types = required(item.market_types, "market_types");
  const durations = record(item.durations, "durations");
  const sources = required(item.sources, "sources");
  if (
    !Array.isArray(assets) ||
    !Array.isArray(types) ||
    !Array.isArray(sources)
  ) {
    throw new Error("Crown Energy config contains invalid arrays");
  }
  const normalizedAssets = assets.map((value) =>
    asset(value, "supported_assets"),
  );
  if (normalizedAssets.some((value) => value === "ENERGY")) {
    throw new Error("Crown Energy config contains an invalid asset");
  }
  return {
    minimumBet: bigintValue(item.minimum_bet, "minimum_bet"),
    maximumBetPerWalletPerMarket: bigintValue(
      item.maximum_bet_per_wallet_per_market,
      "maximum_bet_per_wallet_per_market",
    ),
    retryWindowSeconds: safeNumber(
      item.settlement_retry_window_seconds,
      "settlement_retry_window_seconds",
    ),
    sources: sources.map((source) => text(source, "source")),
    assets: normalizedAssets as EnergyAsset[],
    marketTypes: types.map((value) => marketType(value)),
    durations: {
      "1H": safeNumber(durations["1H"], "durations.1H"),
      "2H": safeNumber(durations["2H"], "durations.2H"),
    },
    consensusThreshold: safeNumber(
      item.consensus_threshold,
      "consensus_threshold",
    ),
  };
}

export async function getEnergyMarketCount() {
  return safeNumber(await read("get_market_count"), "market_count");
}

export async function getEnergySupportedAssets() {
  return (await read("get_supported_assets")) as string[];
}

export async function getEnergyMarketTypes() {
  return (await read("get_market_types")) as string[];
}

export async function getEnergyDurations() {
  return (await read("get_durations")) as Record<string, number>;
}

async function getEnergyPage(
  functionName: "get_markets" | "get_open_markets",
  offset = 0,
  limit = 25,
): Promise<EnergyMarketPage> {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid Energy market offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Energy market page limit must be between 1 and 25");
  }
  const item = record(
    await read(functionName, [BigInt(offset), BigInt(limit)]),
    functionName,
  );
  const rawMarkets = required(item.markets, "markets");
  const rawIds = required(item.market_ids, "market_ids");
  if (!Array.isArray(rawMarkets) || !Array.isArray(rawIds)) {
    throw new Error("Crown Energy page contains invalid arrays");
  }
  return {
    markets: rawMarkets.map(normalizeMarket),
    marketIds: rawIds.map((value) => safeNumber(value, "market_id")),
    nextOffset: safeNumber(item.next_offset, "next_offset"),
    hasMore: bool(item.has_more, "has_more"),
    ...(functionName === "get_open_markets"
      ? { scannedCount: safeNumber(item.scanned_count, "scanned_count") }
      : {}),
  };
}

export function getEnergyMarketsPage(offset = 0, limit = 25) {
  return getEnergyPage("get_markets", offset, limit);
}

export function getEnergyOpenMarketsPage(offset = 0, limit = 25) {
  return getEnergyPage("get_open_markets", offset, limit);
}

export function getEnergyMarket(marketId: number) {
  if (!Number.isSafeInteger(marketId) || marketId < 1) {
    throw new Error("Invalid Energy market ID");
  }
  return read("get_market", [BigInt(marketId)]).then(normalizeMarket);
}

function normalizePosition(value: unknown): EnergyPosition {
  const item = record(value, "get_position");
  const selected = text(item.selected_outcome, "selected_outcome");
  const winner = text(item.winner, "winner");
  const selectedOutcomeId = bigintValue(
    item.selected_outcome_id,
    "selected_outcome_id",
  );
  return {
    hasPosition: selectedOutcomeId < 3n,
    marketState: text(item.market_state, "market_state"),
    marketType: marketType(item.market_type),
    asset: asset(item.asset, "asset", true),
    selectedOutcome: selected || null,
    stake: bigintValue(item.stake, "stake"),
    remainingCapacity: bigintValue(
      item.remaining_capacity,
      "remaining_capacity",
    ),
    canTopUp: bool(item.can_top_up, "can_top_up"),
    winner: winner || null,
    positionWon: bool(item.position_won, "position_won"),
    positionLost: bool(item.position_lost, "position_lost"),
    claimAvailable: bool(item.claim_available, "claim_available"),
    refundAvailable: bool(item.refund_available, "refund_available"),
    claimed: bool(item.claimed, "claimed"),
    refunded: bool(item.refunded, "refunded"),
    claimableAmount: bigintValue(item.claimable_amount, "claimable_amount"),
  };
}

export async function getEnergyPosition(marketId: number, user: Address) {
  if (!Number.isSafeInteger(marketId) || marketId < 1 || !isAddress(user)) {
    throw new Error("Invalid Energy position request");
  }
  return normalizePosition(
    await read("get_position", [BigInt(marketId), calldataAddress(user)]),
  );
}

export async function getEnergyMyPosition(marketId: number) {
  if (!Number.isSafeInteger(marketId) || marketId < 1)
    throw new Error("Invalid Energy market ID");
  return normalizePosition(await read("get_my_position", [BigInt(marketId)]));
}

export async function getEnergyClaimable(marketId: number, user: Address) {
  if (!Number.isSafeInteger(marketId) || marketId < 1 || !isAddress(user)) {
    throw new Error("Invalid Energy claim request");
  }
  return bigintValue(
    await read("get_claimable", [BigInt(marketId), calldataAddress(user)]),
    "claimable_amount",
  );
}

export async function getEnergyEvidence(
  marketId: number,
): Promise<EnergySettlementEvidence> {
  const item = record(
    await read("get_settlement_evidence", [BigInt(marketId)]),
    "get_settlement_evidence",
  );
  const rawSources = required(item.sources, "sources");
  if (!Array.isArray(rawSources))
    throw new Error("Energy evidence has invalid sources");
  return {
    marketId: safeNumber(item.market_id, "market_id"),
    marketType: marketType(item.market_type),
    asset: asset(item.asset, "asset", true),
    winner: text(item.winner, "winner") || null,
    sources: rawSources.map((value) => {
      const source = record(value, "source evidence");
      const sourceWinner = text(source.source_winner, "source_winner");
      return {
        source: text(source.source, "source"),
        status: text(source.source_status, "source_status"),
        winner: sourceWinner || null,
      };
    }),
  };
}

export function energyMarketDurationHours(durationSeconds: number) {
  if (durationSeconds === 3600) return 1;
  if (durationSeconds === 7200) return 2;
  throw new Error("Energy duration must be 1H or 2H");
}

export function energyMarketTitle(
  market: Pick<EnergyMarket, "marketType" | "asset">,
) {
  return market.marketType === "UP_DOWN"
    ? `${market.asset === "WTI_CRUDE" ? "WTI Crude" : market.asset === "BRENT_CRUDE" ? "Brent" : "Natural Gas"} — Up or Down?`
    : "Which energy asset takes the Crown?";
}

export function energyOutcomeLabel(value: string) {
  return value === "WTI_CRUDE"
    ? "WTI Crude"
    : value === "BRENT_CRUDE"
      ? "Brent"
      : value === "NATURAL_GAS"
        ? "Natural Gas"
        : value;
}

export function energyPoolEntries(market: EnergyMarket) {
  const keys =
    market.marketType === "UP_DOWN" ? ["UP", "DOWN"] : [...ENERGY_ASSETS];
  return keys.map((key) => ({ key, amount: market.pools[key] ?? 0 }));
}

export function formatEnergyGen(value: bigint) {
  return formatCrownGen(value);
}

export { crownEnergyTransaction, nativeValueFromGen, parseCrownGen };
export type { CrownTransactionRequest, SubmitInput };
