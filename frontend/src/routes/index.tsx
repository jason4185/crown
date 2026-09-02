import { createFileRoute } from "@tanstack/react-router";
import { MarketsPage } from "./markets.index";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Crown — 4H Crypto Relative Performance Markets" },
      {
        name: "description",
        content:
          "Crown is a permissionless GenLayer market: predict which of BTC, ETH, SOL, BNB or XRP performs best over each canonical 4-hour UTC window.",
      },
      {
        property: "og:title",
        content: "Crown — 4H Crypto Relative Performance Markets",
      },
      {
        property: "og:description",
        content:
          "Stake 1–10 GEN on one asset. 2-of-3 exchange consensus decides the Crown.",
      },
    ],
  }),
  component: MarketsPage,
});
