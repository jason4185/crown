# Crown settlement policy

## Common window

V1 is strictly one native 4H candle: duration 14400, with
start_timestamp % 14400 == 0. Valid UTC windows begin at 00:00, 04:00,
08:00, 12:00, 16:00, or 20:00. Creation requires five minutes of lead time,
betting closes 60 seconds before start, and settlement begins only 60 seconds
after the performance end. This grace prevents settlement against a still
forming candle. The retry deadline is settlement_ready_timestamp + 1800.

Each source receives one bounded request per asset:

- Binance Spot /api/v3/klines: interval=4h, timeZone=0, exact millisecond
  startTime, endTime=start+4h-1ms, and limit=1. Row 0 is the candle open
  timestamp, row 1 is open, row 4 is close, and row 6 is the close boundary.
- Bitget Spot /api/v3/market/candles: category=SPOT, exact symbol,
  interval=4H, exact millisecond startTime/endTime, type=MARKET, and limit=1.
  The seven-field row is timestamp, open, high, low, close, base volume, and
  quote turnover.
- Gate Spot /api/v4/spot/candlesticks: exact currency_pair, interval=4h,
  second-based from and to. Gate's documented example row contains timestamp,
  quote volume, close, high, low, open; its response schema may include base
  volume at index 6. Gate treats to as inclusive, so Crown requests to=end-1
  to exclude the adjacent next candle. Current live REST responses may append
  a w close marker serialized as true or "true"; when present Crown requires
  that exact value, but does not depend on it for financial correctness. The
  fixed post-close grace and exact historical timestamp are authoritative when
  the marker is absent. Gate rejects limit when from or to is used, so Crown
  validates that exactly one row is returned instead.

All three requests target the same UTC opening second. Binance and Bitget
timestamps must equal start * 1000; Gate must equal start. A wrong, adjacent,
stale, future, or ambiguous row is INVALID. Prices are parsed as positive
18-decimal integers. No raw response is stored.

Official references: Binance Spot market data
(https://developers.binance.com/en/docs/catalog/core-trading-spot-trading/api/rest-api/market),
Bitget v3 candle data
(https://www.bitget.com/api-doc/uta/public/Get-Candle-Data),
and Gate API v4 spot candlesticks
(https://www.gate.com/en-us/docs/developers/apiv4/#spot-candlesticks). Gate's
close-window marker semantics are documented in its spot candlestick protocol
(https://www.gate.com/docs/developers/apiv4/ws/en/).

## Return normalization

For each asset and source:

normalized_return = trunc_toward_zero((close - open) * 10^12 / open)

The largest normalized return wins that source. If the maximum occurs more than
once, the source is TIE and casts no vote. There is no ranking score, average,
venue weighting, or dominance score.

## Consensus and retry

Only VALID source winners vote. A financial winner requires two independent
valid votes for the same asset. TIE, INVALID, and UNAVAILABLE never vote.

UNAVAILABLE means a temporary network/HTTP failure after at most three
attempts. If unresolved evidence includes an unavailable source, Crown remains
UNRESOLVED before the 1,800-second retry deadline, and anyone may call
settle_market again. A 2-of-3 winner resolves immediately, including when the
third source is unavailable. If all three sources are valid but disagree, Crown
is immediately INCONCLUSIVE; it does not retry completed disagreement.
After the deadline, any unresolved insufficient evidence becomes
INCONCLUSIVE. Invalid-only insufficiency is also finalized without waiting.

If a consensus winner has no stake, the market is INCONCLUSIVE so every
participant can refund. Inconclusive claims return the original stake.
Resolved winners claim:

user stake * total pool // total winning stake

Floor rounding is used; the final winning claimant receives the remaining pool
dust. No payout loop or keeper exists.
