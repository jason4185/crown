# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

"""Crown: a permissionless five-asset relative-performance market.

All persistent collections are flat TreeMaps.  Source responses are never
stored: only the bounded, normalized settlement proof is persisted.
"""

import json
import typing

import genlayer as gl
from genlayer.contract import Contract
from genlayer.storage import TreeMap
from genlayer.types import Address, u256


GEN = u256(10**18)
MIN_STAKE = u256(1) * GEN
MAX_STAKE = u256(10) * GEN
U256_MAX = 2**256 - 1

ASSETS = ("BTC", "ETH", "SOL", "BNB", "XRP")
DURATION_4H_SECONDS = u256(14400)
DURATIONS = (DURATION_4H_SECONDS,)
SOURCE_NAMES = ("BINANCE", "BITGET", "GATE")

RETURN_SCALE = 10**12
PRICE_SCALE = 10**18
MAX_DECIMAL_CHARS = 80
MAX_RESPONSE_BYTES = 120000
MAX_PAGE = 25
MAX_OPEN_SCAN = 100
MAX_SOURCE_ATTEMPTS = 3
MIN_CREATION_LEAD_SECONDS = 300
BETTING_CLOSE_LEAD_SECONDS = 60
SETTLEMENT_GRACE_SECONDS = 60
SETTLEMENT_RETRY_WINDOW_SECONDS = 1800

STATUS_OPEN = "OPEN"
STATUS_LOCKED = "LOCKED"
STATUS_LIVE = "LIVE"
STATUS_FINALIZING = "FINALIZING"
STATUS_SETTLEMENT_READY = "SETTLEMENT_READY"
STATUS_RESOLVED = "RESOLVED"
STATUS_INCONCLUSIVE = "INCONCLUSIVE"

RESOLUTION_UNRESOLVED = "UNRESOLVED"
RESOLUTION_RESOLVED = "RESOLVED"
RESOLUTION_INCONCLUSIVE = "INCONCLUSIVE"

SOURCE_NOT_ATTEMPTED = "NOT_ATTEMPTED"
SOURCE_VALID = "VALID"
SOURCE_UNAVAILABLE = "UNAVAILABLE"
SOURCE_INVALID = "INVALID"
SOURCE_TIE = "TIE"

EXPECTED = "[EXPECTED] "


def _json(value: typing.Any) -> str:
    return json.dumps(value, sort_keys=True, separators=(",", ":"))


def _fail(message: str) -> typing.NoReturn:
    raise gl.vm.UserError(EXPECTED + message)


def _digits(text: str, start: int, end: int) -> int:
    if start < 0 or end > len(text) or start >= end:
        return -1
    value = 0
    for index in range(start, end):
        char = text[index]
        if char not in "0123456789":
            return -1
        value = value * 10 + ord(char) - ord("0")
    return value


def _days_since_epoch(year: int, month: int, day: int) -> int:
    adjusted = year - 1 if month <= 2 else year
    era = adjusted // 400
    year_of_era = adjusted - era * 400
    month_piece = month - 3 if month > 2 else month + 9
    day_of_year = (153 * month_piece + 2) // 5 + day - 1
    return era * 146097 + year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year - 719468


def _month_days(year: int, month: int) -> int:
    if month == 2:
        return 29 if year % 400 == 0 or (year % 4 == 0 and year % 100 != 0) else 28
    return 30 if month in (4, 6, 9, 11) else 31


def _parse_datetime(value: typing.Any) -> int:
    """Parse the protocol's deterministic transaction datetime to UTC seconds."""
    text = str(value)
    if len(text) < 20 or len(text) > 64:
        return -1
    if text[4] != "-" or text[7] != "-" or text[10] != "T" or text[13] != ":" or text[16] != ":":
        return -1
    year = _digits(text, 0, 4)
    month = _digits(text, 5, 7)
    day = _digits(text, 8, 10)
    hour = _digits(text, 11, 13)
    minute = _digits(text, 14, 16)
    second = _digits(text, 17, 19)
    if year < 1970 or month < 1 or month > 12 or day < 1 or day > _month_days(year, month):
        return -1
    if hour > 23 or minute > 59 or second > 59:
        return -1
    index = 19
    if index < len(text) and text[index] == ".":
        index += 1
        fraction_start = index
        for _fraction_index in range(18):
            if index < len(text) and text[index] in "0123456789":
                index += 1
            else:
                break
        if index == fraction_start or (index < len(text) and text[index] in "0123456789"):
            return -1
    offset = 0
    if index >= len(text):
        return -1
    if text[index] == "Z" and index + 1 == len(text):
        offset = 0
    elif text[index] in ("+", "-") and index + 6 == len(text) and text[index + 3] == ":":
        offset_hour = _digits(text, index + 1, index + 3)
        offset_minute = _digits(text, index + 4, index + 6)
        if offset_hour < 0 or offset_minute < 0 or offset_hour > 23 or offset_minute > 59:
            return -1
        offset = offset_hour * 3600 + offset_minute * 60
        if text[index] == "-":
            offset = -offset
    else:
        return -1
    return _days_since_epoch(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset


def _timestamp(value: typing.Any) -> int:
    if isinstance(value, bool):
        return -1
    if isinstance(value, int):
        return value if value >= 0 else -1
    if not isinstance(value, str):
        return -1
    text = value
    if text != text.strip() or len(text) > 80:
        return -1
    if len(text) == 0 or not text.isdigit():
        return -1
    result = int(text)
    return result if result <= U256_MAX else -1


def _price(value: typing.Any) -> int:
    """Parse an exchange decimal into a fixed 18-decimal integer."""
    if isinstance(value, bool) or not isinstance(value, (str, int)):
        return -1
    text = str(value)
    if text != text.strip() or len(text) == 0 or len(text) > MAX_DECIMAL_CHARS:
        return -1
    pieces = text.split(".")
    if len(pieces) > 2 or len(pieces[0]) == 0 or not pieces[0].isdigit():
        return -1
    fraction = pieces[1] if len(pieces) == 2 else ""
    if len(pieces) == 2 and len(fraction) == 0:
        return -1
    if len(fraction) > 18 or (fraction and not fraction.isdigit()):
        return -1
    whole = pieces[0].lstrip("0") or "0"
    fraction = fraction.ljust(18, "0")
    result = int(whole) * PRICE_SCALE + (int(fraction) if fraction else 0)
    return result if 0 < result <= U256_MAX else -1


def _duration_interval(source: str, duration: int) -> str:
    if duration != int(DURATION_4H_SECONDS):
        return ""
    if source == "BINANCE":
        return "4h"
    if source == "BITGET":
        return "4H"
    if source == "GATE":
        return "4h"
    return ""


def _symbol(source: str, asset: str) -> str:
    if source == "GATE":
        return asset + "_USDT"
    return asset + "USDT"


def _source_url(source: str, asset: str, start: int, end: int, duration: int) -> str:
    symbol = _symbol(source, asset)
    start_ms = str(start * 1000)
    end_ms = str(end * 1000 - 1)
    interval = _duration_interval(source, duration)
    if source == "BINANCE":
        return (
            "https://api.binance.com/api/v3/klines?symbol=" + symbol
            + "&interval=" + interval + "&timeZone=0&startTime=" + start_ms
            + "&endTime=" + end_ms + "&limit=1"
        )
    if source == "BITGET":
        return (
            "https://api.bitget.com/api/v3/market/candles?category=SPOT&symbol="
            + symbol + "&interval=" + interval + "&startTime=" + start_ms
            + "&endTime=" + end_ms + "&type=MARKET&limit=1"
        )
    if source == "GATE":
        return (
            "https://api.gateio.ws/api/v4/spot/candlesticks?currency_pair="
            + symbol + "&interval=" + interval + "&from=" + str(start)
            # Gate's REST `to` bound is inclusive.  Subtract one second so
            # the exact range contains only the Crown candle at `start`.
            + "&to=" + str(end - 1)
        )
    return (
        "https://invalid.crown.source/"
    )


def _request_json(url: str) -> tuple[str, typing.Any]:
    """Return OK/UNAVAILABLE/INVALID with bounded external-failure handling."""
    try:
        response = gl.nondet.web.get(url)
    except Exception:
        return (SOURCE_UNAVAILABLE, None)
    try:
        status = int(response.status)
        body = response.body
        if not isinstance(body, bytes) or len(body) == 0 or len(body) > MAX_RESPONSE_BYTES:
            return (SOURCE_INVALID, None)
        if status >= 500 or status in (408, 425, 429):
            return (SOURCE_UNAVAILABLE, None)
        if status != 200:
            return (SOURCE_INVALID, None)
        return ("OK", json.loads(body.decode("utf-8")))
    except Exception:
        return (SOURCE_INVALID, None)


def _row_from_payload(source: str, payload: typing.Any, expected_start: int, expected_end: int) -> typing.Optional[typing.Tuple[int, int]]:
    """Validate the venue-specific envelope and return (open, close) fixed integers."""
    rows: typing.Any = None
    if source == "BINANCE":
        if not isinstance(payload, list) or len(payload) != 1:
            return None
        rows = payload
    elif source == "BITGET":
        if (
            not isinstance(payload, dict)
            or payload.get("code") != "00000"
            or payload.get("msg") != "success"
            or not isinstance(payload.get("data"), list)
        ):
            return None
        rows = payload["data"]
        if len(rows) != 1:
            return None
    elif source == "GATE":
        if not isinstance(payload, list) or len(payload) != 1:
            return None
        rows = payload
    else:
        return None
    row = rows[0]
    if not isinstance(row, list) or len(row) < 5:
        return None
    timestamp = _timestamp(row[0])
    expected_timestamp = expected_start * 1000 if source in ("BINANCE", "BITGET") else expected_start
    if timestamp != expected_timestamp:
        return None
    if source == "GATE":
        # Gate v4 spot rows are [timestamp, quote volume, close, high, low, open].
        # The documented response schema may also include base volume at index
        # 6, and live responses may append the optional `w` marker at index 7.
        if len(row) not in (6, 7, 8):
            return None
        # Gate REST documents the six-field row. Some live responses append a
        # `w` close marker; it is supplemental only and must be true if present.
        # The fixed post-close grace and exact historical timestamp remain the
        # authoritative finalization safeguards when the marker is absent.
        if len(row) == 8 and row[7] is not True and row[7] != "true":
            return None
        opened = _price(row[5])
        closed = _price(row[2])
    else:
        opened = _price(row[1])
        closed = _price(row[4])
    if opened <= 0 or closed <= 0:
        return None
    if source == "BINANCE":
        if len(row) != 12 or _timestamp(row[6]) != expected_end * 1000 - 1:
            return None
    if source == "BITGET":
        # Bitget v3 rows are timestamp, OHLC, base volume, and quote turnover.
        if len(row) != 7:
            return None
    return (opened, closed)


def _source_once(source: str, start: int, end: int, duration: int) -> dict[str, str]:
    if (
        source not in SOURCE_NAMES
        or duration != int(DURATION_4H_SECONDS)
        or start <= 0
        or start % int(DURATION_4H_SECONDS) != 0
        or end != start + int(DURATION_4H_SECONDS)
    ):
        return {"status": SOURCE_INVALID, "winner": ""}
    values: list[tuple[int, int]] = []
    for asset in ASSETS:
        request_status, payload = _request_json(_source_url(source, asset, start, end, duration))
        if request_status != "OK":
            return {"status": request_status, "winner": ""}
        row = _row_from_payload(source, payload, start, end)
        if row is None:
            return {"status": SOURCE_INVALID, "winner": ""}
        values.append(row)
    winner = _dominance_winner(values)
    if winner == "":
        return {"status": SOURCE_TIE, "winner": ""}
    return {"status": SOURCE_VALID, "winner": winner}


def _fetch_source(source: str, start: int, end: int, duration: int) -> dict[str, str]:
    for _attempt in range(MAX_SOURCE_ATTEMPTS):
        try:
            result = _source_once(source, start, end, duration)
        except Exception:
            result = {"status": SOURCE_INVALID, "winner": ""}
        if result["status"] != SOURCE_UNAVAILABLE:
            return result
    return {"status": SOURCE_UNAVAILABLE, "winner": ""}


def _normalized_return(opened: int, closed: int) -> int:
    numerator = (closed - opened) * RETURN_SCALE
    if numerator >= 0:
        return numerator // opened
    return -((-numerator) // opened)


def _dominance_winner(values: list[tuple[int, int]]) -> str:
    returns = [_normalized_return(opened, closed) for opened, closed in values]
    best = returns[0]
    for value in returns[1:]:
        if value > best:
            best = value
    if sum(1 for value in returns if value == best) != 1:
        return ""
    return ASSETS[returns.index(best)]


def _empty_proposal() -> dict[str, typing.Any]:
    return {
        "binance_status": SOURCE_NOT_ATTEMPTED,
        "binance_winner": "",
        "bitget_status": SOURCE_NOT_ATTEMPTED,
        "bitget_winner": "",
        "gate_status": SOURCE_NOT_ATTEMPTED,
        "gate_winner": "",
        "valid_source_count": 0,
        "consensus_winner": "",
        "consensus_count": 0,
    }


def _collect_sources(start: int, end: int, duration: int) -> dict[str, typing.Any]:
    result: dict[str, typing.Any] = {}
    for source in SOURCE_NAMES:
        fetched = _fetch_source(source, start, end, duration)
        prefix = source.lower()
        result[prefix + "_status"] = fetched["status"]
        result[prefix + "_winner"] = fetched["winner"]
    votes = {asset: 0 for asset in ASSETS}
    valid_count = 0
    for source in SOURCE_NAMES:
        prefix = source.lower()
        if result[prefix + "_status"] == SOURCE_VALID and result[prefix + "_winner"] in ASSETS:
            valid_count += 1
            votes[result[prefix + "_winner"]] += 1
    consensus_winner = ""
    consensus_count = 0
    for asset in ASSETS:
        if votes[asset] > consensus_count:
            consensus_winner = asset
            consensus_count = votes[asset]
    result["valid_source_count"] = valid_count
    result["consensus_winner"] = consensus_winner if consensus_count >= 2 else ""
    result["consensus_count"] = consensus_count
    return result


def _proposal_financial_winner(proposal: typing.Any) -> str:
    if not isinstance(proposal, dict):
        return ""
    winner = proposal.get("consensus_winner", "")
    count = proposal.get("consensus_count", 0)
    if winner in ASSETS and isinstance(count, int) and count >= 2:
        return winner
    return ""


def _proposal_has_unavailable(proposal: dict[str, typing.Any]) -> bool:
    for source in SOURCE_NAMES:
        if proposal.get(source.lower() + "_status") == SOURCE_UNAVAILABLE:
            return True
    return False


def _proposal_source_vote(proposal: typing.Any, source: str) -> str:
    """Return a source's valid vote, or empty for every non-vote state."""
    if not isinstance(proposal, dict):
        return ""
    prefix = source.lower()
    if proposal.get(prefix + "_status") != SOURCE_VALID:
        return ""
    winner = proposal.get(prefix + "_winner", "")
    return winner if winner in ASSETS else ""


def _common_valid_votes(first: typing.Any, second: typing.Any, winner: str) -> int:
    """Count independent source/winner pairs both executions prove."""
    count = 0
    for source in SOURCE_NAMES:
        if (
            _proposal_source_vote(first, source) == winner
            and _proposal_source_vote(second, source) == winner
        ):
            count += 1
    return count


class Crown(Contract):
    market_count: u256
    market_records: TreeMap[str, str]
    market_identity: TreeMap[str, u256]
    position_records: TreeMap[str, str]

    def __init__(self):
        self.market_count = u256(0)

    def _now(self) -> u256:
        try:
            raw = gl.message.raw["datetime"]
        except Exception:
            _fail("invalid transaction time")
        current = _parse_datetime(raw)
        if current < 0:
            _fail("invalid transaction time")
        return u256(current)

    def _sender(self) -> Address:
        return Address(gl.message.sender_address.as_bytes)

    def _address_key(self, user: Address) -> str:
        return Address(user.as_bytes).as_b64

    def _position_key(self, market_id: u256, user: Address) -> str:
        return str(int(market_id)) + ":" + self._address_key(user)

    def _market(self, market_id: u256) -> dict[str, typing.Any]:
        key = str(int(market_id))
        if key not in self.market_records:
            _fail("market does not exist")
        try:
            record = json.loads(self.market_records[key])
        except Exception:
            _fail("corrupt market record")
        if not isinstance(record, dict):
            _fail("corrupt market record")
        return record

    def _save_market(self, market_id: u256, market: dict[str, typing.Any]) -> None:
        self.market_records[str(int(market_id))] = _json(market)

    def _position(self, key: str) -> dict[str, typing.Any]:
        if key not in self.position_records:
            return {"asset": "", "stake": "0", "claim_state": "UNCLAIMED"}
        try:
            position = json.loads(self.position_records[key])
        except Exception:
            _fail("corrupt position record")
        if not isinstance(position, dict):
            _fail("corrupt position record")
        if position.get("asset", "") not in ASSETS or position.get("claim_state") not in ("UNCLAIMED", "CLAIMED"):
            _fail("corrupt position record")
        stake = _timestamp(position.get("stake"))
        if stake < 0 or stake > U256_MAX:
            _fail("corrupt position record")
        return position

    def _stored_int(self, value: typing.Any) -> int:
        parsed = _timestamp(value)
        if parsed < 0 or parsed > U256_MAX:
            _fail("corrupt numeric state")
        return parsed

    def _duration_ok(self, duration: u256) -> bool:
        return int(duration) == int(DURATION_4H_SECONDS)

    def _market_status(self, market: dict[str, typing.Any], now: int) -> str:
        resolution = market["resolution_status"]
        if resolution == RESOLUTION_RESOLVED:
            return STATUS_RESOLVED
        if resolution == RESOLUTION_INCONCLUSIVE:
            return STATUS_INCONCLUSIVE
        close = self._stored_int(market["betting_close_timestamp"])
        start = self._stored_int(market["performance_start_timestamp"])
        end = self._stored_int(market["performance_end_timestamp"])
        ready = self._stored_int(market["settlement_ready_timestamp"])
        if now < close:
            return STATUS_OPEN
        if now < start:
            return STATUS_LOCKED
        if now < end:
            return STATUS_LIVE
        if now < ready:
            return STATUS_FINALIZING
        return STATUS_SETTLEMENT_READY

    def _preview(self, market_id: int, market: dict[str, typing.Any], now: int) -> dict[str, typing.Any]:
        return {
            "market_id": market_id,
            "start_timestamp": self._stored_int(market["start_timestamp"]),
            "betting_close_timestamp": self._stored_int(market["betting_close_timestamp"]),
            "performance_end_timestamp": self._stored_int(market["performance_end_timestamp"]),
            "status": self._market_status(market, now),
            "total_pool": self._stored_int(market["total_pool"]),
            "BTC_pool": self._stored_int(market["BTC_pool"]),
            "ETH_pool": self._stored_int(market["ETH_pool"]),
            "SOL_pool": self._stored_int(market["SOL_pool"]),
            "BNB_pool": self._stored_int(market["BNB_pool"]),
            "XRP_pool": self._stored_int(market["XRP_pool"]),
            "winner": market["winner"],
        }

    def _page_limit(self, limit: u256) -> int:
        requested = int(limit)
        if requested < 1:
            _fail("page limit must be positive")
        return MAX_PAGE if requested > MAX_PAGE else requested

    def _resolution_from(self, proposal: dict[str, typing.Any], status: str, winner: str) -> dict[str, typing.Any]:
        return {
            "status": status,
            "binance_status": proposal["binance_status"],
            "binance_winner": proposal["binance_winner"],
            "bitget_status": proposal["bitget_status"],
            "bitget_winner": proposal["bitget_winner"],
            "gate_status": proposal["gate_status"],
            "gate_winner": proposal["gate_winner"],
            "valid_source_count": proposal["valid_source_count"],
            "consensus_winner": proposal["consensus_winner"],
            "final_winner": winner,
            "consensus_count": proposal["consensus_count"],
        }

    def _empty_resolution(self) -> dict[str, typing.Any]:
        return self._resolution_from(_empty_proposal(), RESOLUTION_UNRESOLVED, "")

    def _settlement_proposal(
        self,
        start: typing.Any,
        end: typing.Optional[int] = None,
        duration: typing.Optional[int] = None,
    ) -> dict[str, typing.Any]:
        # Keep the old private helper shape available to local fixtures while
        # freezing its storage-derived values before either callback runs.
        if isinstance(start, dict):
            market = start
            start = self._stored_int(market["performance_start_timestamp"])
            end = self._stored_int(market["performance_end_timestamp"])
            duration = self._stored_int(market["duration"])
        if end is None or duration is None:
            _fail("invalid settlement inputs")

        def leader() -> dict[str, typing.Any]:
            return _collect_sources(start, end, duration)

        def validator(leaders_result: typing.Any) -> bool:
            if not isinstance(leaders_result, gl.vm.Return):
                return False
            if not isinstance(leaders_result.calldata, dict):
                return False
            other = _collect_sources(start, end, duration)
            # Source availability is transient, so an extra nonessential source
            # may recover or fail between executions. A positive result still
            # needs a common two-source witness: the same two independent
            # source/winner pairs must be VALID in both executions. Comparing
            # only the final asset would allow different 2-of-3 proofs to pass.
            leader_winner = _proposal_financial_winner(leaders_result.calldata)
            other_winner = _proposal_financial_winner(other)
            if leader_winner != other_winner:
                return False
            if leader_winner != "":
                return _common_valid_votes(leaders_result.calldata, other, leader_winner) >= 2
            # Retryability is relevant only when no winner is proven. Keep this
            # stable so one execution cannot finalize while the other still has
            # a retryable unavailable provider.
            return _proposal_has_unavailable(leaders_result.calldata) == _proposal_has_unavailable(other)

        # ``run_nondet`` is the linter-recognized Studio Next equivalence
        # entry point; settlement catches its VM/consensus failure as before.
        return gl.vm.run_nondet(leader, validator)

    @gl.public.write
    def create_market(self, market_start_timestamp: u256, duration: u256) -> u256:
        if not self._duration_ok(duration):
            _fail("duration is not protocol-approved")
        now = int(self._now())
        start = int(market_start_timestamp)
        duration_seconds = int(duration)
        if start <= 0 or start <= now:
            _fail("market start must be in the future")
        if start - now < MIN_CREATION_LEAD_SECONDS:
            _fail("market start does not satisfy creation lead time")
        if start % int(DURATION_4H_SECONDS) != 0 or start % 60 != 0:
            _fail("market start must be UTC aligned")
        if start > U256_MAX - duration_seconds:
            _fail("market timestamps overflow")
        identity = "CROWN|V1|4H|" + str(start)
        if identity in self.market_identity:
            _fail("duplicate market")
        if int(self.market_count) >= U256_MAX:
            _fail("market counter overflows")
        market_id = int(self.market_count) + 1
        end = start + duration_seconds
        if end > U256_MAX - SETTLEMENT_GRACE_SECONDS - SETTLEMENT_RETRY_WINDOW_SECONDS:
            _fail("settlement timestamp overflows")
        betting_close = start - BETTING_CLOSE_LEAD_SECONDS
        settlement_ready = end + SETTLEMENT_GRACE_SECONDS
        sender = self._sender()
        market = {
            "id": str(market_id),
            "creator": sender.as_hex,
            "start_timestamp": str(start),
            "betting_close_timestamp": str(betting_close),
            "performance_start_timestamp": str(start),
            "performance_end_timestamp": str(end),
            "settlement_ready_timestamp": str(settlement_ready),
            "duration": str(duration_seconds),
            "total_pool": "0",
            "BTC_pool": "0",
            "ETH_pool": "0",
            "SOL_pool": "0",
            "BNB_pool": "0",
            "XRP_pool": "0",
            "resolution_status": RESOLUTION_UNRESOLVED,
            "winner": "",
            "consensus_count": "0",
            "claimed_pool": "0",
            "claimed_winning_stake": "0",
            "settlement": self._empty_resolution(),
        }
        self._save_market(u256(market_id), market)
        self.market_identity[identity] = u256(market_id)
        self.market_count = u256(market_id)
        return u256(market_id)

    @gl.public.write.payable
    def place_position(self, market_id: u256, asset: str) -> None:
        market = self._market(market_id)
        clean_asset = str(asset)
        if clean_asset not in ASSETS:
            _fail("asset is not protocol-approved")
        now = int(self._now())
        close = self._stored_int(market["betting_close_timestamp"])
        if now >= close or market["resolution_status"] != RESOLUTION_UNRESOLVED:
            _fail("betting is closed")
        amount = int(gl.message.value)
        if amount < int(MIN_STAKE):
            _fail("minimum stake is 1 GEN")
        if amount > int(MAX_STAKE):
            _fail("maximum stake per addition is 10 GEN")
        user = self._sender()
        key = self._position_key(market_id, user)
        position = self._position(key)
        current = self._stored_int(position["stake"])
        selected = str(position["asset"])
        if current > 0 and selected != clean_asset:
            _fail("wallet may choose only one asset per market")
        if current + amount > int(MAX_STAKE):
            _fail("maximum cumulative stake is 10 GEN")
        asset_pool = self._stored_int(market[clean_asset + "_pool"])
        total_pool = self._stored_int(market["total_pool"])
        if asset_pool > U256_MAX - amount or total_pool > U256_MAX - amount:
            _fail("market pool overflows")
        # Every check is complete before any storage write.
        position["asset"] = clean_asset
        position["stake"] = str(current + amount)
        self.position_records[key] = _json(position)
        market[clean_asset + "_pool"] = str(asset_pool + amount)
        market["total_pool"] = str(total_pool + amount)
        self._save_market(market_id, market)

    @gl.public.write
    def settle_market(self, market_id: u256) -> None:
        market = self._market(market_id)
        if market["resolution_status"] != RESOLUTION_UNRESOLVED:
            return
        now = int(self._now())
        ready = self._stored_int(market["settlement_ready_timestamp"])
        if now < ready:
            _fail("settlement is not ready; candle finalization grace is active")
        total_pool = self._stored_int(market["total_pool"])
        if total_pool == 0:
            proposal = _empty_proposal()
            market["resolution_status"] = RESOLUTION_INCONCLUSIVE
            market["settlement"] = self._resolution_from(proposal, RESOLUTION_INCONCLUSIVE, "")
            self._save_market(market_id, market)
            return
        # Freeze all deterministic inputs before entering nondeterministic
        # execution.  Neither leader nor validator reads mutable storage.
        start = self._stored_int(market["performance_start_timestamp"])
        end = self._stored_int(market["performance_end_timestamp"])
        duration = self._stored_int(market["duration"])
        pools = {
            asset: self._stored_int(market[asset + "_pool"])
            for asset in ASSETS
        }
        try:
            proposal = self._settlement_proposal(start, end, duration)
        except Exception:
            # A transient validator disagreement must not brick a market.  It
            # remains retryable before the deadline; after the deadline there
            # is no safe financial evidence to resolve, so finalize refund-only
            # INCONCLUSIVE with an empty normalized proof.
            if now < ready + SETTLEMENT_RETRY_WINDOW_SECONDS:
                return
            proposal = _empty_proposal()
            market["resolution_status"] = RESOLUTION_INCONCLUSIVE
            market["settlement"] = self._resolution_from(proposal, RESOLUTION_INCONCLUSIVE, "")
            self._save_market(market_id, market)
            return
        candidate = proposal["consensus_winner"]
        winning_pool = pools.get(candidate, 0) if candidate in ASSETS else 0
        if candidate in ASSETS and proposal["consensus_count"] >= 2 and winning_pool > 0:
            status = RESOLUTION_RESOLVED
            winner = candidate
        elif candidate in ASSETS and proposal["consensus_count"] >= 2 and winning_pool == 0:
            # A consensus winner with no backing has no pari-mutuel payout side.
            status = RESOLUTION_INCONCLUSIVE
            winner = ""
        elif _proposal_has_unavailable(proposal) and now < ready + SETTLEMENT_RETRY_WINDOW_SECONDS:
            # Keep unresolved.  No state is changed, so anyone can retry later.
            return
        else:
            status = RESOLUTION_INCONCLUSIVE
            winner = ""
        market["resolution_status"] = status
        market["winner"] = winner
        market["consensus_count"] = str(proposal["consensus_count"])
        market["settlement"] = self._resolution_from(proposal, status, winner)
        self._save_market(market_id, market)

    def _claim_amount(self, market: dict[str, typing.Any], position: dict[str, typing.Any]) -> int:
        stake = self._stored_int(position["stake"])
        if stake == 0 or position["claim_state"] != "UNCLAIMED":
            return 0
        if market["resolution_status"] == RESOLUTION_INCONCLUSIVE:
            claimed = self._stored_int(market["claimed_pool"])
            total = self._stored_int(market["total_pool"])
            return stake if claimed + stake <= total else 0
        if market["resolution_status"] != RESOLUTION_RESOLVED or position["asset"] != market["winner"]:
            return 0
        winning_pool = self._stored_int(market[position["asset"] + "_pool"])
        total_pool = self._stored_int(market["total_pool"])
        claimed_pool = self._stored_int(market["claimed_pool"])
        claimed_stake = self._stored_int(market["claimed_winning_stake"])
        if winning_pool == 0 or claimed_pool > total_pool or claimed_stake + stake > winning_pool:
            return 0
        if claimed_stake + stake == winning_pool:
            return total_pool - claimed_pool
        return stake * total_pool // winning_pool

    @gl.public.write
    def claim(self, market_id: u256) -> u256:
        market = self._market(market_id)
        user = self._sender()
        key = self._position_key(market_id, user)
        position = self._position(key)
        if position["claim_state"] != "UNCLAIMED":
            _fail("position already claimed")
        amount = self._claim_amount(market, position)
        if amount <= 0:
            _fail("nothing claimable")
        is_refund = market["resolution_status"] == RESOLUTION_INCONCLUSIVE
        claimed_pool = self._stored_int(market["claimed_pool"])
        total_pool = self._stored_int(market["total_pool"])
        if claimed_pool + amount > total_pool:
            _fail("payout exceeds market pool")
        position["claim_state"] = "CLAIMED"
        market["claimed_pool"] = str(claimed_pool + amount)
        if not is_refund:
            market["claimed_winning_stake"] = str(
                self._stored_int(market["claimed_winning_stake"]) + self._stored_int(position["stake"])
            )
        self.position_records[key] = _json(position)
        self._save_market(market_id, market)
        gl.get_contract_at(user).emit_transfer(value=u256(amount), on="finalized")
        return u256(amount)

    @gl.public.view
    def get_market(self, market_id: u256) -> dict:
        market = self._market(market_id)
        now = int(self._now())
        status = self._market_status(market, now)
        total_pool = self._stored_int(market["total_pool"])
        claimed_pool = self._stored_int(market["claimed_pool"])
        winner = market["winner"]
        winning_pool = self._stored_int(market[winner + "_pool"]) if winner in ASSETS else 0
        return {
            "market_id": self._stored_int(market["id"]),
            "creator": market["creator"],
            "start_timestamp": self._stored_int(market["start_timestamp"]),
            "betting_close_timestamp": self._stored_int(market["betting_close_timestamp"]),
            "performance_start_timestamp": self._stored_int(market["performance_start_timestamp"]),
            "performance_end_timestamp": self._stored_int(market["performance_end_timestamp"]),
            "settlement_ready_timestamp": self._stored_int(market["settlement_ready_timestamp"]),
            "settlement_timestamp": self._stored_int(market["settlement_ready_timestamp"]),
            "settlement_retry_deadline": self._stored_int(market["settlement_ready_timestamp"]) + SETTLEMENT_RETRY_WINDOW_SECONDS,
            "duration": self._stored_int(market["duration"]),
            "status": status,
            "total_pool": total_pool,
            "BTC_pool": self._stored_int(market["BTC_pool"]),
            "ETH_pool": self._stored_int(market["ETH_pool"]),
            "SOL_pool": self._stored_int(market["SOL_pool"]),
            "BNB_pool": self._stored_int(market["BNB_pool"]),
            "XRP_pool": self._stored_int(market["XRP_pool"]),
            "winner": winner,
            "consensus_count": self._stored_int(market["consensus_count"]),
            "resolution_status": market["resolution_status"],
            "betting_open": status == STATUS_OPEN,
            "settlement_available": market["resolution_status"] == RESOLUTION_UNRESOLVED and now >= self._stored_int(market["settlement_ready_timestamp"]),
            "winning_pool": winning_pool,
            "claimed_pool": claimed_pool,
            "remaining_pool": total_pool - claimed_pool if claimed_pool <= total_pool else 0,
        }

    @gl.public.view
    def get_user_position(self, market_id: u256, user: Address) -> dict:
        market = self._market(market_id)
        key = self._position_key(market_id, user)
        position = self._position(key)
        stake = self._stored_int(position["stake"])
        claimed = position["claim_state"] == "CLAIMED"
        claimable = 0 if claimed else self._claim_amount(market, position)
        status = self._market_status(market, int(self._now()))
        remaining_capacity = int(MAX_STAKE) - stake if stake <= int(MAX_STAKE) else 0
        resolved = market["resolution_status"] == RESOLUTION_RESOLVED
        won = resolved and stake > 0 and position["asset"] == market["winner"]
        lost = resolved and stake > 0 and position["asset"] != market["winner"]
        return {
            "has_position": stake > 0,
            "selected_asset": position["asset"],
            "total_stake": stake,
            "remaining_stake_capacity": remaining_capacity,
            "can_top_up": stake > 0 and remaining_capacity >= int(MIN_STAKE) and status == STATUS_OPEN,
            "position_won": won,
            "position_lost": lost,
            "claim_available": claimable > 0,
            "already_claimed": claimed,
            "claimable_amount": claimable,
            "claim_type": "REFUND" if market["resolution_status"] == RESOLUTION_INCONCLUSIVE and claimable > 0 else "PAYOUT" if claimable > 0 else "NONE",
        }

    @gl.public.view
    def get_resolution(self, market_id: u256) -> dict:
        market = self._market(market_id)
        resolution = market["settlement"]
        return {
            "status": resolution["status"],
            "binance_status": resolution["binance_status"],
            "binance_winner": resolution["binance_winner"],
            "bitget_status": resolution["bitget_status"],
            "bitget_winner": resolution["bitget_winner"],
            "gate_status": resolution["gate_status"],
            "gate_winner": resolution["gate_winner"],
            "valid_source_count": resolution["valid_source_count"],
            "final_winner": resolution["final_winner"],
            "consensus_count": resolution["consensus_count"],
        }

    @gl.public.view
    def get_market_by_start(self, start_timestamp: u256) -> dict:
        start = int(start_timestamp)
        if start <= 0 or start > U256_MAX or start % int(DURATION_4H_SECONDS) != 0:
            return {"exists": False, "market_id": 0}
        identity = "CROWN|V1|4H|" + str(start)
        if identity not in self.market_identity:
            return {"exists": False, "market_id": 0}
        return {"exists": True, "market_id": self._stored_int(self.market_identity[identity])}

    @gl.public.view
    def get_markets(self, offset: u256, limit: u256) -> dict:
        requested = self._page_limit(limit)
        total = int(self.market_count)
        cursor = int(offset)
        if cursor > total:
            cursor = total
        if cursor >= total:
            return {"market_ids": [], "markets": [], "next_offset": cursor, "has_more": False}
        remaining = total - cursor
        count = requested if requested < remaining else remaining
        now = int(self._now())
        ids: list[int] = []
        previews: list[dict] = []
        for index in range(count):
            market_id = cursor + index + 1
            market = self._market(u256(market_id))
            ids.append(market_id)
            previews.append(self._preview(market_id, market, now))
        next_offset = cursor + count
        return {"market_ids": ids, "markets": previews, "next_offset": next_offset, "has_more": next_offset < total}

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> dict:
        requested = self._page_limit(limit)
        total = int(self.market_count)
        cursor = int(offset)
        if cursor > total:
            cursor = total
        if cursor >= total:
            return {
                "market_ids": [],
                "markets": [],
                "next_offset": cursor,
                "has_more": False,
                "scanned_count": 0,
            }
        remaining = total - cursor
        scan = MAX_OPEN_SCAN if MAX_OPEN_SCAN < remaining else remaining
        now = int(self._now())
        ids: list[int] = []
        previews: list[dict] = []
        base_cursor = cursor
        for index in range(scan):
            market_id = base_cursor + index + 1
            market = self._market(u256(market_id))
            if self._market_status(market, now) == STATUS_OPEN:
                ids.append(market_id)
                previews.append(self._preview(market_id, market, now))
                if len(ids) == requested:
                    cursor = market_id
                    break
            cursor = market_id
        return {
            "market_ids": ids,
            "markets": previews,
            "next_offset": cursor,
            "has_more": cursor < total,
            "scanned_count": cursor - int(offset) if cursor >= int(offset) else 0,
        }

    @gl.public.view
    def get_protocol_config(self) -> dict:
        return {
            "name": "Crown",
            "assets": list(ASSETS),
            "duration": int(DURATION_4H_SECONDS),
            "durations_seconds": [int(value) for value in DURATIONS],
            "min_stake": int(MIN_STAKE),
            "max_stake": int(MAX_STAKE),
            "sources": list(SOURCE_NAMES),
            "consensus_threshold": 2,
            "minimum_creation_lead_seconds": MIN_CREATION_LEAD_SECONDS,
            "betting_close_lead_seconds": BETTING_CLOSE_LEAD_SECONDS,
            "settlement_grace_seconds": SETTLEMENT_GRACE_SECONDS,
            "settlement_retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "source_strategy": "NATIVE_4H_CANDLES",
            "return_precision": RETURN_SCALE,
            "price_precision": PRICE_SCALE,
            "timezone": "UTC",
            "payout_rounding": "floor; final winning claimant receives remaining integer dust",
            "zero_backed_winner": "INCONCLUSIVE_REFUND",
        }
