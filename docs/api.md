# Crown read/write API

All IDs, timestamps, and amounts are integers. V1 has one duration: 14400
seconds.

## Writes

| Method | Behavior |
| --- | --- |
| create_market(start_timestamp, duration) | Permissionless creation of one canonical aligned 4H window. |
| place_position(market_id, asset) | Payable one-side position or same-side top-up before close. |
| settle_market(market_id) | Permissionless after the 60-second grace; retries unresolved temporary failures until the derived 30-minute deadline. |
| claim(market_id) | Pays a winning entitlement or an inconclusive refund; returns the amount. |

Each payable call accepts 1–10 GEN, and one wallet's cumulative stake is capped
at 10 GEN. A wallet can choose only one of BTC, ETH, SOL, BNB, XRP.

## Reads

get_market returns all lifecycle timestamps, the derived status, retry deadline,
all five pools, winner and consensus fields, plus betting/settlement availability
and claim accounting helpers. Its status is OPEN, LOCKED, LIVE, FINALIZING,
SETTLEMENT_READY, RESOLVED, or INCONCLUSIVE.

get_user_position returns has_position, selected_asset, total_stake,
remaining_stake_capacity, can_top_up, position_won, position_lost,
claim_available, already_claimed, claimable_amount, and claim_type
(PAYOUT, REFUND, or NONE).

get_resolution returns status, binance_status/binance_winner,
bitget_status/bitget_winner, gate_status/gate_winner, valid_source_count,
final_winner, and consensus_count. Source statuses are VALID, UNAVAILABLE,
INVALID, or TIE.

get_markets and get_open_markets use bounded raw-ID pagination. Pages are capped
at 25; open-market scans are capped at 100 raw IDs. Previews include market ID,
start, betting close, performance end, status, total pool, all five pools, and
winner. Open pagination documents its bounded scan through scanned_count,
next_offset, and has_more.

get_market_by_start is an O(1) lookup for the identity
CROWN|V1|4H|start_timestamp and returns exists plus market_id. Invalid or
unaligned starts return exists=false.

get_protocol_config returns the fixed asset basket, duration/durations_seconds
containing only 14400, stake limits, Binance/Bitget/Gate sources, threshold,
creation/betting/grace/retry timing, UTC, NATIVE_4H_CANDLES strategy,
fixed-point precision, payout rounding, and zero-backed winner policy.

There is intentionally no user-history enumeration and no raw HTTP read.
