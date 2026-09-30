import { Link } from "@tanstack/react-router";
import { ArrowRight, Flame } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { Countdown } from "./Countdown";
import {
  energyMarketTitle,
  energyOutcomeLabel,
  energyPoolEntries,
  type EnergyMarket,
} from "@/lib/crown/energy";
import { fmtGen, fmtUtcDate, fmtUtcWindow } from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";

export function EnergyMarketCard({ market }: { market: EnergyMarket }) {
  const total = market.pools
    ? Object.values(market.pools).reduce((sum, value) => sum + value, 0)
    : 0;
  const entries = energyPoolEntries(market);
  return (
    <article className="surface group flex flex-col p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span className="text-gold">Energy</span>
            <span>·</span>
            <span>{market.durationLabel}</span>
          </div>
          <div className="mt-1 text-xs text-muted-foreground">
            {fmtUtcDate(market.startISO)} ·{" "}
            {fmtUtcWindow(market.startISO, market.endISO)}
          </div>
        </div>
        <StatusBadge status={market.status} />
      </div>

      <h3 className="mt-4 flex items-center gap-2 text-base font-semibold">
        <Flame className="h-4 w-4 text-gold" /> {energyMarketTitle(market)}
      </h3>
      <div className="mt-1 text-xs text-muted-foreground">
        {market.marketType === "UP_DOWN" ? market.asset : "ENERGY basket"} ·
        Total pool{" "}
        <span className="tabular text-foreground">{fmtGen(total)}</span>
      </div>

      <ul className="mt-4 space-y-1.5">
        {entries.map(({ key, amount }) => {
          const share = total === 0 ? 0 : (amount / total) * 100;
          const isWinner = market.winner === key;
          return (
            <li
              key={key}
              className={cn(
                "relative flex items-center gap-3 overflow-hidden rounded-lg border border-transparent px-2 py-2",
                isWinner && "gold-ring bg-gold-soft",
              )}
            >
              <span
                className="absolute inset-y-0 left-0 rounded-lg bg-gold opacity-[0.10]"
                style={{ width: `${share}%` }}
              />
              <span className="relative inline-flex h-6 w-6 items-center justify-center rounded-full border border-gold/35 bg-gold-soft text-[10px] font-semibold text-gold">
                {key === "UP" ? "↑" : key === "DOWN" ? "↓" : "E"}
              </span>
              <span className="relative text-sm font-medium">
                {energyOutcomeLabel(key)}
              </span>
              {isWinner && (
                <span className="relative text-[10px] font-semibold uppercase tracking-wider text-gold">
                  Crown
                </span>
              )}
              <span className="tabular relative ml-auto text-sm">
                {fmtGen(amount)}
              </span>
              <span className="tabular relative w-20 text-right text-xs text-muted-foreground">
                {share.toFixed(1)}% of pool
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex items-center justify-between border-t border-border pt-4">
        <div className="text-xs text-muted-foreground">
          {market.status === "OPEN" && (
            <>
              Betting open until market start ·{" "}
              <Countdown
                targetISO={market.startISO}
                className="text-foreground"
              />
            </>
          )}
          {market.status === "LIVE" && (
            <>
              Ends in{" "}
              <Countdown
                targetISO={market.endISO}
                className="text-foreground"
              />
            </>
          )}
          {market.status === "FINALIZING" &&
            "Performance window ended — settlement pending"}
          {market.status === "SETTLEMENT_READY" &&
            "Ready for permissionless settlement"}
          {market.status === "RESOLVED" &&
            market.winner &&
            `Winner: ${energyOutcomeLabel(market.winner)}`}
          {market.status === "INCONCLUSIVE" &&
            "Inconclusive — original stakes refundable"}
        </div>
        <Link
          to="/energy/$id"
          params={{ id: String(market.id) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium transition-colors hover:border-gold/45 hover:text-gold"
        >
          View Market <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}
