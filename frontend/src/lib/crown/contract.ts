import { createClient } from "genlayer-js";
import {
  CalldataAddress,
  ExecutionResult,
  TransactionHashVariant,
  TransactionStatus,
} from "genlayer-js/types";
import type { Address, Hash } from "viem";
import { formatUnits, getAddress, isAddress, parseUnits } from "viem";

import {
  ASSETS,
  type AssetSymbol,
  type Market,
  type MarketStatus,
} from "./presentation";
import {
  CROWN_CONTRACT_ADDRESS,
  GENLAYER_CHAIN,
  GENLAYER_RPC_ENDPOINT,
} from "./config";
import { formatCrownError } from "./errors";

type RawRecord = Record<string, unknown> & {
  BTC_pool?: unknown;
  ETH_pool?: unknown;
  SOL_pool?: unknown;
  BNB_pool?: unknown;
  XRP_pool?: unknown;
  market_id?: unknown;
  start_timestamp?: unknown;
  performance_end_timestamp?: unknown;
  winner?: unknown;
  status?: unknown;
  creator?: unknown;
  betting_close_timestamp?: unknown;
  performance_start_timestamp?: unknown;
  settlement_ready_timestamp?: unknown;
  settlement_retry_deadline?: unknown;
  duration?: unknown;
  total_pool?: unknown;
  consensus_count?: unknown;
  resolution_status?: unknown;
  betting_open?: unknown;
  settlement_available?: unknown;
  winning_pool?: unknown;
  claimed_pool?: unknown;
  remaining_pool?: unknown;
  markets?: unknown;
  market_ids?: unknown;
  next_offset?: unknown;
  has_more?: unknown;
  scanned_count?: unknown;
  claim_type?: unknown;
  has_position?: unknown;
  selected_asset?: unknown;
  total_stake?: unknown;
  remaining_stake_capacity?: unknown;
  can_top_up?: unknown;
  position_won?: unknown;
  position_lost?: unknown;
  claim_available?: unknown;
  already_claimed?: unknown;
  claimable_amount?: unknown;
  binance_status?: unknown;
  binance_winner?: unknown;
  bitget_status?: unknown;
  bitget_winner?: unknown;
  gate_status?: unknown;
  gate_winner?: unknown;
  valid_source_count?: unknown;
  final_winner?: unknown;
  assets?: unknown;
  sources?: unknown;
  durations_seconds?: unknown;
  name?: unknown;
  min_stake?: unknown;
  max_stake?: unknown;
  consensus_threshold?: unknown;
  minimum_creation_lead_seconds?: unknown;
  betting_close_lead_seconds?: unknown;
  settlement_grace_seconds?: unknown;
  settlement_retry_window_seconds?: unknown;
  timezone?: unknown;
  source_strategy?: unknown;
  return_precision?: unknown;
  price_precision?: unknown;
  payout_rounding?: unknown;
  zero_backed_winner?: unknown;
  exists?: unknown;
};

export type CrownProtocolConfig = {
  name: string;
  assets: AssetSymbol[];
  durationSeconds: number;
  durationsSeconds: number[];
  minStake: bigint;
  maxStake: bigint;
  sources: string[];
  consensusThreshold: number;
  minimumCreationLeadSeconds: number;
  bettingCloseLeadSeconds: number;
  settlementGraceSeconds: number;
  settlementRetryWindowSeconds: number;
  timezone: string;
  sourceStrategy: string;
  returnPrecision: bigint;
  pricePrecision: bigint;
  payoutRounding: string;
  zeroBackedWinner: string;
};

export type OnchainMarket = {
  marketId: bigint;
  creator: string;
  startTimestamp: bigint;
  bettingCloseTimestamp: bigint;
  performanceStartTimestamp: bigint;
  performanceEndTimestamp: bigint;
  settlementReadyTimestamp: bigint;
  settlementRetryDeadline: bigint;
  duration: bigint;
  pools: Record<AssetSymbol, bigint>;
  totalPool: bigint;
  winner: AssetSymbol | null;
  consensusCount: bigint;
  status: MarketStatus;
  resolutionStatus: string;
  bettingOpen: boolean;
  settlementAvailable: boolean;
  winningPool: bigint;
  claimedPool: bigint;
  remainingPool: bigint;
};

export type CrownMarket = Market & { onchain: OnchainMarket };

export type CrownPosition = {
  hasPosition: boolean;
  selectedAsset: AssetSymbol | null;
  totalStake: bigint;
  remainingStakeCapacity: bigint;
  canTopUp: boolean;
  positionWon: boolean;
  positionLost: boolean;
  claimAvailable: boolean;
  alreadyClaimed: boolean;
  claimableAmount: bigint;
  claimType: "PAYOUT" | "REFUND" | "NONE";
};

export type CrownResolution = {
  status: string;
  binanceStatus: string;
  binanceWinner: AssetSymbol | null;
  bitgetStatus: string;
  bitgetWinner: AssetSymbol | null;
  gateStatus: string;
  gateWinner: AssetSymbol | null;
  validSourceCount: number;
  finalWinner: AssetSymbol | null;
  consensusCount: number;
};

export type CrownConsensusResult = {
  asset: AssetSymbol;
  count: number;
};

/**
 * Reconstruct the exposed source consensus for explanatory UI copy. The
 * contract intentionally keeps a zero-backed consensus out of final_winner.
 */
export function deriveCrownConsensusResult(
  resolution: CrownResolution,
): CrownConsensusResult | null {
  const votes: Array<[string, AssetSymbol | null]> = [
    [resolution.binanceStatus, resolution.binanceWinner],
    [resolution.bitgetStatus, resolution.bitgetWinner],
    [resolution.gateStatus, resolution.gateWinner],
  ];

  for (const asset of ASSETS) {
    const count = votes.filter(
      ([status, winner]) => status === "VALID" && winner === asset,
    ).length;
    if (count >= 2 && count === resolution.consensusCount) {
      return { asset, count };
    }
  }

  return null;
}

export type CrownInconclusiveReason =
  "EMPTY_MARKET" | "ZERO_BACKED_WINNER" | "NO_CONSENSUS" | "UNKNOWN";

export function deriveCrownInconclusiveReason(
  totalPool: bigint,
  winningPool: bigint,
  resolution?: CrownResolution | undefined,
): CrownInconclusiveReason {
  if (totalPool === 0n) return "EMPTY_MARKET";
  if (!resolution) return "UNKNOWN";
  const consensusResult = deriveCrownConsensusResult(resolution);
  if (consensusResult !== null && winningPool === 0n) {
    return "ZERO_BACKED_WINNER";
  }
  if (consensusResult !== null) return "UNKNOWN";
  return "NO_CONSENSUS";
}

export type CrownMarketPage = {
  markets: CrownMarket[];
  marketIds: number[];
  nextOffset: number;
  hasMore: boolean;
  scannedCount?: number;
};

export type TxStage =
  "preparing" | "confirming" | "submitted" | "pending" | "success" | "failed";

export type TxProgress = {
  stage: TxStage;
  hash?: string;
};

function asRecord(value: unknown, label: string): RawRecord {
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
    throw new Error(`Crown response is missing ${field}`);
  }
  return value;
}

function asText(value: unknown, field: string): string {
  return String(required(value, field));
}

function asBool(value: unknown, field: string): boolean {
  const result = required(value, field);
  if (typeof result !== "boolean") {
    throw new Error(`Crown response field ${field} is not boolean`);
  }
  return result;
}

function asBigInt(value: unknown, field: string): bigint {
  try {
    if (typeof value === "bigint") return value;
    if (typeof value === "number" && !Number.isSafeInteger(value)) {
      throw new Error("unsafe number");
    }
    return BigInt(required(value, field) as string | number);
  } catch {
    throw new Error(`Crown response field ${field} is not an integer`);
  }
}

function asSafeNumber(value: unknown, field: string): number {
  const result = asBigInt(value, field);
  const number = Number(result);
  if (!Number.isSafeInteger(number)) {
    throw new Error(`Crown response field ${field} exceeds safe range`);
  }
  return number;
}

function asAsset(
  value: unknown,
  field: string,
  allowEmpty = false,
): AssetSymbol | null {
  const text = asText(value, field);
  if (allowEmpty && text === "") return null;
  if (!ASSETS.includes(text as AssetSymbol)) {
    throw new Error(
      `Crown response field ${field} contains an unsupported asset`,
    );
  }
  return text as AssetSymbol;
}

function asStatus(value: unknown): MarketStatus {
  const status = asText(value, "status") as MarketStatus;
  if (
    ![
      "OPEN",
      "LOCKED",
      "LIVE",
      "FINALIZING",
      "SETTLEMENT_READY",
      "RESOLVED",
      "INCONCLUSIVE",
    ].includes(status)
  ) {
    throw new Error(`Crown returned unsupported market status ${status}`);
  }
  return status;
}

function isoFromSeconds(value: bigint, field: string): string {
  const seconds = asSafeNumber(value, field);
  const date = new Date(seconds * 1000);
  if (Number.isNaN(date.getTime()))
    throw new Error(`Invalid ${field} timestamp`);
  return date.toISOString();
}

function displayGen(value: bigint): number {
  return Number(formatUnits(value, 18));
}

function calldataAddress(address: Address): CalldataAddress {
  const hex = getAddress(address).slice(2);
  const bytes = new Uint8Array(20);
  for (let index = 0; index < 20; index += 1) {
    bytes[index] = Number.parseInt(hex.slice(index * 2, index * 2 + 2), 16);
  }
  return new CalldataAddress(bytes);
}

export function formatCrownGen(value: bigint, digits = 4): string {
  const raw = formatUnits(value, 18);
  const [whole, fraction = ""] = raw.split(".");
  const trimmed = fraction.slice(0, digits).replace(/0+$/, "");
  return `${whole}${trimmed ? `.${trimmed}` : ""} GEN`;
}

export function formatCrownGenInput(value: bigint): string {
  return formatUnits(value, 18);
}

export function parseCrownGen(value: string): bigint {
  const normalized = value.trim();
  if (!/^\d+(\.\d{1,18})?$/.test(normalized)) {
    throw new Error("Enter a valid GEN amount with up to 18 decimals");
  }
  return parseUnits(normalized, 18);
}

function poolsFromRecord(record: RawRecord): Record<AssetSymbol, bigint> {
  return {
    BTC: asBigInt(record.BTC_pool, "BTC_pool"),
    ETH: asBigInt(record.ETH_pool, "ETH_pool"),
    SOL: asBigInt(record.SOL_pool, "SOL_pool"),
    BNB: asBigInt(record.BNB_pool, "BNB_pool"),
    XRP: asBigInt(record.XRP_pool, "XRP_pool"),
  };
}

function normalizeMarket(value: unknown): CrownMarket {
  const record = asRecord(value, "get_market");
  const marketId = asBigInt(record.market_id, "market_id");
  const startTimestamp = asBigInt(record.start_timestamp, "start_timestamp");
  const performanceEndTimestamp = asBigInt(
    record.performance_end_timestamp,
    "performance_end_timestamp",
  );
  const pools = poolsFromRecord(record);
  const winner = asAsset(record.winner, "winner", true);
  const status = asStatus(record.status);
  const onchain: OnchainMarket = {
    marketId,
    creator: asText(record.creator, "creator"),
    startTimestamp,
    bettingCloseTimestamp: asBigInt(
      record.betting_close_timestamp,
      "betting_close_timestamp",
    ),
    performanceStartTimestamp: asBigInt(
      record.performance_start_timestamp,
      "performance_start_timestamp",
    ),
    performanceEndTimestamp,
    settlementReadyTimestamp: asBigInt(
      record.settlement_ready_timestamp,
      "settlement_ready_timestamp",
    ),
    settlementRetryDeadline: asBigInt(
      record.settlement_retry_deadline,
      "settlement_retry_deadline",
    ),
    duration: asBigInt(record.duration, "duration"),
    pools,
    totalPool: asBigInt(record.total_pool, "total_pool"),
    winner,
    consensusCount: asBigInt(record.consensus_count, "consensus_count"),
    status,
    resolutionStatus: asText(record.resolution_status, "resolution_status"),
    bettingOpen: asBool(record.betting_open, "betting_open"),
    settlementAvailable: asBool(
      record.settlement_available,
      "settlement_available",
    ),
    winningPool: asBigInt(record.winning_pool, "winning_pool"),
    claimedPool: asBigInt(record.claimed_pool, "claimed_pool"),
    remainingPool: asBigInt(record.remaining_pool, "remaining_pool"),
  };

  return {
    id: asSafeNumber(marketId, "market_id"),
    startISO: isoFromSeconds(startTimestamp, "start_timestamp"),
    endISO: isoFromSeconds(
      performanceEndTimestamp,
      "performance_end_timestamp",
    ),
    status,
    pools: {
      BTC: displayGen(pools.BTC),
      ETH: displayGen(pools.ETH),
      SOL: displayGen(pools.SOL),
      BNB: displayGen(pools.BNB),
      XRP: displayGen(pools.XRP),
    },
    winner,
    creator: onchain.creator,
    onchain,
  };
}

function normalizePreview(value: unknown): CrownMarket {
  const record = asRecord(value, "market preview");
  const marketId = asBigInt(record.market_id, "market_id");
  const startTimestamp = asBigInt(record.start_timestamp, "start_timestamp");
  const performanceEndTimestamp = asBigInt(
    record.performance_end_timestamp,
    "performance_end_timestamp",
  );
  const bettingCloseTimestamp = asBigInt(
    record.betting_close_timestamp,
    "betting_close_timestamp",
  );
  const pools = poolsFromRecord(record);
  const totalPool = asBigInt(record.total_pool, "total_pool");
  const winner = asAsset(record.winner, "winner", true);
  const status = asStatus(record.status);
  const onchain: OnchainMarket = {
    marketId,
    creator: "",
    startTimestamp,
    bettingCloseTimestamp,
    performanceStartTimestamp: startTimestamp,
    performanceEndTimestamp,
    settlementReadyTimestamp: performanceEndTimestamp + 60n,
    settlementRetryDeadline: performanceEndTimestamp + 1_860n,
    duration: 14_400n,
    pools,
    totalPool,
    winner,
    consensusCount: 0n,
    status,
    resolutionStatus:
      status === "RESOLVED"
        ? "RESOLVED"
        : status === "INCONCLUSIVE"
          ? "INCONCLUSIVE"
          : "UNRESOLVED",
    bettingOpen: status === "OPEN",
    settlementAvailable: status === "SETTLEMENT_READY",
    winningPool: winner ? pools[winner] : 0n,
    claimedPool: 0n,
    remainingPool: totalPool,
  };
  return {
    id: asSafeNumber(marketId, "market_id"),
    startISO: isoFromSeconds(startTimestamp, "start_timestamp"),
    endISO: isoFromSeconds(
      performanceEndTimestamp,
      "performance_end_timestamp",
    ),
    status,
    pools: {
      BTC: displayGen(pools.BTC),
      ETH: displayGen(pools.ETH),
      SOL: displayGen(pools.SOL),
      BNB: displayGen(pools.BNB),
      XRP: displayGen(pools.XRP),
    },
    winner,
    creator: "",
    onchain,
  };
}

function normalizePage(value: unknown, scannedCount = false): CrownMarketPage {
  const record = asRecord(value, "get_markets");
  const rawMarkets = required(record.markets, "markets");
  if (!Array.isArray(rawMarkets))
    throw new Error("Crown markets is not an array");
  const rawIds = required(record.market_ids, "market_ids");
  if (!Array.isArray(rawIds))
    throw new Error("Crown market_ids is not an array");
  return {
    markets: rawMarkets.map((market) => {
      const record = asRecord(market, "market preview");
      return record.creator === undefined
        ? normalizePreview(record)
        : normalizeMarket(record);
    }),
    marketIds: rawIds.map((id) => asSafeNumber(id, "market_id")),
    nextOffset: asSafeNumber(record.next_offset, "next_offset"),
    hasMore: asBool(record.has_more, "has_more"),
    ...(scannedCount
      ? { scannedCount: asSafeNumber(record.scanned_count, "scanned_count") }
      : {}),
  };
}

function normalizePosition(value: unknown): CrownPosition {
  const record = asRecord(value, "get_user_position");
  const claimType = asText(record.claim_type, "claim_type");
  if (!["PAYOUT", "REFUND", "NONE"].includes(claimType)) {
    throw new Error(`Unsupported Crown claim type ${claimType}`);
  }
  return {
    hasPosition: asBool(record.has_position, "has_position"),
    selectedAsset: asAsset(record.selected_asset, "selected_asset", true),
    totalStake: asBigInt(record.total_stake, "total_stake"),
    remainingStakeCapacity: asBigInt(
      record.remaining_stake_capacity,
      "remaining_stake_capacity",
    ),
    canTopUp: asBool(record.can_top_up, "can_top_up"),
    positionWon: asBool(record.position_won, "position_won"),
    positionLost: asBool(record.position_lost, "position_lost"),
    claimAvailable: asBool(record.claim_available, "claim_available"),
    alreadyClaimed: asBool(record.already_claimed, "already_claimed"),
    claimableAmount: asBigInt(record.claimable_amount, "claimable_amount"),
    claimType: claimType as CrownPosition["claimType"],
  };
}

function normalizeResolution(value: unknown): CrownResolution {
  const record = asRecord(value, "get_resolution");
  return {
    status: asText(record.status, "status"),
    binanceStatus: asText(record.binance_status, "binance_status"),
    binanceWinner: asAsset(record.binance_winner, "binance_winner", true),
    bitgetStatus: asText(record.bitget_status, "bitget_status"),
    bitgetWinner: asAsset(record.bitget_winner, "bitget_winner", true),
    gateStatus: asText(record.gate_status, "gate_status"),
    gateWinner: asAsset(record.gate_winner, "gate_winner", true),
    validSourceCount: asSafeNumber(
      record.valid_source_count,
      "valid_source_count",
    ),
    finalWinner: asAsset(record.final_winner, "final_winner", true),
    consensusCount: asSafeNumber(record.consensus_count, "consensus_count"),
  };
}

function createReadClient() {
  return createClient({
    chain: GENLAYER_CHAIN as never,
    endpoint: GENLAYER_RPC_ENDPOINT,
  });
}

async function read(
  functionName: string,
  args: unknown[] = [],
): Promise<unknown> {
  const client = createReadClient();
  return client.readContract({
    address: CROWN_CONTRACT_ADDRESS,
    functionName,
    args: args as never,
    transactionHashVariant: TransactionHashVariant.LATEST_NONFINAL,
  });
}

export async function getProtocolConfig(): Promise<CrownProtocolConfig> {
  const record = asRecord(
    await read("get_protocol_config"),
    "get_protocol_config",
  );
  const assets = required(record.assets, "assets");
  const sources = required(record.sources, "sources");
  const durations = required(record.durations_seconds, "durations_seconds");
  if (
    !Array.isArray(assets) ||
    !Array.isArray(sources) ||
    !Array.isArray(durations)
  ) {
    throw new Error("Crown protocol config contains invalid arrays");
  }
  const normalizedAssets = assets.map((asset) => asAsset(asset, "assets")!);
  if (normalizedAssets.join(",") !== ASSETS.join(",")) {
    throw new Error("Crown returned an unexpected asset basket");
  }
  const durationsSeconds = durations.map((duration) =>
    asSafeNumber(duration, "duration"),
  );
  const durationSeconds = asSafeNumber(record.duration, "duration");
  if (durationSeconds !== 14400 || durationsSeconds.join(",") !== "14400") {
    throw new Error(
      "Crown is not configured for the required 4H-only protocol",
    );
  }
  const normalizedSources = sources.map((source) => asText(source, "source"));
  if (normalizedSources.join(",") !== "BINANCE,BITGET,GATE") {
    throw new Error("Crown returned an unexpected settlement source set");
  }
  return {
    name: asText(record.name, "name"),
    assets: normalizedAssets,
    durationSeconds,
    durationsSeconds,
    minStake: asBigInt(record.min_stake, "min_stake"),
    maxStake: asBigInt(record.max_stake, "max_stake"),
    sources: normalizedSources,
    consensusThreshold: asSafeNumber(
      record.consensus_threshold,
      "consensus_threshold",
    ),
    minimumCreationLeadSeconds: asSafeNumber(
      record.minimum_creation_lead_seconds,
      "minimum_creation_lead_seconds",
    ),
    bettingCloseLeadSeconds: asSafeNumber(
      record.betting_close_lead_seconds,
      "betting_close_lead_seconds",
    ),
    settlementGraceSeconds: asSafeNumber(
      record.settlement_grace_seconds,
      "settlement_grace_seconds",
    ),
    settlementRetryWindowSeconds: asSafeNumber(
      record.settlement_retry_window_seconds,
      "settlement_retry_window_seconds",
    ),
    timezone: asText(record.timezone, "timezone"),
    sourceStrategy: asText(record.source_strategy, "source_strategy"),
    returnPrecision: asBigInt(record.return_precision, "return_precision"),
    pricePrecision: asBigInt(record.price_precision, "price_precision"),
    payoutRounding: asText(record.payout_rounding, "payout_rounding"),
    zeroBackedWinner: asText(record.zero_backed_winner, "zero_backed_winner"),
  };
}

export async function getMarket(marketId: number): Promise<CrownMarket> {
  if (!Number.isSafeInteger(marketId) || marketId < 1) {
    throw new Error("Invalid Crown market ID");
  }
  return normalizeMarket(await read("get_market", [BigInt(marketId)]));
}

export async function getMarketsPage(
  offset = 0,
  limit = 25,
): Promise<CrownMarketPage> {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid market offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Market page limit must be between 1 and 25");
  }
  return normalizePage(
    await read("get_markets", [BigInt(offset), BigInt(limit)]),
  );
}

export async function getOpenMarketsPage(
  offset = 0,
  limit = 25,
): Promise<CrownMarketPage> {
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new Error("Invalid market offset");
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > 25) {
    throw new Error("Market page limit must be between 1 and 25");
  }
  return normalizePage(
    await read("get_open_markets", [BigInt(offset), BigInt(limit)]),
    true,
  );
}

export async function getUserPosition(
  marketId: number,
  user: Address,
): Promise<CrownPosition> {
  if (!Number.isSafeInteger(marketId) || marketId < 1 || !isAddress(user)) {
    throw new Error("Invalid Crown position request");
  }
  return normalizePosition(
    await read("get_user_position", [BigInt(marketId), calldataAddress(user)]),
  );
}

export async function getResolution(
  marketId: number,
): Promise<CrownResolution> {
  if (!Number.isSafeInteger(marketId) || marketId < 1)
    throw new Error("Invalid Crown market ID");
  return normalizeResolution(await read("get_resolution", [BigInt(marketId)]));
}

export async function getMarketByStart(startTimestamp: bigint | number) {
  const timestamp =
    typeof startTimestamp === "bigint"
      ? startTimestamp
      : BigInt(startTimestamp);
  if (timestamp <= 0n || timestamp % 14400n !== 0n) {
    throw new Error("Crown market start must be a UTC-aligned 4H boundary");
  }
  const record = asRecord(
    await read("get_market_by_start", [timestamp]),
    "get_market_by_start",
  );
  return {
    exists: asBool(record.exists, "exists"),
    marketId: asSafeNumber(record.market_id, "market_id"),
  };
}

function humanizeError(error: unknown): string {
  return formatCrownError(error);
}

export async function writeCrownTransaction({
  address,
  connector,
  functionName,
  args = [],
  value = 0n,
  waitForFinality = false,
  onProgress,
}: {
  address: Address;
  connector?: { getProvider: () => Promise<unknown> } | null | undefined;
  functionName: string;
  args?: unknown[];
  value?: bigint;
  waitForFinality?: boolean;
  onProgress?: (progress: TxProgress) => void;
}) {
  if (!connector) throw new Error("Connect an injected wallet first.");
  if (!isAddress(address))
    throw new Error("The connected wallet address is invalid.");
  const provider = await connector.getProvider();
  if (!provider) throw new Error("No injected wallet provider is available.");

  onProgress?.({ stage: "preparing" });
  try {
    const client = createClient({
      chain: GENLAYER_CHAIN as never,
      endpoint: GENLAYER_RPC_ENDPOINT,
      account: getAddress(address),
      provider: provider as never,
    });
    onProgress?.({ stage: "confirming" });
    const result = await client.writeContract({
      address: CROWN_CONTRACT_ADDRESS,
      functionName,
      args: args as never,
      value,
    });
    const hash = String(
      typeof result === "string"
        ? result
        : (result?.hash ?? result?.transactionHash ?? result?.txHash ?? ""),
    ) as unknown as Hash;
    if (!hash.startsWith("0x"))
      throw new Error("Crown did not return a transaction hash.");
    onProgress?.({ stage: "submitted", hash });
    onProgress?.({ stage: "pending", hash });
    const receipt = await client.waitForTransactionReceipt({
      hash: hash as never,
      status: waitForFinality
        ? TransactionStatus.FINALIZED
        : TransactionStatus.ACCEPTED,
      interval: 2000,
      retries: 90,
    });
    if (receipt.txExecutionResultName === ExecutionResult.FINISHED_WITH_ERROR) {
      throw new Error(
        "Crown rejected the transaction during contract execution.",
      );
    }
    if (
      receipt.txExecutionResultName !== ExecutionResult.FINISHED_WITH_RETURN
    ) {
      throw new Error("Crown transaction did not finish successfully.");
    }
    onProgress?.({ stage: "success", hash });
    return { hash, receipt };
  } catch (error) {
    const message = humanizeError(error);
    onProgress?.({ stage: "failed" });
    throw new Error(message);
  }
}
