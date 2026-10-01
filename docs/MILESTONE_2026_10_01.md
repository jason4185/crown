# Crown Milestone — October 1, 2026

## Accepted State

Crown was accepted as a Bradbury-based, crypto-only 4-hour relative-performance
market for BTC, ETH, SOL, BNB, and XRP.

## Milestone Changes

- Migrated Crown to GenLayer Studio Next, chain ID `61997`.
- Added Studio Next Transaction Kit RC2 integration.
- Added a separate Crown Energy intelligent contract.
- Added Energy Up/Down and Energy Dominance markets for WTI Crude, Brent Crude,
  and Natural Gas over 1H and 2H windows.
- Unified Crypto and Energy in one contract-backed frontend.

## Deployed Contracts

- Crypto Crown: `0xc8B2A0d62dD42A0c8e1607994e347F2a9bf566F7`
  - Source SHA-256: `3b4866dc80dbe97090ad1947eedf02c7c27f27360117b3d04a338e819f573a37`
- Crown Energy: `0x03EbF39d511809bDcEC74F3740260dc5E136F46f`
  - Source SHA-256: `86db2e688c4f5080ba45b22a3d15417e98c000ee0c83ef3f99a09a4d03ded0e3`

## Verification

- Crypto reads were verified on Studio Next in accepted and finalized state.
- Crypto `create_market` was verified live with a successful real transaction.
- Energy reads were verified on Studio Next.
- Energy market creation, betting, and settlement were tested end-to-end.
- Frontend typecheck, lint, and production build passed.

## Evidence

- [GitHub repository](https://github.com/jason4185/crown)
- [Live Crown app](https://crown-teal.vercel.app/)
- [Studio Next explorer](https://explorer-studio-dev.genlayer.com/)
