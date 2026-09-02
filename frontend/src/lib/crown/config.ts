import { testnetBradbury } from "genlayer-js/chains";
import { getAddress, isAddress, type Address } from "viem";

const FALLBACK_CONTRACT_ADDRESS = "0x243adf9cacA6621D4dabCA95F5c5c80C6c1489ac";

const configuredContractAddress = String(
  import.meta.env["VITE_CROWN_CONTRACT_ADDRESS"] ?? FALLBACK_CONTRACT_ADDRESS,
);

if (!isAddress(configuredContractAddress)) {
  throw new Error("VITE_CROWN_CONTRACT_ADDRESS is not a valid address");
}

export const CROWN_CONTRACT_ADDRESS: Address = getAddress(
  configuredContractAddress,
);

export const GENLAYER_CHAIN = testnetBradbury;
export const GENLAYER_CHAIN_ID = testnetBradbury.id;
export const GENLAYER_RPC_ENDPOINT = String(
  import.meta.env["VITE_GENLAYER_RPC_URL"] ??
    testnetBradbury.rpcUrls.default.http[0],
);
export const GENLAYER_NETWORK_NAME = testnetBradbury.name;
export const GENLAYER_EXPLORER_URL =
  testnetBradbury.blockExplorers?.default.url ??
  "https://explorer-bradbury.genlayer.com/";
