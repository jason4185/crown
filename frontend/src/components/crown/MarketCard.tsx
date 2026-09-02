import { Link } from "@tanstack/react-router";
import { ArrowRight, Crown } from "lucide-react";
import { AssetIcon } from "./AssetIcon";
import { StatusBadge } from "./StatusBadge";
import { Countdown } from "./Countdown";
import {
  ASSETS,
  fmtGen,
  fmtUtcDate,
  fmtUtcWindow,
  marketTimeline,
  poolSharePct,
  totalPool,
  type Market,
} from "@/lib/crown/presentation";
import { cn } from "@/lib/utils";

export function MarketCard({ market }: { market: Market }) {
  const total = totalPool(market);
  const timeline = marketTimeline(market);

  return (
    <article className="surface group flex flex-col p-5 transition-colors hover:border-border-strong">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{fmtUtcDate(market.startISO)}</span>
          </div>
          <div className="tabular mt-1 text-xs text-muted-foreground">
            {fmtUtcWindow(market.startISO, market.endISO)}
          </div>
        </div>
        <StatusBadge status={market.status} />
      </div>

      <h3 className="mt-4 flex items-center gap-2 text-base font-semibold">
        <Crown className="h-4 w-4 text-gold" />
        Which crypto takes the Crown?
      </h3>

      <div className="mt-1 text-xs text-muted-foreground">
        Total pool{" "}
        <span className="tabular text-foreground">{fmtGen(total)}</span>
      </div>

      <ul className="mt-4 space-y-1.5">
        {ASSETS.map((asset) => {
          const share = poolSharePct(market, asset);
          const isWinner = market.winner === asset;
          return (
            <li
              key={asset}
              className={cn(
                "relative flex items-center gap-3 overflow-hidden rounded-lg border border-transparent px-2 py-1.5",
                isWinner && "gold-ring bg-gold-soft",
              )}
            >
              <span
                className="absolute inset-y-0 left-0 -z-0 rounded-lg opacity-[0.10]"
                style={{
                  width: `${share}%`,
                  backgroundColor: `var(--${asset.toLowerCase()})`,
                }}
              />
              <AssetIcon asset={asset} size="sm" className="relative" />
              <span className="relative text-sm font-medium">{asset}</span>
              {isWinner && (
                <span className="relative text-[10px] font-semibold uppercase tracking-wider text-gold">
                  Crown
                </span>
              )}
              <span className="tabular relative ml-auto text-sm">
                {fmtGen(market.pools[asset])}
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
              Betting closes in{" "}
              <Countdown
                targetISO={timeline.bettingCloses}
                className="text-foreground"
              />
            </>
          )}
          {market.status === "LOCKED" &&
            "Predictions closed — window starts shortly"}
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
            "Performance window ended — settlement grace active"}
          {market.status === "SETTLEMENT_READY" &&
            "Ready for permissionless settlement"}
          {market.status === "RESOLVED" &&
            market.winner &&
            `Winner: ${market.winner}`}
          {market.status === "INCONCLUSIVE" &&
            "Inconclusive — original stakes refundable"}
        </div>
        <Link
          to="/markets/$id"
          params={{ id: String(market.id) }}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-elevated px-3 py-1.5 text-xs font-medium transition-colors hover:border-gold/45 hover:text-gold"
        >
          View Market <ArrowRight className="h-3.5 w-3.5" />
        </Link>
      </div>
    </article>
  );
}
