import { useEffect, useMemo, useState } from "react";
import {
  createTransactionKit,
  type Eip1193Provider,
  type TransactionKit,
} from "@genlayer/transaction-kit";
import type { Address } from "viem";
import { GENLAYER_CHAIN } from "./config";

type ConnectorLike = {
  getProvider?: () => Promise<unknown>;
};

function asProvider(value: unknown): Eip1193Provider | null {
  if (!value || typeof value !== "object") return null;
  const request = (value as { request?: unknown }).request;
  return typeof request === "function" ? (value as Eip1193Provider) : null;
}

function injectedProvider(): Eip1193Provider | null {
  if (typeof window === "undefined") return null;
  return asProvider((window as Window & { ethereum?: unknown }).ethereum);
}

/**
 * Resolves the active RainbowKit connector provider and creates the same RC2
 * kit used by VANTA. Confirm remains the only action gated on the kit.
 */
export function useCrownTransactionKit(
  address: Address | undefined,
  connector: ConnectorLike | null | undefined,
  enabled = true,
): TransactionKit | null {
  const [provider, setProvider] = useState<Eip1193Provider | null>(null);

  useEffect(() => {
    let active = true;
    setProvider(null);
    if (!enabled || !address)
      return () => {
        active = false;
      };

    const resolve = async () => {
      const connected = connector?.getProvider
        ? asProvider(await connector.getProvider())
        : null;
      if (active) setProvider(connected ?? injectedProvider());
    };
    void resolve().catch(() => {
      if (active) setProvider(injectedProvider());
    });

    return () => {
      active = false;
    };
  }, [address, connector, enabled]);

  return useMemo(() => {
    if (!enabled || !address || !provider) return null;
    return createTransactionKit({
      chain: GENLAYER_CHAIN,
      provider,
      account: address,
    });
  }, [address, enabled, provider]);
}
