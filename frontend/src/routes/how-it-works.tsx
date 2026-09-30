import { createFileRoute, Link } from "@tanstack/react-router";
import {
  ArrowRight,
  Check,
  Crown,
  GitBranch,
  ShieldCheck,
  Timer,
} from "lucide-react";

import { AssetIcon } from "@/components/crown/AssetIcon";
import { ASSETS } from "@/lib/crown/presentation";

export const Route = createFileRoute("/how-it-works")({
  head: () => ({
    meta: [
      { title: "How Crown works" },
      {
        name: "description",
        content:
          "Learn how Crown settles Crypto and Energy markets across exact UTC windows.",
      },
    ],
  }),
  component: HowItWorksPage,
});

const STEPS = [
  {
    title: "Pick a Crown market",
    text: "Choose a Crypto 4-hour window or an Energy 1-hour / 2-hour window with fixed UTC boundaries.",
  },
  {
    title: "Choose one outcome",
    text: "Back one Crypto asset, Energy UP/DOWN outcome, or Energy dominance asset. One wallet chooses one outcome per market.",
  },
  {
    title: "Stake GEN",
    text: "Crypto accepts 1–10 GEN per wallet per market; Energy accepts 1–40 GEN cumulatively.",
  },
  {
    title: "Wait for the exact window",
    text: "Crypto uses native 4H boundaries; Energy uses aligned native 1H or proven 2H windows.",
  },
  {
    title: "Three sources calculate",
    text: "Binance, Gate, and Bitget independently verify the relevant Crypto or Energy result.",
  },
  {
    title: "Consensus settles Crown",
    text: "At least two valid sources must agree. Winners claim pari-mutuel payouts; inconclusive users claim refunds.",
  },
];

function HowItWorksPage() {
  return (
    <div className="mx-auto max-w-[1200px] px-4 py-10 sm:px-6">
      <section className="surface overflow-hidden p-6 sm:p-10">
        <div className="max-w-3xl">
          <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-gold">
            <Crown className="h-4 w-4" /> How Crown works
          </div>
          <h1 className="mt-4 text-3xl font-semibold tracking-tight sm:text-4xl">
            Pick an asset. Wait. Claim.
          </h1>
          <p className="mt-4 text-base leading-7 text-muted-foreground">
            Crown is one product with two market families. Crypto compares the
            percentage return of BTC, ETH, SOL, BNB, and XRP over an exact 4H
            UTC window. Energy supports UP/DOWN markets and dominance markets
            for WTI Crude, Brent, and Natural Gas over exact 1H or 2H windows.
            There are no probability estimates — only pari-mutuel pools.
          </p>
        </div>

        <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {STEPS.map((step, index) => (
            <article
              key={step.title}
              className="rounded-xl border border-border bg-elevated/60 p-5"
            >
              <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gold/45 bg-gold-soft text-sm font-semibold text-gold">
                {index + 1}
              </div>
              <h2 className="mt-5 text-sm font-semibold">{step.title}</h2>
              <p className="mt-2 text-sm leading-6 text-muted-foreground">
                {step.text}
              </p>
            </article>
          ))}
        </div>
      </section>

      <section className="mt-6 grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
        <div className="surface p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <GitBranch className="h-4 w-4 text-gold" /> Consensus flow
          </div>
          <div className="mt-6 rounded-xl border border-border bg-elevated/50 p-5">
            <div className="flex items-center gap-3 text-sm font-semibold">
              <Timer className="h-4 w-4 text-gold" /> Crown multi-source windows
            </div>
            <div className="my-5 h-px bg-border" />
            <div className="grid gap-3 sm:grid-cols-3">
              {["Binance", "Bitget", "Gate"].map((source) => (
                <div
                  key={source}
                  className="rounded-lg border border-border bg-card p-4 text-center"
                >
                  <div className="text-sm font-medium">{source}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    Verifies the configured market result
                  </div>
                </div>
              ))}
            </div>
            <div className="my-5 flex items-center justify-center gap-2 text-sm text-muted-foreground">
              <ArrowRight className="h-4 w-4" /> 2 of 3 consensus
            </div>
            <div className="flex flex-wrap items-center justify-center gap-2 rounded-lg border border-gold/35 bg-gold-soft p-3 text-sm font-medium text-gold">
              <Check className="h-4 w-4" /> Winner / Retry / Inconclusive
            </div>
          </div>
        </div>

        <div className="surface p-6 sm:p-8">
          <div className="flex items-center gap-2 text-sm font-semibold">
            <ShieldCheck className="h-4 w-4 text-gold" /> What is measured?
          </div>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            Each source uses the exact configured market window and computes:
          </p>
          <div className="mt-4 rounded-lg border border-border bg-elevated p-4 text-center font-mono text-sm text-foreground">
            (Close − Open) / Open
          </div>
          <div className="mt-5 flex flex-wrap gap-2">
            {ASSETS.map((asset) => (
              <span
                key={asset}
                className="inline-flex items-center gap-2 rounded-full border border-border bg-elevated px-3 py-1.5 text-xs"
              >
                <AssetIcon asset={asset} size="sm" /> {asset}
              </span>
            ))}
          </div>
          <div className="mt-5 rounded-lg border border-border bg-elevated p-4 text-sm leading-6 text-muted-foreground">
            Energy markets use WTI Crude, Brent, and Natural Gas. UP/DOWN
            follows price direction; Dominance selects the highest percentage
            return. Both contracts require 2-of-3 source consensus.
          </div>
          <p className="mt-5 text-sm leading-6 text-muted-foreground">
            Temporary source failures can keep settlement unresolved during the
            retry window. If no valid consensus is established, the market
            becomes INCONCLUSIVE and original stakes are refundable.
          </p>
        </div>
      </section>

      <div className="mt-6 flex justify-center">
        <Link
          to="/markets"
          search={{ q: "" }}
          className="inline-flex items-center gap-2 rounded-md bg-gold px-5 py-2.5 text-sm font-medium text-gold-foreground hover:bg-gold/90"
        >
          Browse Crown markets <ArrowRight className="h-4 w-4" />
        </Link>
      </div>
    </div>
  );
}
