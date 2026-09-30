import { useEffect, useMemo, useState } from "react";
import { useChainModal, useConnectModal } from "@rainbow-me/rainbowkit";
import { useQuery, useQueries, useQueryClient } from "@tanstack/react-query";
import { createFileRoute, Link } from "@tanstack/react-router";
import {
  CalendarDays,
  CalendarClock,
  Check,
  ChevronDown,
  Crown,
  ShieldCheck,
} from "lucide-react";
import { toast } from "sonner";
import { useAccount } from "wagmi";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { TransactionDialog } from "@/components/crown/TransactionDialog";
import { CrownErrorState } from "@/components/crown/CrownErrorState";
import {
  crownTransaction,
  getMarketByStart,
  getProtocolConfig,
  type CrownTransactionRequest,
} from "@/lib/crown/contract";
import {
  crownEnergyTransaction,
  energyMarketDurationHours,
  getEnergyConfig,
  getEnergyMarketsPage,
  type EnergyMarketType,
} from "@/lib/crown/energy";
import { GENLAYER_CHAIN_ID } from "@/lib/crown/config";
import { getCrownErrorCopy } from "@/lib/crown/errors";
import { useCrownTransactionKit } from "@/lib/crown/kit";
import { fmtUtcDate, fmtUtcFull, fmtUtcWindow } from "@/lib/crown/presentation";
import {
  buildCanonicalSlots,
  buildEnergySlots,
  CROWN_DURATION_SECONDS,
  dateKeyFromCalendarDate,
  dateKeyFromTimestamp,
  pickerDateFromKey,
  timestampFromDateKey,
  type CrownSlot,
} from "@/lib/crown/windows";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/create")({
  head: () => ({
    meta: [
      { title: "Create a Crown market" },
      {
        name: "description",
        content:
          "Create a permissionless Crown market for a canonical 4-hour UTC window.",
      },
    ],
  }),
  component: CreateMarketPage,
});

type SlotState =
  "CHECKING" | "AVAILABLE" | "EXISTS" | "PAST" | "CREATION_CLOSED" | "ERROR";

function slotState(
  slot: CrownSlot,
  lookup:
    | {
        isLoading: boolean;
        isPending: boolean;
        isError: boolean;
        data?: { exists: boolean; marketId: number } | undefined;
      }
    | undefined,
  nowSeconds: number | null,
  minimumCreationLead: number,
): SlotState {
  if (lookup?.isLoading || lookup?.isPending) return "CHECKING";
  if (lookup?.isError) return "ERROR";
  if (lookup?.data?.exists) return "EXISTS";
  if (nowSeconds === null) return "CHECKING";
  if (slot.startTimestamp <= nowSeconds) return "PAST";
  if (slot.startTimestamp < nowSeconds + minimumCreationLead) {
    return "CREATION_CLOSED";
  }
  return "AVAILABLE";
}

function TimingRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2 text-sm">
      <span className="text-muted-foreground">{label}</span>
      <span className="tabular text-right font-medium">{value}</span>
    </div>
  );
}

function stateLabel(state: SlotState) {
  if (state === "CHECKING") return "Checking availability…";
  if (state === "EXISTS") return "Already exists";
  if (state === "PAST") return "Past";
  if (state === "CREATION_CLOSED") return "Creation closed";
  if (state === "ERROR") return "Unable to verify availability";
  return "Available";
}

function CryptoCreateMarket() {
  const { address, chainId, connector, isConnected } = useAccount();
  const kit = useCrownTransactionKit(address, connector);
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const queryClient = useQueryClient();
  const [dateKey, setDateKey] = useState(() =>
    dateKeyFromTimestamp(Math.floor(Date.now() / 1000)),
  );
  const [nowSeconds, setNowSeconds] = useState<number | null>(null);
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [transaction, setTransaction] = useState<{
    open: boolean;
    tx: CrownTransactionRequest;
  } | null>(null);
  const [createdMarketId, setCreatedMarketId] = useState<number | null>(null);

  useEffect(() => {
    const updateNow = () => setNowSeconds(Math.floor(Date.now() / 1000));
    updateNow();
    const timer = window.setInterval(updateNow, 30_000);
    return () => window.clearInterval(timer);
  }, []);

  const configQuery = useQuery({
    queryKey: ["crown", "config"],
    queryFn: getProtocolConfig,
    staleTime: 300_000,
  });
  const config = configQuery.data;
  const slots = useMemo(
    () =>
      buildCanonicalSlots(
        dateKey,
        config?.durationSeconds ?? CROWN_DURATION_SECONDS,
      ),
    [dateKey, config],
  );
  const lookupQueries = useQueries({
    queries: slots.map((slot) => ({
      queryKey: ["crown", "marketByStart", slot.startTimestamp],
      queryFn: () => getMarketByStart(slot.startTimestamp),
      enabled: Boolean(config),
      staleTime: 15_000,
    })),
  });
  const minimumCreationLead = config?.minimumCreationLeadSeconds ?? 300;
  const states = slots.map((slot, index) =>
    slotState(slot, lookupQueries[index], nowSeconds, minimumCreationLead),
  );
  const selectedIndex = selectedStart
    ? slots.findIndex((slot) => slot.startTimestamp === selectedStart)
    : -1;
  const selectedSlot = selectedIndex >= 0 ? slots[selectedIndex] : undefined;
  const selectedState = selectedIndex >= 0 ? states[selectedIndex] : undefined;
  const selectedLookup =
    selectedIndex >= 0 ? lookupQueries[selectedIndex] : undefined;
  const existingMarketId =
    createdMarketId ??
    (selectedState === "EXISTS" && selectedLookup?.data?.exists
      ? selectedLookup.data.marketId
      : undefined);
  const lookupError = lookupQueries.some((query) => query.isError);
  const duration = config?.durationSeconds ?? CROWN_DURATION_SECONDS;
  const bettingCloseLead = config?.bettingCloseLeadSeconds ?? 60;
  const settlementGrace = config?.settlementGraceSeconds ?? 60;
  const retryWindow = config?.settlementRetryWindowSeconds ?? 1_800;
  const preview = selectedSlot
    ? {
        startISO: new Date(selectedSlot.startTimestamp * 1000).toISOString(),
        endISO: new Date(
          (selectedSlot.startTimestamp + duration) * 1000,
        ).toISOString(),
      }
    : null;

  const chooseDate = (date: Date | undefined) => {
    if (!date) return;
    setDateKey(dateKeyFromCalendarDate(date));
    setSelectedStart(null);
    setCreatedMarketId(null);
  };

  const create = async () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    if (chainId !== GENLAYER_CHAIN_ID) {
      toast.error("Wrong network", {
        description: "Switch to GenLayer Studio Next to continue.",
      });
      openChainModal?.();
      return;
    }
    if (
      !config ||
      config.durationSeconds !== CROWN_DURATION_SECONDS ||
      !selectedSlot ||
      selectedState !== "AVAILABLE" ||
      selectedLookup?.data?.exists
    ) {
      return;
    }
    try {
      setTransaction({
        open: true,
        tx: crownTransaction("create_market", [
          BigInt(selectedSlot.startTimestamp),
          BigInt(config.durationSeconds),
        ]),
      });
    } catch (error) {
      const copy = getCrownErrorCopy(error);
      toast.error(copy.title, { description: copy.message });
    }
  };

  if (configQuery.isError) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-24 sm:px-6">
        <CrownErrorState
          title="Protocol configuration unavailable"
          message="We couldn't read Crown's current limits and timing rules."
          onRetry={() => void configQuery.refetch()}
        />
      </div>
    );
  }
  if (configQuery.isPending || !config) {
    return (
      <div className="mx-auto max-w-[720px] px-4 py-24 sm:px-6">
        <div className="surface p-10 text-center text-sm text-muted-foreground">
          Loading Crown protocol configuration…
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="surface p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
            <Crown className="h-4 w-4" /> Permissionless creation
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            Create a Crown market
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Choose an upcoming canonical 4-hour UTC window. Anyone can open a
            market; no admin approval is required.
          </p>
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium">Market date</label>
              <span className="text-xs text-muted-foreground">UTC date</span>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 w-full justify-between border-border bg-elevated text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-gold" />
                    {fmtUtcDate(
                      new Date(
                        timestampFromDateKey(dateKey) * 1000,
                      ).toISOString(),
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto border-border bg-card p-0"
                align="start"
              >
                <Calendar
                  mode="single"
                  selected={pickerDateFromKey(dateKey)}
                  onSelect={chooseDate}
                  disabled={{
                    before: pickerDateFromKey(
                      dateKeyFromTimestamp(Math.floor(Date.now() / 1000)),
                    ),
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>

          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium">
                Target market window
              </label>
              <span className="text-xs text-muted-foreground">4H only</span>
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {slots.map((slot, index) => {
                const state = states[index]!;
                const selected = selectedStart === slot.startTimestamp;
                const startISO = new Date(
                  slot.startTimestamp * 1000,
                ).toISOString();
                const endISO = new Date(slot.endTimestamp * 1000).toISOString();
                const marketId = lookupQueries[index]?.data?.exists
                  ? lookupQueries[index]?.data.marketId
                  : undefined;
                return state === "EXISTS" && marketId ? (
                  <div
                    key={slot.startTimestamp}
                    className="flex min-h-[88px] items-center gap-3 rounded-lg border border-border bg-elevated p-4"
                  >
                    <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-border-strong text-muted-foreground">
                      <CalendarClock className="h-4 w-4" />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {fmtUtcWindow(startISO, endISO)}
                      </span>
                      <span className="mt-1 block text-xs text-muted-foreground">
                        A Crown market already exists for this window.
                      </span>
                    </span>
                    <Link
                      to="/markets/$id"
                      params={{ id: String(marketId) }}
                      className="shrink-0 rounded-md border border-border-strong px-2.5 py-1.5 text-xs font-medium hover:border-gold/45 hover:text-gold"
                    >
                      View
                    </Link>
                  </div>
                ) : (
                  <div
                    key={slot.startTimestamp}
                    className={cn(
                      "flex min-h-[88px] items-center gap-3 rounded-lg border p-4 text-left transition-colors",
                      selected
                        ? "border-gold/55 bg-gold-soft"
                        : "border-border bg-elevated",
                      state !== "AVAILABLE" && "opacity-60",
                    )}
                  >
                    <span
                      className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
                        selected
                          ? "border-gold/50 text-gold"
                          : "border-border-strong text-muted-foreground",
                      )}
                    >
                      {selected ? (
                        <Check className="h-4 w-4" />
                      ) : (
                        <CalendarClock className="h-4 w-4" />
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">
                        {fmtUtcWindow(startISO, endISO)}
                      </span>
                      <span
                        className={cn(
                          "mt-1 block text-xs",
                          state === "AVAILABLE"
                            ? "text-success"
                            : "text-muted-foreground",
                        )}
                      >
                        {stateLabel(state)}
                      </span>
                    </span>
                    {state === "AVAILABLE" && (
                      <button
                        type="button"
                        onClick={() => {
                          setSelectedStart(slot.startTimestamp);
                          setCreatedMarketId(null);
                        }}
                        className="shrink-0 rounded-md border border-border-strong px-2.5 py-1.5 text-xs font-medium hover:border-gold/45 hover:text-gold"
                      >
                        Select
                      </button>
                    )}
                    {state === "ERROR" && (
                      <button
                        type="button"
                        onClick={() => void lookupQueries[index]?.refetch()}
                        className="shrink-0 rounded-md border border-border-strong px-2.5 py-1.5 text-xs font-medium hover:border-gold/45 hover:text-gold"
                      >
                        Retry
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          <div className="mt-6 flex items-start gap-3 rounded-lg border border-border bg-elevated/60 p-4 text-sm text-muted-foreground">
            <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-gold" />
            <p>
              Markets must start at least {minimumCreationLead} seconds from now
              and use a UTC-aligned native 4H candle boundary.
            </p>
          </div>
          {lookupError ? (
            <p className="mt-5 text-sm text-destructive">
              One or more windows could not be verified. Retry the affected
              slot.
            </p>
          ) : null}
          {existingMarketId ? (
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {createdMarketId ? "Market created" : "Market already exists"}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  One canonical Crown market per 4H window.
                </div>
              </div>
              <Link
                to="/markets/$id"
                params={{ id: String(existingMarketId) }}
                className="ml-auto inline-flex items-center gap-2 rounded-md bg-gold px-4 py-2.5 text-sm font-medium text-gold-foreground hover:bg-gold/90"
              >
                View Market
              </Link>
            </div>
          ) : (
            <Button
              className="mt-8 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90 sm:w-auto sm:px-8"
              onClick={() => void create()}
              disabled={
                !config ||
                selectedState !== "AVAILABLE" ||
                lookupQueries.some((query) => query.isLoading) ||
                Boolean(transaction)
              }
            >
              {!isConnected ? "Connect Wallet" : "Create Market"}
            </Button>
          )}
        </section>

        <aside className="surface h-fit p-6 lg:sticky lg:top-24">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-gold" /> Window preview
          </div>
          {preview ? (
            <>
              <div className="mt-4 rounded-lg border border-gold/35 bg-gold-soft p-4">
                <div className="text-xs text-muted-foreground">
                  Performance window
                </div>
                <div className="tabular mt-1 text-lg font-semibold">
                  {fmtUtcWindow(preview.startISO, preview.endISO)}
                </div>
              </div>
              <div className="mt-4 divide-y divide-border">
                <TimingRow label="Date" value={fmtUtcDate(preview.startISO)} />
                <TimingRow
                  label="Entry closes"
                  value={fmtUtcFull(
                    new Date(
                      (selectedSlot!.startTimestamp - bettingCloseLead) * 1000,
                    ).toISOString(),
                  )}
                />
                <TimingRow
                  label="Performance starts"
                  value={fmtUtcFull(preview.startISO)}
                />
                <TimingRow
                  label="Performance ends"
                  value={fmtUtcFull(preview.endISO)}
                />
                <TimingRow
                  label="Settlement eligible"
                  value={fmtUtcFull(
                    new Date(
                      (selectedSlot!.endTimestamp + settlementGrace) * 1000,
                    ).toISOString(),
                  )}
                />
                <TimingRow
                  label="Retry deadline"
                  value={fmtUtcFull(
                    new Date(
                      (selectedSlot!.endTimestamp +
                        settlementGrace +
                        retryWindow) *
                        1000,
                    ).toISOString(),
                  )}
                />
              </div>
              <div className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
                Betting closes {bettingCloseLead} seconds before the start.
                Settlement becomes ready {settlementGrace} seconds after the
                candle closes, with a {retryWindow / 60}-minute retry window.
              </div>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-border bg-elevated/60 p-6 text-center text-sm text-muted-foreground">
              Select an available window to preview its exact UTC timings.
            </div>
          )}
        </aside>
      </div>

      {transaction && preview && (
        <TransactionDialog
          open={transaction.open}
          onOpenChange={(open) => !open && setTransaction(null)}
          title="Create Crown market"
          details={[
            ["Window", fmtUtcWindow(preview.startISO, preview.endISO)],
            ["Start", fmtUtcFull(preview.startISO)],
            ["Duration", "4 hours"],
          ]}
          kit={kit}
          tx={transaction.tx}
          onAccepted={() => {
            void (async () => {
              try {
                await Promise.all([
                  queryClient.invalidateQueries({
                    queryKey: ["crown", "markets"],
                  }),
                  queryClient.invalidateQueries({
                    queryKey: ["crown", "open-markets"],
                  }),
                  queryClient.invalidateQueries({
                    queryKey: [
                      "crown",
                      "marketByStart",
                      selectedSlot!.startTimestamp,
                    ],
                  }),
                ]);
                const found = await getMarketByStart(
                  selectedSlot!.startTimestamp,
                );
                if (found.exists) setCreatedMarketId(found.marketId);
                toast.success("Crown market created", {
                  description: `${fmtUtcWindow(
                    new Date(selectedSlot!.startTimestamp * 1000).toISOString(),
                    new Date(selectedSlot!.endTimestamp * 1000).toISOString(),
                  )} is now available.`,
                });
              } catch (error) {
                const copy = getCrownErrorCopy(error);
                toast.error(copy.title, { description: copy.message });
              }
            })();
          }}
          onFailed={(status) => {
            const copy = getCrownErrorCopy(
              new Error(
                status.executionResultName ?? "Crown transaction failed",
              ),
            );
            toast.error(copy.title, { description: copy.message });
          }}
        />
      )}
    </div>
  );
}

function CreateMarketPage() {
  const [family, setFamily] = useState<"CRYPTO" | "ENERGY">("CRYPTO");
  return (
    <>
      <div className="mx-auto max-w-[1200px] px-4 pt-8 sm:px-6">
        <div className="inline-flex rounded-lg border border-border bg-elevated p-1">
          {(["CRYPTO", "ENERGY"] as const).map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setFamily(item)}
              className={cn(
                "rounded-md px-4 py-2 text-sm transition-colors",
                family === item
                  ? "bg-gold text-gold-foreground"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              {item === "CRYPTO" ? "Crypto" : "Energy"}
            </button>
          ))}
        </div>
      </div>
      {family === "CRYPTO" ? <CryptoCreateMarket /> : <EnergyCreateMarket />}
    </>
  );
}

function EnergyCreateMarket() {
  const { address, chainId, connector, isConnected } = useAccount();
  const kit = useCrownTransactionKit(address, connector);
  const { openConnectModal } = useConnectModal();
  const { openChainModal } = useChainModal();
  const queryClient = useQueryClient();
  const [dateKey, setDateKey] = useState(() =>
    dateKeyFromTimestamp(Math.floor(Date.now() / 1000)),
  );
  const [marketType, setMarketType] = useState<EnergyMarketType>("UP_DOWN");
  const [durationLabel, setDurationLabel] = useState<"1H" | "2H">("1H");
  const [asset, setAsset] = useState("WTI_CRUDE");
  const [selectedStart, setSelectedStart] = useState<number | null>(null);
  const [nowSeconds, setNowSeconds] = useState(() =>
    Math.floor(Date.now() / 1000),
  );
  const [transaction, setTransaction] = useState<{
    open: boolean;
    tx: CrownTransactionRequest;
  } | null>(null);
  useEffect(() => {
    const timer = window.setInterval(
      () => setNowSeconds(Math.floor(Date.now() / 1000)),
      30_000,
    );
    return () => window.clearInterval(timer);
  }, []);
  const configQuery = useQuery({
    queryKey: ["crown", "energy", "config"],
    queryFn: getEnergyConfig,
    staleTime: 300_000,
  });
  const durationSeconds =
    configQuery.data?.durations[durationLabel] === 7200 ? 7200 : 3600;
  const slots = useMemo(
    () => buildEnergySlots(dateKey, durationSeconds),
    [dateKey, durationSeconds],
  );
  const marketsQuery = useQuery({
    queryKey: ["crown", "energy", "markets", "create"],
    queryFn: () => getEnergyMarketsPage(0, 25),
    staleTime: 15_000,
  });
  const existingForSlot = (start: number) =>
    marketsQuery.data?.markets.find(
      (market) =>
        market.onchain.startTimestamp === BigInt(start) &&
        market.marketType === marketType &&
        market.durationSeconds === durationSeconds &&
        (marketType === "DOMINANCE" || market.asset === asset),
    );
  const selectedSlot = slots.find(
    (slot) => slot.startTimestamp === selectedStart,
  );
  const existingMarket =
    selectedStart === null ? undefined : existingForSlot(selectedStart);
  const available = Boolean(
    selectedSlot && selectedSlot.startTimestamp > nowSeconds && !existingMarket,
  );
  const chooseDate = (date: Date | undefined) => {
    if (!date) return;
    setDateKey(dateKeyFromCalendarDate(date));
    setSelectedStart(null);
  };
  const create = () => {
    if (!isConnected || !address) {
      openConnectModal?.();
      return;
    }
    if (chainId !== GENLAYER_CHAIN_ID) {
      toast.error("Wrong network", {
        description: "Switch to GenLayer Studio Next to continue.",
      });
      openChainModal?.();
      return;
    }
    if (!selectedSlot || !available) return;
    try {
      setTransaction({
        open: true,
        tx: crownEnergyTransaction(
          marketType === "UP_DOWN"
            ? "create_up_down_market"
            : "create_dominance_market",
          [
            marketType === "UP_DOWN" ? asset : "ENERGY",
            BigInt(selectedSlot.startTimestamp),
            BigInt(energyMarketDurationHours(durationSeconds)),
          ],
        ),
      });
    } catch (error) {
      const copy = getCrownErrorCopy(error);
      toast.error(copy.title, { description: copy.message });
    }
  };
  if (configQuery.isError)
    return (
      <div className="mx-auto max-w-[720px] px-4 py-24 sm:px-6">
        <CrownErrorState
          title="Energy configuration unavailable"
          message="We couldn't read the deployed Crown Energy configuration."
          onRetry={() => void configQuery.refetch()}
        />
      </div>
    );
  if (configQuery.isPending || !configQuery.data)
    return (
      <div className="mx-auto max-w-[720px] px-4 py-24 sm:px-6">
        <div className="surface p-10 text-center text-sm text-muted-foreground">
          Loading Energy protocol configuration…
        </div>
      </div>
    );
  const config = configQuery.data;
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <div className="grid gap-6 lg:grid-cols-[1fr_380px]">
        <section className="surface p-6 sm:p-8">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
            <Crown className="h-4 w-4" /> Permissionless Energy creation
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight">
            Create an Energy market
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-6 text-muted-foreground">
            Choose a canonical UTC-aligned 1H or 2H window. Energy markets use
            the deployed Crown Energy contract and the same multi-source
            settlement flow.
          </p>
          <div className="mt-8 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="text-sm font-medium">Market type</label>
              <div className="mt-2 flex gap-2">
                {(["UP_DOWN", "DOMINANCE"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setMarketType(item);
                      setSelectedStart(null);
                    }}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-xs",
                      marketType === item
                        ? "border-gold bg-gold-soft text-gold"
                        : "border-border bg-elevated",
                    )}
                  >
                    {item === "UP_DOWN" ? "Up / Down" : "Dominance"}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-sm font-medium">Duration</label>
              <div className="mt-2 flex gap-2">
                {(["1H", "2H"] as const).map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setDurationLabel(item);
                      setSelectedStart(null);
                    }}
                    className={cn(
                      "flex-1 rounded-md border px-3 py-2 text-xs",
                      durationLabel === item
                        ? "border-gold bg-gold-soft text-gold"
                        : "border-border bg-elevated",
                    )}
                  >
                    {item === "1H" ? "1 Hour" : "2 Hours"}
                  </button>
                ))}
              </div>
            </div>
          </div>
          {marketType === "UP_DOWN" ? (
            <div className="mt-5">
              <label className="text-sm font-medium">Asset</label>
              <div className="mt-2 grid grid-cols-3 gap-2">
                {config.assets.map((item) => (
                  <button
                    key={item}
                    type="button"
                    onClick={() => {
                      setAsset(item);
                      setSelectedStart(null);
                    }}
                    className={cn(
                      "rounded-md border px-2 py-3 text-xs",
                      asset === item
                        ? "border-gold bg-gold-soft text-gold"
                        : "border-border bg-elevated",
                    )}
                  >
                    {item === "WTI_CRUDE"
                      ? "WTI Crude"
                      : item === "BRENT_CRUDE"
                        ? "Brent"
                        : "Natural Gas"}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="mt-5 rounded-lg border border-border bg-elevated/60 p-3 text-sm text-muted-foreground">
              Category is fixed to{" "}
              <span className="font-semibold text-foreground">ENERGY</span>.
            </div>
          )}
          <div className="mt-8">
            <div className="mb-3 flex items-center justify-between">
              <label className="text-sm font-medium">Market date</label>
              <span className="text-xs text-muted-foreground">UTC date</span>
            </div>
            <Popover>
              <PopoverTrigger asChild>
                <Button
                  variant="outline"
                  className="h-11 w-full justify-between border-border bg-elevated text-left font-normal"
                >
                  <span className="flex items-center gap-2">
                    <CalendarDays className="h-4 w-4 text-gold" />
                    {fmtUtcDate(
                      new Date(
                        timestampFromDateKey(dateKey) * 1000,
                      ).toISOString(),
                    )}
                  </span>
                  <ChevronDown className="h-4 w-4 text-muted-foreground" />
                </Button>
              </PopoverTrigger>
              <PopoverContent
                className="w-auto border-border bg-card p-0"
                align="start"
              >
                <Calendar
                  mode="single"
                  selected={pickerDateFromKey(dateKey)}
                  onSelect={chooseDate}
                  disabled={{
                    before: pickerDateFromKey(
                      dateKeyFromTimestamp(Math.floor(Date.now() / 1000)),
                    ),
                  }}
                  initialFocus
                />
              </PopoverContent>
            </Popover>
          </div>
          <div className="mt-8">
            <label className="text-sm font-medium">Canonical UTC slot</label>
            <div className="mt-3 grid gap-2 sm:grid-cols-2">
              {slots.map((slot) => {
                const existing = existingForSlot(slot.startTimestamp);
                const past = slot.startTimestamp <= nowSeconds;
                const selected = selectedStart === slot.startTimestamp;
                return existing ? (
                  <div
                    key={slot.startTimestamp}
                    className="flex min-h-[72px] items-center justify-between rounded-lg border border-border bg-elevated p-3"
                  >
                    <span>
                      <span className="block text-sm font-medium">
                        {fmtUtcWindow(
                          new Date(slot.startTimestamp * 1000).toISOString(),
                          new Date(slot.endTimestamp * 1000).toISOString(),
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        Already exists
                      </span>
                    </span>
                    <Link
                      to="/energy/$id"
                      params={{ id: String(existing.id) }}
                      className="text-xs text-gold hover:underline"
                    >
                      View
                    </Link>
                  </div>
                ) : (
                  <button
                    key={slot.startTimestamp}
                    type="button"
                    disabled={past}
                    onClick={() => setSelectedStart(slot.startTimestamp)}
                    className={cn(
                      "flex min-h-[72px] items-center gap-3 rounded-lg border p-3 text-left",
                      selected
                        ? "border-gold bg-gold-soft"
                        : "border-border bg-elevated",
                      past && "opacity-50",
                    )}
                  >
                    <span className="flex h-7 w-7 items-center justify-center rounded-full border border-border-strong">
                      {selected ? (
                        <Check className="h-4 w-4 text-gold" />
                      ) : (
                        <CalendarClock className="h-4 w-4" />
                      )}
                    </span>
                    <span>
                      <span className="block text-sm font-medium">
                        {fmtUtcWindow(
                          new Date(slot.startTimestamp * 1000).toISOString(),
                          new Date(slot.endTimestamp * 1000).toISOString(),
                        )}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {past ? "Past" : "Available"}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <Button
            className="mt-8 h-11 w-full bg-gold text-gold-foreground hover:bg-gold/90 sm:w-auto sm:px-8"
            onClick={create}
            disabled={!available || Boolean(transaction)}
          >
            {!isConnected ? "Connect Wallet" : "Create Energy Market"}
          </Button>
        </section>
        <aside className="surface h-fit p-6 lg:sticky lg:top-24">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="h-4 w-4 text-gold" /> Window preview
          </div>
          {selectedSlot ? (
            <>
              <div className="mt-4 rounded-lg border border-gold/35 bg-gold-soft p-4">
                <div className="text-xs text-muted-foreground">
                  Performance window
                </div>
                <div className="tabular mt-1 text-lg font-semibold">
                  {fmtUtcWindow(
                    new Date(selectedSlot.startTimestamp * 1000).toISOString(),
                    new Date(selectedSlot.endTimestamp * 1000).toISOString(),
                  )}
                </div>
              </div>
              <div className="mt-4 divide-y divide-border">
                <TimingRow
                  label="Performance starts"
                  value={fmtUtcFull(
                    new Date(selectedSlot.startTimestamp * 1000).toISOString(),
                  )}
                />
                <TimingRow
                  label="Performance ends"
                  value={fmtUtcFull(
                    new Date(selectedSlot.endTimestamp * 1000).toISOString(),
                  )}
                />
                <TimingRow
                  label="Retry deadline"
                  value={fmtUtcFull(
                    new Date(
                      (selectedSlot.endTimestamp + config.retryWindowSeconds) *
                        1000,
                    ).toISOString(),
                  )}
                />
              </div>
              <p className="mt-5 border-t border-border pt-4 text-xs leading-5 text-muted-foreground">
                Bets close when the exact window starts. Settlement may be
                retried for {config.retryWindowSeconds / 3600} hours.
              </p>
            </>
          ) : (
            <div className="mt-4 rounded-lg border border-border bg-elevated/60 p-6 text-center text-sm text-muted-foreground">
              Select an available UTC slot to preview its timing.
            </div>
          )}
        </aside>
      </div>
      {transaction && selectedSlot && (
        <TransactionDialog
          open={transaction.open}
          onOpenChange={(open) => !open && setTransaction(null)}
          title="Create Energy market"
          details={[
            ["Type", marketType === "UP_DOWN" ? "Up / Down" : "Dominance"],
            ["Subject", marketType === "UP_DOWN" ? asset : "ENERGY"],
            [
              "Window",
              fmtUtcWindow(
                new Date(selectedSlot.startTimestamp * 1000).toISOString(),
                new Date(selectedSlot.endTimestamp * 1000).toISOString(),
              ),
            ],
            ["Duration", durationLabel],
          ]}
          kit={kit}
          tx={transaction.tx}
          onAccepted={() => {
            void queryClient.invalidateQueries({
              queryKey: ["crown", "energy", "markets"],
            });
            setTransaction(null);
            toast.success("Energy market created");
          }}
          onFailed={(status) =>
            toast.error("Energy transaction failed", {
              description:
                status.executionResultName ??
                "The contract rejected the transaction.",
            })
          }
        />
      )}
    </div>
  );
}
