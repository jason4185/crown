# Crown architecture

## Responsibility boundary

Crown owns market creation, timestamp-derived lifecycle, position accounting,
source normalization, two-of-three source-winner consensus, and direct claims.
No caller supplies a winner, source result, payout recipient, or payout amount.
The caller of `settle_market` only advances a market after its performance
window has ended.

The validator path re-fetches and independently derives the same bounded
proposal as the leader. Equivalence compares the normalized financial decision:
whether a valid source consensus winner exists and, if so, which asset it is.
For a positive result, both executions must also share at least two distinct
`VALID` source/winner pairs for that asset. This protects the actual 2-of-3
source proof; comparing only the final asset would allow different source pairs
to pass. A nonessential provider may recover or fail between executions. When
there is no winner, the retryability bit (whether any source is
`UNAVAILABLE`) must match. Redundant counts, non-witness source metadata, raw
JSON, response ordering, and free-form external text are not consensus state.
External pages are untrusted evidence; no page content is used as an
instruction to the contract.

If the nondeterministic executions cannot establish this equivalence, Crown
leaves the market unresolved before the retry deadline. At or after the
deadline, a failed equivalence attempt safely finalizes refund-only
INCONCLUSIVE rather than leaving a market permanently stuck.

## Time and identity

The transaction timestamp is parsed from `gl.message_raw["datetime"]`. A market
uses one performance start (`start_timestamp`) and one end (`start + 14400`);
betting closes 60 seconds before the start. Creation requires a future,
4H-aligned UTC start (`start_timestamp % 14400 == 0`), five minutes of creation
lead time, and the sole approved duration of 14,400 seconds. `CROWN|V1|4H|start`
is the duplicate key, so an identical aligned basket/window cannot be created
twice.

Lifecycle is derived from these timestamps plus the fixed 60-second settlement
grace: `OPEN` while betting is open, `LOCKED` after betting closes but before
performance begins, `LIVE` during performance, `FINALIZING` after the window
while the grace is active, and `SETTLEMENT_READY` afterward. If evidence is
temporarily unavailable, the market remains unresolved while callers retry for
the derived 1,800-second settlement retry window; after that deadline it is
finalized inconclusive.

Addresses are normalized through `Address(user.as_bytes)` and keyed by the
canonical base64 byte representation. This is used consistently for positions
and claims.

## Storage model

The contract declares only:

- `market_count: u256`
- `market_records: TreeMap[str, str]`
- `market_identity: TreeMap[str, u256]`
- `position_records: TreeMap[str, str]`

Records are compact JSON strings containing bounded scalar fields. The contract
does not declare DynArray storage or store participant enumeration. Every write
is a direct market or position lookup. Pagination uses raw market IDs with a
fixed maximum page/scan budget, making its cost independent of historical
participant count.

## Money safety

Stakes are fixed-point GEN integers. Same-asset top-ups are checked against the
10 GEN cumulative cap before either map is written. A resolved claim uses
`stake * total_pool // total_winning_stake`; the final winning claimant receives
the remaining pool amount. Inconclusive claims return original stake only.
Claim accounting is persisted before the finalized transfer and a claimed
position cannot be claimed again.

## Error classes

Deterministic caller/state errors use the `[EXPECTED]` prefix and revert before
mutation. External retrieval is converted into bounded source statuses:
`VALID`, `UNAVAILABLE`, `INVALID`, or `TIE`; it is never allowed to turn into an
unbounded retry or a caller-controlled resolution. The source adapters retry
only transient/unavailable outcomes, at most three attempts per source per
settlement execution. Only `UNAVAILABLE` keeps a market retryable before the
market retry deadline. `INVALID` and `TIE` are completed non-votes;
invalid-only insufficiency is finalized inconclusive without waiting.
