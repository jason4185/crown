import "@rainbow-me/rainbowkit/styles.css";

import { RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { createConfig, http, injected, WagmiProvider } from "wagmi";

import { GENLAYER_CHAIN, GENLAYER_RPC_ENDPOINT } from "./config";

export const wagmiConfig = createConfig({
  chains: [GENLAYER_CHAIN],
  connectors: [
    injected({
      shimDisconnect: true,
    }),
  ],
  transports: {
    [GENLAYER_CHAIN.id]: http(GENLAYER_RPC_ENDPOINT),
  },
  multiInjectedProviderDiscovery: true,
  ssr: true,
});

export function CrownWalletProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <RainbowKitProvider>{children}</RainbowKitProvider>
    </WagmiProvider>
  );
}
