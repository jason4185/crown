import { studioDevnet } from "genlayer-js/chains";
import { getAddress, isAddress, type Address } from "viem";

const env = import.meta.env as Record<string, string | undefined>;

const configuredContractAddress = env["VITE_CROWN_CONTRACT_ADDRESS"]?.trim();
if (configuredContractAddress && !isAddress(configuredContractAddress)) {
  throw new Error("VITE_CROWN_CONTRACT_ADDRESS is not a valid address");
}

/** Intentionally unset until Crown is manually deployed on Studio Next. */
export const CROWN_CONTRACT_ADDRESS: Address | undefined =
  configuredContractAddress ? getAddress(configuredContractAddress) : undefined;

const configuredEnergyContractAddress =
  env["VITE_CROWN_ENERGY_CONTRACT_ADDRESS"]?.trim();
if (
  configuredEnergyContractAddress &&
  !isAddress(configuredEnergyContractAddress)
) {
  throw new Error("VITE_CROWN_ENERGY_CONTRACT_ADDRESS is not a valid address");
}

export const CROWN_ENERGY_CONTRACT_ADDRESS: Address | undefined =
  configuredEnergyContractAddress
    ? getAddress(configuredEnergyContractAddress)
    : undefined;

export function requireCrownContractAddress(): Address {
  if (!CROWN_CONTRACT_ADDRESS) {
    throw new Error(
      "Crown Studio Next contract address is not configured. Set VITE_CROWN_CONTRACT_ADDRESS after manual deployment.",
    );
  }
  return CROWN_CONTRACT_ADDRESS;
}

export function requireCrownEnergyContractAddress(): Address {
  if (!CROWN_ENERGY_CONTRACT_ADDRESS) {
    throw new Error(
      "Crown Energy Studio Next contract address is not configured. Set VITE_CROWN_ENERGY_CONTRACT_ADDRESS after manual deployment.",
    );
  }
  return CROWN_ENERGY_CONTRACT_ADDRESS;
}

export const STUDIO_NEXT_RPC_URL =
  env["VITE_GENLAYER_RPC_URL"] || "https://studio-next.genlayer.com/api";
export const STUDIO_NEXT_CHAIN_ID = Number(
  env["VITE_GENLAYER_CHAIN_ID"] || "61997",
);
export const STUDIO_NEXT_CHAIN_NAME =
  env["VITE_GENLAYER_CHAIN_NAME"] || "GenLayer Studio Next";
export const STUDIO_NEXT_EXPLORER_URL =
  env["VITE_GENLAYER_EXPLORER_URL"] ||
  "https://explorer-studio-dev.genlayer.com/";

if (
  !Number.isSafeInteger(STUDIO_NEXT_CHAIN_ID) ||
  STUDIO_NEXT_CHAIN_ID !== 61997
) {
  throw new Error("Crown requires GenLayer Studio Next chain 61997");
}

/** The single chain definition shared by genlayer-js, RainbowKit, and Kit RC2. */
export const STUDIO_NEXT_CHAIN = {
  ...studioDevnet,
  id: STUDIO_NEXT_CHAIN_ID,
  name: STUDIO_NEXT_CHAIN_NAME,
  nativeCurrency: { name: "GEN", symbol: "GEN", decimals: 18 },
  rpcUrls: { default: { http: [STUDIO_NEXT_RPC_URL] } },
};

export const STUDIO_NEXT_NETWORK = {
  chainId: `0x${STUDIO_NEXT_CHAIN_ID.toString(16)}`,
  chainName: STUDIO_NEXT_CHAIN_NAME,
  nativeCurrency: STUDIO_NEXT_CHAIN.nativeCurrency,
  rpcUrls: [STUDIO_NEXT_RPC_URL],
  blockExplorerUrls: [STUDIO_NEXT_EXPLORER_URL],
};

export const STUDIO_NEXT_CHAIN_ID_HEX = STUDIO_NEXT_NETWORK.chainId;

// Keep the existing Crown names as aliases so the UI remains unchanged while
// every consumer resolves to the same Studio Next definition above.
export const GENLAYER_CHAIN = STUDIO_NEXT_CHAIN;
export const GENLAYER_CHAIN_ID = STUDIO_NEXT_CHAIN_ID;
export const GENLAYER_RPC_ENDPOINT = STUDIO_NEXT_RPC_URL;
export const GENLAYER_NETWORK_NAME = STUDIO_NEXT_CHAIN_NAME;
export const GENLAYER_EXPLORER_URL = STUDIO_NEXT_EXPLORER_URL;
