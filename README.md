# Crown

Crown is a permissionless GenLayer prediction market with two market families:
Crypto relative-performance markets and Energy prediction markets. Contract
state is the source of truth for markets, positions, settlement, payouts, and
refunds.

## Live

- Live App: [crown-teal.vercel.app](https://crown-teal.vercel.app/)
- GitHub: [github.com/jason4185/crown](https://github.com/jason4185/crown)
- Network: GenLayer Studio Next / Studio-dev preview
- Chain ID: `61997`
- RPC: `https://studio-next.genlayer.com/api`
- Explorer: [explorer-studio-dev.genlayer.com](https://explorer-studio-dev.genlayer.com/)
- Crypto Crown contract: `0xc8B2A0d62dD42A0c8e1607994e347F2a9bf566F7`
- Crown Energy contract: `0x03EbF39d511809bDcEC74F3740260dc5E136F46f`

## What Crown Does

### Crypto

Crypto Crown asks which of `BTC`, `ETH`, `SOL`, `BNB`, or `XRP` has the highest
percentage return over the same exact 4-hour UTC window. Windows are aligned to
`00:00`, `04:00`, `08:00`, `12:00`, `16:00`, and `20:00` UTC.

### Energy

Crown Energy supports:

- Up/Down markets for WTI Crude, Brent Crude, and Natural Gas.
- Energy Dominance markets comparing those three assets.
- Exact 1-hour and 2-hour UTC windows.

## How Settlement Works

Crypto settlement uses one exact native 4-hour candle per asset from Binance,
Bitget, and Gate. Energy settlement uses the configured Binance, Gate, and
Bitget source adapters, with exact 1-hour data and the protocol's proven
two-candle 1-hour aggregation path for 2-hour markets. Both families require
2-of-3 valid source agreement.

Markets are permissionless to create and settle. Pools use pari-mutuel integer
payouts. Inconclusive markets refund participant stakes, and users claim their
own payout or refund. Temporary source failures remain retryable according to
the relevant contract's retry policy.

## Milestone Update — Studio Next + Energy

Crown was originally accepted as a Bradbury-based, crypto-only 4-hour
relative-performance prediction market. This milestone migrates Crown to
GenLayer Studio Next and expands the product with a second intelligent contract
for Energy prediction markets.

The Energy family supports WTI Crude, Brent Crude, and Natural Gas through 1H/2H
Up/Down and Energy Dominance markets. The frontend presents Crypto and Energy as
one Crown product while routing each family to its correct deployed contract.

The milestone also adds Transaction Kit RC2 integration and has been tested
end-to-end with real market creation, betting, settlement, and claim/refund
paths where applicable.

## Frontend

The frontend uses RainbowKit with injected wallets, genlayer-js `2.0.0-rc.1`,
and Transaction Kit RC2 (`@genlayer/transaction-kit` and
`@genlayer/transaction-kit-react` `0.1.0-rc.2`). The informational Crypto chart
does not determine settlement; the contracts remain authoritative.

## Local Development

```bash
cd frontend
bun install
bun run dev
```

Open the local Vite URL, normally `http://localhost:5173`.
