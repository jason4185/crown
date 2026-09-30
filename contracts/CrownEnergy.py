# v0.3.0
# { "Depends": "py-genlayer:5jycge4q8k23462jtb0b9fyey1s9qz928sz2nbrd9mg4sxqg2qng" }

import json

import genlayer as gl
from genlayer.contract import Contract
from genlayer.storage import TreeMap
from genlayer.types import Address, u256


PROTOCOL = "CROWN_ENERGY"
VERSION = 1
CHAIN_ID = 61997

UP_DOWN = 0
DOMINANCE = 1
MARKET_TYPES = ("UP_DOWN", "DOMINANCE")

WTI_CRUDE = 0
BRENT_CRUDE = 1
NATURAL_GAS = 2
ASSET_NAMES = ("WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS")
ASSET_COUNT = 3
ENERGY = "ENERGY"

ONE_HOUR = 3600
TWO_HOURS = 7200
DURATIONS = (ONE_HOUR, TWO_HOURS)

UP = 0
DOWN = 1
OUTCOME_NONE = 3

BINANCE = "BINANCE"
GATE = "GATE"
BITGET = "BITGET"
SOURCES = (BINANCE, GATE, BITGET)

BINANCE_SYMBOLS = ("CLUSDT", "BZUSDT", "NATGASUSDT")
GATE_SYMBOLS = ("CL_USDT", "BZ_USDT", "NG_USDT")
BITGET_SYMBOLS = BINANCE_SYMBOLS

STATE_OPEN = "OPEN"
STATE_AWAITING = "AWAITING_SETTLEMENT"
STATE_RESOLVED = "RESOLVED"
STATE_INCONCLUSIVE = "INCONCLUSIVE"

SOURCE_VALID = "VALID"
SOURCE_TIE = "TIE"
SOURCE_UNAVAILABLE = "UNAVAILABLE"
SOURCE_INVALID = "INVALID"

REASON_NONE = ""
REASON_CONSENSUS = "CONSENSUS"
REASON_NO_CONSENSUS = "NO_CONSENSUS"
REASON_RETRYABLE = "RETRYABLE"
REASON_EXPIRED = "EXPIRED_NO_CONSENSUS"
REASON_ZERO_BACKED = "ZERO_BACKED_WINNER"

GEN_SCALE = 1_000_000_000_000_000_000
MIN_BET = GEN_SCALE
MAX_BET_PER_MARKET = 40 * GEN_SCALE
RETURN_SCALE = 1_000_000
SETTLEMENT_RETRY_WINDOW_SECONDS = 46_800
MAX_RESPONSE_BYTES = 65_536
MAX_MARKETS = 1024
MAX_POSITIONS = 100_000
MAX_SOURCE_ATTEMPTS = 3
MAX_PAGE = 25
MAX_OPEN_SCAN = 100
U256_MAX = (1 << 256) - 1


@gl.evm.contract_interface
class _NativeRecipient:
    class View:
        pass

    class Write:
        pass


def _is_u256(value):
    return isinstance(value, int) and not isinstance(value, bool) and 0 <= value <= U256_MAX


def _add(left, right):
    if not _is_u256(left) or not _is_u256(right) or left > U256_MAX - right:
        raise gl.vm.UserError("u256 addition overflow")
    return left + right


def _mul(left, right):
    if not _is_u256(left) or not _is_u256(right) or (right and left > U256_MAX // right):
        raise gl.vm.UserError("u256 multiplication overflow")
    return left * right


def _mul_div(numerator, multiplier, denominator):
    if numerator < 0 or multiplier < 0 or denominator <= 0 or numerator > denominator:
        raise gl.vm.UserError("invalid payout arithmetic")
    quotient = 0
    remainder = 0
    for bit_index in range(256):
        bit = (numerator >> (255 - bit_index)) & 1
        carry = remainder * 2 + (multiplier if bit else 0)
        added, remainder = divmod(carry, denominator)
        quotient = quotient * 2 + added
    if quotient > U256_MAX:
        raise gl.vm.UserError("u256 payout overflow")
    return quotient


def _digits(value):
    if not value:
        return False
    for char in value:
        if char < "0" or char > "9":
            return False
    return True


def _days_since_epoch(year, month, day):
    adjusted = year - 1 if month <= 2 else year
    era = adjusted // 400
    year_of_era = adjusted - era * 400
    month_piece = month - 3 if month > 2 else month + 9
    day_of_year = (153 * month_piece + 2) // 5 + day - 1
    day_of_era = year_of_era * 365 + year_of_era // 4 - year_of_era // 100 + day_of_year
    return era * 146097 + day_of_era - 719468


def _month_days(year, month):
    if month == 2:
        return 29 if year % 400 == 0 or year % 4 == 0 and year % 100 != 0 else 28
    return 30 if month in (4, 6, 9, 11) else 31


def _parse_datetime(value):
    text = str(value)
    if len(text) < 20 or len(text) > 64:
        return -1
    if text[4] != "-" or text[7] != "-" or text[10] != "T" or text[13] != ":" or text[16] != ":":
        return -1
    fields = (text[0:4], text[5:7], text[8:10], text[11:13], text[14:16], text[17:19])
    if not all(_digits(field) for field in fields):
        return -1
    year, month, day, hour, minute, second = (int(field) for field in fields)
    if year < 1970 or month < 1 or month > 12 or day < 1 or day > _month_days(year, month):
        return -1
    if hour > 23 or minute > 59 or second > 59:
        return -1
    index = 19
    if index < len(text) and text[index] == ".":
        index += 1
        fraction_start = index
        while index < len(text) and text[index] >= "0" and text[index] <= "9" and index - fraction_start < 18:
            index += 1
        if index == fraction_start or index < len(text) and text[index] >= "0" and text[index] <= "9":
            return -1
    if index >= len(text):
        return -1
    if text[index] == "Z" and index + 1 == len(text):
        offset = 0
    elif text[index] in ("+", "-") and index + 6 == len(text) and text[index + 3] == ":":
        offset_hour_text = text[index + 1:index + 3]
        offset_minute_text = text[index + 4:index + 6]
        if not _digits(offset_hour_text) or not _digits(offset_minute_text):
            return -1
        offset_hour = int(offset_hour_text)
        offset_minute = int(offset_minute_text)
        if offset_hour > 23 or offset_minute > 59:
            return -1
        offset = offset_hour * 3600 + offset_minute * 60
        if text[index] == "-":
            offset = -offset
    else:
        return -1
    return _days_since_epoch(year, month, day) * 86400 + hour * 3600 + minute * 60 + second - offset


def _now():
    try:
        current = _parse_datetime(gl.message.raw["datetime"])
    except Exception:
        try:
            current = _parse_datetime(gl.message_raw["datetime"])
        except Exception:
            current = -1
    if current < 0:
        raise gl.vm.UserError("invalid transaction time")
    return current


def _asset_id(value):
    if _is_u256(value) and value < ASSET_COUNT:
        return value
    if isinstance(value, str):
        for index in range(ASSET_COUNT):
            if value == ASSET_NAMES[index]:
                return index
    raise gl.vm.UserError("unsupported asset")


def _asset_name(asset):
    if not _is_u256(asset) or asset >= ASSET_COUNT:
        raise gl.vm.UserError("unsupported asset")
    return ASSET_NAMES[asset]


def _asset_ids(market_type, asset):
    return (asset,) if market_type == UP_DOWN else (WTI_CRUDE, BRENT_CRUDE, NATURAL_GAS)


def _outcome_count(market_type):
    return 2 if market_type == UP_DOWN else ASSET_COUNT


def _outcome_id(market_type, value):
    count = _outcome_count(market_type)
    if _is_u256(value) and value < count:
        return value
    if market_type == UP_DOWN and isinstance(value, str):
        if value == "UP":
            return UP
        if value == "DOWN":
            return DOWN
    if market_type == DOMINANCE:
        return _asset_id(value)
    raise gl.vm.UserError("invalid outcome")


def _outcome_name(market_type, outcome):
    if market_type == UP_DOWN:
        if outcome == UP:
            return "UP"
        if outcome == DOWN:
            return "DOWN"
        raise gl.vm.UserError("invalid outcome")
    return _asset_name(outcome)


def _source_symbol(source, asset):
    if source == BINANCE:
        return BINANCE_SYMBOLS[asset]
    if source == GATE:
        return GATE_SYMBOLS[asset]
    if source == BITGET:
        return BITGET_SYMBOLS[asset]
    raise gl.vm.UserError("invalid source")


def _parse_integer(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        return value if 0 <= value <= U256_MAX else None
    if not isinstance(value, str) or len(value) > 40 or not _digits(value):
        return None
    parsed = int(value)
    return parsed if parsed <= U256_MAX else None


def _parse_price(value):
    if isinstance(value, bool):
        return None
    if isinstance(value, int):
        text = str(value)
    elif isinstance(value, str):
        text = value
    else:
        return None
    if not text or len(text) > 60 or text.startswith(("+", "-")) or "e" in text.lower():
        return None
    pieces = text.split(".")
    if len(pieces) > 2 or not _digits(pieces[0]) or len(pieces[0]) > 38:
        return None
    fraction = pieces[1] if len(pieces) == 2 else ""
    if len(pieces) == 2 and (not fraction or not _digits(fraction) or len(fraction) > 18):
        return None
    scaled = int(pieces[0]) * GEN_SCALE + int((fraction + "0" * 18)[:18])
    if scaled <= 0 or scaled > U256_MAX:
        return None
    normalized_fraction = fraction.rstrip("0")
    normalized = str(int(pieces[0]))
    if normalized_fraction:
        normalized += "." + normalized_fraction
    return scaled, normalized


def _return_units(opening, closing):
    numerator = (closing - opening) * 100 * RETURN_SCALE
    if numerator >= 0:
        return (numerator + opening // 2) // opening
    return -((-numerator + opening // 2) // opening)


def _compare_return(left_open, left_close, right_open, right_close):
    left_delta = left_close - left_open
    right_delta = right_close - right_open
    left_cross = left_delta * right_open
    right_cross = right_delta * left_open
    return 1 if left_cross > right_cross else -1 if left_cross < right_cross else 0


def _response_json(response):
    try:
        status = int(response.status)
        if status <= 0 or status >= 500 or status in (408, 425, 429):
            return SOURCE_UNAVAILABLE, None
        body = response.body
        if not isinstance(body, (bytes, bytearray)) or not body or len(body) > MAX_RESPONSE_BYTES:
            return SOURCE_INVALID, None
        if status != 200:
            return SOURCE_INVALID, None
        return "OK", json.loads(bytes(body).decode("utf-8"), parse_int=str, parse_float=str)
    except Exception:
        return SOURCE_INVALID, None


def _request_json(url):
    try:
        response = gl.nondet.web.get(url, headers={"Accept": "application/json"})
    except Exception:
        return SOURCE_UNAVAILABLE, None
    return _response_json(response)


def _parse_binance(payload, expected):
    if not isinstance(payload, list) or len(payload) != len(expected):
        return None
    rows = {}
    for row in payload:
        if not isinstance(row, list) or len(row) != 12:
            return None
        timestamp = _parse_integer(row[0])
        if timestamp is None or timestamp not in expected or timestamp in rows:
            return None
        if _parse_integer(row[6]) != timestamp + 3_599_999:
            return None
        opening = _parse_price(row[1])
        closing = _parse_price(row[4])
        if opening is None or closing is None:
            return None
        rows[timestamp] = (opening, closing)
    if any(timestamp not in rows for timestamp in expected):
        return None
    return [(timestamp, rows[timestamp][0], rows[timestamp][1]) for timestamp in expected]


def _parse_bitget(payload, expected, symbol=None):
    if not isinstance(payload, dict) or payload.get("code") != "00000" or not isinstance(payload.get("data"), list):
        return None
    if payload.get("source", BITGET) != BITGET or payload.get("category", "USDT-FUTURES") != "USDT-FUTURES":
        return None
    if symbol is not None and payload.get("symbol", symbol) != symbol:
        return None
    if payload.get("interval", "1H") != "1H" or payload.get("type", "market") not in ("market", ""):
        return None
    data = payload["data"]
    if len(data) != len(expected):
        return None
    rows = {}
    for row in data:
        if not isinstance(row, list) or len(row) != 7:
            return None
        timestamp = _parse_integer(row[0])
        if timestamp is None or timestamp not in expected or timestamp in rows:
            return None
        opening = _parse_price(row[1])
        closing = _parse_price(row[4])
        if opening is None or closing is None:
            return None
        rows[timestamp] = (opening, closing)
    if any(timestamp not in rows for timestamp in expected):
        return None
    return [(timestamp, rows[timestamp][0], rows[timestamp][1]) for timestamp in expected]


def _parse_gate(payload, expected, symbol):
    if not isinstance(payload, list) or len(payload) != len(expected):
        return None
    rows = {}
    for row in payload:
        if isinstance(row, list):
            if len(row) != 7:
                return None
            timestamp = _parse_integer(row[0])
            opening = _parse_price(row[5])
            closing = _parse_price(row[2])
            high = _parse_price(row[3])
            low = _parse_price(row[4])
        elif isinstance(row, dict):
            if len(row) > 10 or not all(key in row for key in ("t", "o", "h", "l", "c")):
                return None
            if row.get("source", GATE) != GATE or row.get("symbol", symbol) != symbol or row.get("contract", symbol) != symbol or row.get("interval", "1h") != "1h":
                return None
            timestamp = _parse_integer(row["t"])
            opening = _parse_price(row["o"])
            closing = _parse_price(row["c"])
            high = _parse_price(row["h"])
            low = _parse_price(row["l"])
        else:
            return None
        if timestamp is None or timestamp not in expected or timestamp in rows or opening is None or closing is None or high is None or low is None:
            return None
        rows[timestamp] = (opening, closing)
    if any(timestamp not in rows for timestamp in expected):
        return None
    return [(timestamp, rows[timestamp][0], rows[timestamp][1]) for timestamp in expected]


def _expected_starts(start, duration):
    return (start,) if duration == ONE_HOUR else (start, _add(start, ONE_HOUR))


def _fetch_candles(source, asset, start, end, duration):
    symbol = _source_symbol(source, asset)
    starts = _expected_starts(start, duration)
    start_ms = _mul(start, 1000)
    end_ms = _mul(end, 1000)
    if source == BINANCE:
        url = "https://fapi.binance.com/fapi/v1/klines?symbol=" + symbol + "&interval=1h&startTime=" + str(start_ms) + "&endTime=" + str(end_ms - 1) + "&limit=" + str(len(starts))
        status, payload = _request_json(url)
        return status, _parse_binance(payload, [_mul(value, 1000) for value in starts]) if status == "OK" else None
    if source == BITGET:
        url = "https://api.bitget.com/api/v3/market/candles?category=USDT-FUTURES&symbol=" + symbol + "&interval=1H&startTime=" + str(start_ms) + "&endTime=" + str(end_ms - 1) + "&limit=" + str(len(starts))
        status, payload = _request_json(url)
        return status, _parse_bitget(payload, [_mul(value, 1000) for value in starts], symbol) if status == "OK" else None
    if source == GATE:
        url = "https://api.gateio.ws/api/v4/futures/usdt/candlesticks?contract=" + symbol + "&interval=1h&from=" + str(start) + "&to=" + str(end - 1)
        status, payload = _request_json(url)
        return status, _parse_gate(payload, list(starts), symbol) if status == "OK" else None
    return SOURCE_INVALID, None


def _empty_asset(source, asset, start, end, duration):
    return {
        "asset_id": asset,
        "asset": _asset_name(asset),
        "symbol": _source_symbol(source, asset),
        "market_start": start,
        "market_end": end,
        "duration_seconds": duration,
        "interval": "1h",
        "expected_candle_timestamps": [str(value if source == GATE else _mul(value, 1000)) for value in _expected_starts(start, duration)],
        "candles": [],
        "start_price": "",
        "end_price": "",
        "return_units": 0,
        "valid": False,
    }


def _empty_source(source, market_type, asset, start, end, duration, status):
    return {
        "source": source,
        "market_type": market_type,
        "asset_id": asset,
        "market_start": start,
        "market_end": end,
        "duration_seconds": duration,
        "interval": "1h",
        "source_status": status,
        "source_winner": "",
        "source_winner_id": OUTCOME_NONE,
        "assets": [_empty_asset(source, item, start, end, duration) for item in _asset_ids(market_type, asset)],
    }


def _source_once(source, market_type, asset, start, end, duration):
    rows = []
    for item in _asset_ids(market_type, asset):
        status, candles = _fetch_candles(source, item, start, end, duration)
        if status != "OK":
            return _empty_source(source, market_type, asset, start, end, duration, status)
        if candles is None:
            return _empty_source(source, market_type, asset, start, end, duration, SOURCE_INVALID)
        opening_scaled, opening_text = candles[0][1]
        closing_scaled, closing_text = candles[-1][2]
        rows.append({
            "asset_id": item,
            "asset": _asset_name(item),
            "symbol": _source_symbol(source, item),
            "market_start": start,
            "market_end": end,
            "duration_seconds": duration,
            "interval": "1h",
            "expected_candle_timestamps": [str(row[0]) for row in candles],
            "candles": [{"timestamp": row[0], "open": row[1][1], "close": row[2][1]} for row in candles],
            "start_price": opening_text,
            "end_price": closing_text,
            "return_units": _return_units(opening_scaled, closing_scaled),
            "valid": True,
            "_open_scaled": opening_scaled,
            "_close_scaled": closing_scaled,
        })
    winner = OUTCOME_NONE
    tied = False
    if market_type == UP_DOWN:
        opening = rows[0]["_open_scaled"]
        closing = rows[0]["_close_scaled"]
        if closing > opening:
            winner = UP
        elif closing < opening:
            winner = DOWN
        else:
            tied = True
    else:
        winner = rows[0]["asset_id"]
        for row in rows[1:]:
            comparison = _compare_return(row["_open_scaled"], row["_close_scaled"], rows[winner]["_open_scaled"], rows[winner]["_close_scaled"])
            if comparison > 0:
                winner, tied = row["asset_id"], False
            elif comparison == 0:
                tied = True
    if tied:
        winner = OUTCOME_NONE
    for row in rows:
        del row["_open_scaled"]
        del row["_close_scaled"]
    return {
        "source": source,
        "market_type": market_type,
        "asset_id": asset,
        "market_start": start,
        "market_end": end,
        "duration_seconds": duration,
        "interval": "1h",
        "source_status": SOURCE_TIE if tied else SOURCE_VALID,
        "source_winner": "" if winner == OUTCOME_NONE else _outcome_name(market_type, winner),
        "source_winner_id": winner,
        "assets": rows,
    }


def _fetch_source(source, market_type, asset, start, end, duration):
    for _attempt in range(MAX_SOURCE_ATTEMPTS):
        try:
            result = _source_once(source, market_type, asset, start, end, duration)
        except Exception:
            result = _empty_source(source, market_type, asset, start, end, duration, SOURCE_INVALID)
        if result["source_status"] != SOURCE_UNAVAILABLE:
            return result
    return _empty_source(source, market_type, asset, start, end, duration, SOURCE_UNAVAILABLE)


def _evidence_key(evidence, source, market_type, asset, start, end, duration):
    if not isinstance(evidence, dict) or evidence.get("source") != source or evidence.get("market_type") != market_type or evidence.get("asset_id") != asset or evidence.get("market_start") != start or evidence.get("market_end") != end or evidence.get("duration_seconds") != duration or evidence.get("interval") != "1h":
        return None
    status = evidence.get("source_status")
    winner = evidence.get("source_winner")
    winner_id = evidence.get("source_winner_id", OUTCOME_NONE)
    if status not in (SOURCE_VALID, SOURCE_TIE, SOURCE_UNAVAILABLE, SOURCE_INVALID) or not isinstance(winner, str) or not _is_u256(winner_id) or winner_id > OUTCOME_NONE:
        return None
    if status == SOURCE_VALID and (winner_id >= _outcome_count(market_type) or winner != _outcome_name(market_type, winner_id)):
        return None
    if status != SOURCE_VALID and (winner != "" or winner_id != OUTCOME_NONE):
        return None
    rows = evidence.get("assets")
    expected_assets = _asset_ids(market_type, asset)
    if not isinstance(rows, list) or len(rows) != len(expected_assets):
        return None
    parts = [source, str(market_type), str(asset), str(start), str(end), str(duration), "1h", status, winner, str(winner_id)]
    parsed = []
    valid_rows = status in (SOURCE_VALID, SOURCE_TIE)
    for index, item in enumerate(expected_assets):
        row = rows[index]
        expected_timestamps = [str(value if source == GATE else _mul(value, 1000)) for value in _expected_starts(start, duration)]
        if not isinstance(row, dict) or row.get("asset_id") != item or row.get("asset") != _asset_name(item) or row.get("symbol") != _source_symbol(source, item):
            return None
        if row.get("market_start") != start or row.get("market_end") != end or row.get("duration_seconds") != duration or row.get("interval") != "1h" or row.get("expected_candle_timestamps") != expected_timestamps:
            return None
        if not isinstance(row.get("start_price"), str) or not isinstance(row.get("end_price"), str) or not isinstance(row.get("return_units"), int) or isinstance(row.get("return_units"), bool) or not isinstance(row.get("valid"), bool):
            return None
        if row["valid"] != valid_rows:
            return None
        if not valid_rows:
            if row["candles"] != [] or row["start_price"] != "" or row["end_price"] != "" or row["return_units"] != 0:
                return None
        else:
            candles = row.get("candles")
            if not isinstance(candles, list) or len(candles) != len(expected_timestamps):
                return None
            for candle_index, candle in enumerate(candles):
                if not isinstance(candle, dict) or len(candle) != 3 or candle.get("timestamp") != int(expected_timestamps[candle_index]) or not isinstance(candle.get("open"), str) or not isinstance(candle.get("close"), str):
                    return None
                opening = _parse_price(candle["open"])
                closing = _parse_price(candle["close"])
                if opening is None or closing is None or candle["open"] != opening[1] or candle["close"] != closing[1]:
                    return None
            if row["start_price"] != candles[0]["open"] or row["end_price"] != candles[-1]["close"]:
                return None
            opening = _parse_price(row["start_price"])
            closing = _parse_price(row["end_price"])
            if opening is None or closing is None or row["start_price"] != opening[1] or row["end_price"] != closing[1] or row["return_units"] != _return_units(opening[0], closing[0]):
                return None
            parsed.append((item, opening[0], closing[0]))
        parts.extend([str(item), row["asset"], row["symbol"], json.dumps(row.get("candles", []), sort_keys=True, separators=(",", ":")), row["start_price"], row["end_price"], str(row["return_units"]), str(row["valid"])])
    if valid_rows:
        expected_winner = OUTCOME_NONE
        tied = False
        if market_type == UP_DOWN:
            if parsed[0][2] > parsed[0][1]:
                expected_winner = UP
            elif parsed[0][2] < parsed[0][1]:
                expected_winner = DOWN
            else:
                tied = True
        else:
            expected_winner = parsed[0][0]
            for item, opening, closing in parsed[1:]:
                current = parsed[expected_winner]
                comparison = _compare_return(opening, closing, current[1], current[2])
                if comparison > 0:
                    expected_winner, tied = item, False
                elif comparison == 0:
                    tied = True
        if tied:
            expected_winner = OUTCOME_NONE
        expected_status = SOURCE_TIE if expected_winner == OUTCOME_NONE else SOURCE_VALID
        if status != expected_status or winner_id != expected_winner or winner != ("" if expected_winner == OUTCOME_NONE else _outcome_name(market_type, expected_winner)):
            return None
    return "\x1f".join(parts)


def _proposal_valid(proposal, market_type, asset, start, end, duration):
    if not isinstance(proposal, dict) or not isinstance(proposal.get("source_results"), list) or len(proposal["source_results"]) != len(SOURCES):
        return False
    results = proposal["source_results"]
    for index, source in enumerate(SOURCES):
        if _evidence_key(results[index], source, market_type, asset, start, end, duration) is None:
            return False
    winner = _consensus_winner(results)
    count = proposal.get("consensus_count")
    return _is_u256(proposal.get("consensus_winner")) and proposal.get("consensus_winner") == winner and _is_u256(count) and count == (2 if winner != OUTCOME_NONE else 0)


def _consensus_winner(results):
    if not isinstance(results, list) or len(results) != len(SOURCES):
        return OUTCOME_NONE
    votes = [result.get("source_winner_id", OUTCOME_NONE) if isinstance(result, dict) and result.get("source_status") == SOURCE_VALID else OUTCOME_NONE for result in results]
    if votes[0] != OUTCOME_NONE and (votes[0] == votes[1] or votes[0] == votes[2]):
        return votes[0]
    if votes[1] != OUTCOME_NONE and votes[1] == votes[2]:
        return votes[1]
    return OUTCOME_NONE


def _common_votes(first, second, winner):
    count = 0
    for index in range(len(SOURCES)):
        left = first["source_results"][index]
        right = second["source_results"][index]
        if left.get("source_status") == SOURCE_VALID and right.get("source_status") == SOURCE_VALID and left.get("source_winner_id") == winner and right.get("source_winner_id") == winner:
            count += 1
    return count


def _settlement_proposal(market_type, asset, start, end, duration):
    def leader_fn():
        results = [_fetch_source(source, market_type, asset, start, end, duration) for source in SOURCES]
        winner = _consensus_winner(results)
        return {"source_results": results, "consensus_winner": winner, "consensus_count": 2 if winner != OUTCOME_NONE else 0}

    def validator_fn(leaders_result):
        try:
            if not isinstance(leaders_result, gl.vm.Return) or not isinstance(leaders_result.calldata, dict):
                return False
            leader = leaders_result.calldata
            if not _proposal_valid(leader, market_type, asset, start, end, duration):
                return False
            validator = leader_fn()
            if not _proposal_valid(validator, market_type, asset, start, end, duration):
                return False
            for index, source in enumerate(SOURCES):
                left = _evidence_key(leader["source_results"][index], source, market_type, asset, start, end, duration)
                right = _evidence_key(validator["source_results"][index], source, market_type, asset, start, end, duration)
                if left is None or left != right:
                    return False
            winner = _consensus_winner(leader["source_results"])
            if winner != _consensus_winner(validator["source_results"]):
                return False
            return winner == OUTCOME_NONE or _common_votes(leader, validator, winner) >= 2
        except Exception:
            return False

    return gl.vm.run_nondet(leader_fn, validator_fn)


class CrownEnergy(Contract):
    market_count: u256
    position_count: u256
    market_type: TreeMap[u256, u256]
    market_asset: TreeMap[u256, u256]
    market_start: TreeMap[u256, u256]
    market_end: TreeMap[u256, u256]
    market_duration: TreeMap[u256, u256]
    market_state: TreeMap[u256, str]
    market_winner: TreeMap[u256, u256]
    market_reason: TreeMap[u256, str]
    market_deadline: TreeMap[u256, u256]
    market_creation_keys: TreeMap[str, u256]
    market_source_evidence: TreeMap[str, str]
    market_pool: TreeMap[u256, u256]
    outcome_pool: TreeMap[str, u256]
    market_winning_pool: TreeMap[u256, u256]
    market_claimed_pool: TreeMap[u256, u256]
    market_claimed_winning_stake: TreeMap[u256, u256]
    market_refunded_pool: TreeMap[u256, u256]
    bettor_outcome: TreeMap[str, u256]
    bettor_stake: TreeMap[str, u256]
    bettor_claimed: TreeMap[str, bool]
    bettor_refunded: TreeMap[str, bool]

    def __init__(self):
        self.market_count = 0
        self.position_count = 0

    def _require_market(self, market_id):
        if not _is_u256(market_id) or market_id == 0 or market_id > self.market_count or market_id not in self.market_start:
            raise gl.vm.UserError("market not found")

    def _position_key(self, market_id, user):
        return str(market_id) + ":" + user.as_hex

    def _outcome_key(self, market_id, outcome):
        return str(market_id) + ":" + str(outcome)

    def _source_key(self, market_id, source):
        return str(market_id) + ":" + source

    def _pool_view(self, market_id):
        market_type = self.market_type[market_id]
        return {_outcome_name(market_type, outcome): self.outcome_pool.get(self._outcome_key(market_id, outcome), 0) for outcome in range(_outcome_count(market_type))}

    def _market_view(self, market_id):
        self._require_market(market_id)
        state = self.market_state[market_id]
        start = self.market_start[market_id]
        end = self.market_end[market_id]
        deadline = self.market_deadline[market_id]
        now = _now()
        winner = self.market_winner[market_id]
        total = self.market_pool.get(market_id, 0)
        claimed = self.market_claimed_pool.get(market_id, 0)
        refunded = self.market_refunded_pool.get(market_id, 0)
        if claimed > total or refunded > total:
            raise gl.vm.UserError("market liability overflow")
        consumed = claimed if state == STATE_RESOLVED else refunded if state == STATE_INCONCLUSIVE else 0
        market_type = self.market_type[market_id]
        asset = self.market_asset[market_id]
        return {
            "id": market_id,
            "market_id": market_id,
            "market_type": MARKET_TYPES[market_type],
            "market_type_id": market_type,
            "asset": _asset_name(asset) if market_type == UP_DOWN else ENERGY,
            "asset_id": asset,
            "basket": list(ASSET_NAMES) if market_type == DOMINANCE else [_asset_name(asset)],
            "outcomes": ["UP", "DOWN"] if market_type == UP_DOWN else list(ASSET_NAMES),
            "market_start": start,
            "start_time": start,
            "market_end": end,
            "end_time": end,
            "duration_seconds": self.market_duration[market_id],
            "state": state,
            "winner": "" if winner == OUTCOME_NONE else _outcome_name(market_type, winner),
            "winner_id": winner,
            "reason": self.market_reason.get(market_id, REASON_NONE),
            "betting_open": state == STATE_OPEN and now < start,
            "settlement_available": state not in (STATE_RESOLVED, STATE_INCONCLUSIVE) and now >= end and now < deadline,
            "retry_window_active": state not in (STATE_RESOLVED, STATE_INCONCLUSIVE) and end <= now < deadline,
            "deadline_expired": state not in (STATE_RESOLVED, STATE_INCONCLUSIVE) and now >= deadline,
            "settlement_deadline": deadline,
            "total_pool": total,
            "outcome_pools": self._pool_view(market_id),
            "winning_pool": self.market_winning_pool.get(market_id, 0),
            "claimed_pool": claimed,
            "claimed_winning_stake": self.market_claimed_winning_stake.get(market_id, 0),
            "refunded_pool": refunded,
            "remaining_pool": total - consumed,
            "evidence_available": self._source_key(market_id, BINANCE) in self.market_source_evidence,
        }

    def _position_view(self, market_id, user):
        self._require_market(market_id)
        key = self._position_key(market_id, user)
        market_type = self.market_type[market_id]
        outcome_count = _outcome_count(market_type)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        has_position = _is_u256(selected) and selected < outcome_count
        stake = self.bettor_stake.get(key, 0)
        state = self.market_state[market_id]
        winner = self.market_winner[market_id]
        claimed = self.bettor_claimed.get(key, False)
        refunded = self.bettor_refunded.get(key, False)
        position_won = state == STATE_RESOLVED and has_position and selected == winner
        position_lost = state == STATE_RESOLVED and has_position and selected != winner
        claimable = 0
        claim_available = False
        refund_available = state == STATE_INCONCLUSIVE and has_position and stake > 0 and not refunded and not claimed
        if position_won and not claimed and not refunded:
            winning_pool = self.market_winning_pool.get(market_id, 0)
            claimed_pool = self.market_claimed_pool.get(market_id, 0)
            claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
            total = self.market_pool.get(market_id, 0)
            new_stake = _add(claimed_stake, stake)
            if winning_pool > 0 and new_stake <= winning_pool and claimed_pool <= total:
                claimable = total - claimed_pool if new_stake == winning_pool else _mul_div(stake, total, winning_pool)
                claim_available = claimable > 0
        if refund_available:
            claimable = stake
        return {
            "market_id": market_id,
            "wallet": user.as_hex,
            "market_state": state,
            "market_type": MARKET_TYPES[market_type],
            "asset": _asset_name(self.market_asset[market_id]) if market_type == UP_DOWN else ENERGY,
            "selected_outcome": "" if not has_position else _outcome_name(market_type, selected),
            "selected_outcome_id": selected,
            "stake": stake,
            "remaining_capacity": 0 if stake >= MAX_BET_PER_MARKET else MAX_BET_PER_MARKET - stake,
            "can_top_up": state == STATE_OPEN and _now() < self.market_start[market_id] and has_position and stake < MAX_BET_PER_MARKET,
            "winner": "" if winner == OUTCOME_NONE else _outcome_name(market_type, winner),
            "position_won": position_won,
            "position_lost": position_lost,
            "claim_available": claim_available,
            "refund_available": refund_available,
            "claimable_amount": claimable,
            "claimed": claimed,
            "refunded": refunded,
        }

    def _send(self, recipient, amount):
        _NativeRecipient(recipient).emit_transfer(value=amount)

    def _create_market(self, market_type, asset, market_start, duration):
        if market_type not in (UP_DOWN, DOMINANCE) or duration not in DURATIONS:
            raise gl.vm.UserError("unsupported market configuration")
        if market_type == UP_DOWN:
            _asset_name(asset)
        elif asset != WTI_CRUDE:
            raise gl.vm.UserError("dominance basket is ENERGY")
        alignment = ONE_HOUR if duration == ONE_HOUR else TWO_HOURS
        if not _is_u256(market_start) or market_start % alignment != 0:
            raise gl.vm.UserError("market start must be aligned to the duration")
        now = _now()
        if market_start <= now:
            raise gl.vm.UserError("market start must be in the future")
        if self.market_count >= MAX_MARKETS:
            raise gl.vm.UserError("maximum market count reached")
        end = _add(market_start, duration)
        deadline = _add(end, SETTLEMENT_RETRY_WINDOW_SECONDS)
        _mul(end, 1000)
        subject = str(asset) if market_type == UP_DOWN else ENERGY
        key = "CROWN_ENERGY|V1|" + MARKET_TYPES[market_type] + "|" + subject + "|" + str(duration) + "|" + str(market_start)
        if key in self.market_creation_keys:
            raise gl.vm.UserError("duplicate market")
        market_id = _add(self.market_count, 1)
        self.market_count = market_id
        self.market_type[market_id] = market_type
        self.market_asset[market_id] = asset
        self.market_start[market_id] = market_start
        self.market_end[market_id] = end
        self.market_duration[market_id] = duration
        self.market_state[market_id] = STATE_OPEN
        self.market_winner[market_id] = OUTCOME_NONE
        self.market_reason[market_id] = REASON_NONE
        self.market_deadline[market_id] = deadline
        self.market_creation_keys[key] = market_id
        self.market_pool[market_id] = 0
        self.market_winning_pool[market_id] = 0
        self.market_claimed_pool[market_id] = 0
        self.market_claimed_winning_stake[market_id] = 0
        self.market_refunded_pool[market_id] = 0
        return market_id

    def _page_limit(self, limit):
        requested = int(limit)
        if requested < 1:
            raise gl.vm.UserError("page limit must be positive")
        return MAX_PAGE if requested > MAX_PAGE else requested

    @gl.public.view
    def get_config(self) -> dict:
        return {
            "protocol": PROTOCOL,
            "version": VERSION,
            "chain_id": CHAIN_ID,
            "market_types": list(MARKET_TYPES),
            "durations": {"1H": ONE_HOUR, "2H": TWO_HOURS},
            "supported_assets": list(ASSET_NAMES),
            "dominance_basket": ENERGY,
            "dominance_assets": list(ASSET_NAMES),
            "minimum_bet": MIN_BET,
            "maximum_bet_per_wallet_per_market": MAX_BET_PER_MARKET,
            "fee": 0,
            "fee_bps": 0,
            "sources": list(SOURCES),
            "consensus_threshold": 2,
            "consensus_sources": 3,
            "retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "settlement_retry_window_seconds": SETTLEMENT_RETRY_WINDOW_SECONDS,
            "binance_symbols": list(BINANCE_SYMBOLS),
            "gate_symbols": list(GATE_SYMBOLS),
            "bitget_symbols": list(BITGET_SYMBOLS),
            "payout_rounding": "floor; final winning claimant receives remaining pool",
            "zero_backed_winner_behavior": "INCONCLUSIVE with original-stake refunds",
        }

    @gl.public.view
    def get_market_count(self) -> u256:
        return self.market_count

    @gl.public.view
    def get_supported_assets(self) -> list[str]:
        return list(ASSET_NAMES)

    @gl.public.view
    def get_market_types(self) -> list[str]:
        return list(MARKET_TYPES)

    @gl.public.view
    def get_durations(self) -> dict:
        return {"1H": ONE_HOUR, "2H": TWO_HOURS}

    @gl.public.view
    def get_market(self, market_id: u256) -> dict:
        return self._market_view(market_id)

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
        market_ids = []
        markets = []
        for index in range(count):
            market_id = cursor + index + 1
            market_ids.append(market_id)
            markets.append(self._market_view(market_id))
        next_offset = cursor + count
        return {"market_ids": market_ids, "markets": markets, "next_offset": next_offset, "has_more": next_offset < total}

    @gl.public.view
    def get_open_markets(self, offset: u256, limit: u256) -> dict:
        requested = self._page_limit(limit)
        total = int(self.market_count)
        cursor = int(offset)
        if cursor > total:
            cursor = total
        if cursor >= total:
            return {"market_ids": [], "markets": [], "next_offset": cursor, "has_more": False, "scanned_count": 0}
        remaining = total - cursor
        scan = MAX_OPEN_SCAN if MAX_OPEN_SCAN < remaining else remaining
        now = _now()
        market_ids = []
        markets = []
        base_cursor = cursor
        for index in range(scan):
            market_id = base_cursor + index + 1
            if self.market_state[market_id] == STATE_OPEN and now < self.market_start[market_id]:
                market_ids.append(market_id)
                markets.append(self._market_view(market_id))
                if len(market_ids) == requested:
                    cursor = market_id
                    break
            cursor = market_id
        return {"market_ids": market_ids, "markets": markets, "next_offset": cursor, "has_more": cursor < total, "scanned_count": cursor - int(offset) if cursor >= int(offset) else 0}

    @gl.public.view
    def get_position(self, market_id: u256, wallet: Address) -> dict:
        return self._position_view(market_id, wallet)

    @gl.public.view
    def get_my_position(self, market_id: u256) -> dict:
        return self._position_view(market_id, gl.message.sender_address)

    @gl.public.view
    def get_claimable(self, market_id: u256, wallet: Address) -> u256:
        return self._position_view(market_id, wallet)["claimable_amount"]

    @gl.public.view
    def get_settlement_evidence(self, market_id: u256) -> dict:
        self._require_market(market_id)
        if self._source_key(market_id, BINANCE) not in self.market_source_evidence:
            raise gl.vm.UserError("settlement evidence unavailable")
        return {
            "market_id": market_id,
            "market_type": MARKET_TYPES[self.market_type[market_id]],
            "asset": _asset_name(self.market_asset[market_id]) if self.market_type[market_id] == UP_DOWN else ENERGY,
            "market_start": self.market_start[market_id],
            "market_end": self.market_end[market_id],
            "duration_seconds": self.market_duration[market_id],
            "winner": "" if self.market_winner[market_id] == OUTCOME_NONE else _outcome_name(self.market_type[market_id], self.market_winner[market_id]),
            "sources": [json.loads(self.market_source_evidence[self._source_key(market_id, source)]) for source in SOURCES],
        }

    @gl.public.write
    def create_up_down_market(self, asset: str, market_start: u256, duration_hours: u256) -> u256:
        asset_id = _asset_id(asset)
        if not _is_u256(duration_hours) or duration_hours not in (1, 2):
            raise gl.vm.UserError("duration must be 1H or 2H")
        return self._create_market(UP_DOWN, asset_id, market_start, DURATIONS[duration_hours - 1])

    @gl.public.write
    def create_dominance_market(self, category: str, market_start: u256, duration_hours: u256) -> u256:
        if category != ENERGY:
            raise gl.vm.UserError("dominance basket is ENERGY")
        if not _is_u256(duration_hours) or duration_hours not in (1, 2):
            raise gl.vm.UserError("duration must be 1H or 2H")
        return self._create_market(DOMINANCE, WTI_CRUDE, market_start, DURATIONS[duration_hours - 1])

    @gl.public.write.payable
    def place_bet(self, market_id: u256, outcome: str) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_OPEN:
            raise gl.vm.UserError("market is not open")
        if _now() >= self.market_start[market_id]:
            raise gl.vm.UserError("betting is closed")
        market_type = self.market_type[market_id]
        outcome_id = _outcome_id(market_type, outcome)
        amount = gl.message.value
        if not _is_u256(amount) or amount < MIN_BET:
            raise gl.vm.UserError("minimum bet is 1 GEN")
        key = self._position_key(market_id, gl.message.sender_address)
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        if selected != OUTCOME_NONE and selected != outcome_id:
            raise gl.vm.UserError("wallet outcome already selected")
        old_stake = self.bettor_stake.get(key, 0)
        if old_stake > MAX_BET_PER_MARKET or amount > MAX_BET_PER_MARKET - old_stake:
            raise gl.vm.UserError("maximum cumulative stake is 40 GEN")
        if selected == OUTCOME_NONE:
            if self.position_count >= MAX_POSITIONS:
                raise gl.vm.UserError("maximum position count reached")
            self.position_count = _add(self.position_count, 1)
        new_stake = _add(old_stake, amount)
        self.bettor_outcome[key] = outcome_id
        self.bettor_stake[key] = new_stake
        pool_key = self._outcome_key(market_id, outcome_id)
        self.outcome_pool[pool_key] = _add(self.outcome_pool.get(pool_key, 0), amount)
        self.market_pool[market_id] = _add(self.market_pool.get(market_id, 0), amount)

    @gl.public.write
    def settle_market(self, market_id: u256) -> str:
        self._require_market(market_id)
        state = self.market_state[market_id]
        if state in (STATE_RESOLVED, STATE_INCONCLUSIVE):
            raise gl.vm.UserError("market already terminal")
        now = _now()
        end = self.market_end[market_id]
        deadline = self.market_deadline[market_id]
        if now < end:
            raise gl.vm.UserError("market has not ended")
        if now >= deadline:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_reason[market_id] = REASON_EXPIRED
            return STATE_INCONCLUSIVE
        market_type = self.market_type[market_id]
        asset = self.market_asset[market_id]
        start = self.market_start[market_id]
        duration = self.market_duration[market_id]
        frozen_pools = {outcome: self.outcome_pool.get(self._outcome_key(market_id, outcome), 0) for outcome in range(_outcome_count(market_type))}
        try:
            proposal = _settlement_proposal(market_type, asset, start, end, duration)
        except Exception:
            self.market_state[market_id] = STATE_AWAITING
            self.market_reason[market_id] = REASON_RETRYABLE
            return STATE_AWAITING
        if not _proposal_valid(proposal, market_type, asset, start, end, duration):
            self.market_state[market_id] = STATE_AWAITING
            self.market_reason[market_id] = REASON_RETRYABLE
            return STATE_AWAITING
        results = proposal["source_results"]
        for index, source in enumerate(SOURCES):
            self.market_source_evidence[self._source_key(market_id, source)] = json.dumps(results[index], sort_keys=True, separators=(",", ":"))
        winner = proposal["consensus_winner"]
        if winner == OUTCOME_NONE:
            self.market_state[market_id] = STATE_AWAITING
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_reason[market_id] = REASON_NO_CONSENSUS
            return STATE_AWAITING
        winning_pool = frozen_pools.get(winner, 0)
        if winning_pool == 0:
            self.market_state[market_id] = STATE_INCONCLUSIVE
            self.market_winner[market_id] = OUTCOME_NONE
            self.market_reason[market_id] = REASON_ZERO_BACKED
            return STATE_INCONCLUSIVE
        self.market_state[market_id] = STATE_RESOLVED
        self.market_winner[market_id] = winner
        self.market_winning_pool[market_id] = winning_pool
        self.market_reason[market_id] = REASON_CONSENSUS
        return STATE_RESOLVED

    @gl.public.write
    def claim(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_RESOLVED:
            raise gl.vm.UserError("market is not resolved")
        key = self._position_key(market_id, gl.message.sender_address)
        if self.bettor_claimed.get(key, False) or self.bettor_refunded.get(key, False):
            raise gl.vm.UserError("position already claimed")
        selected = self.bettor_outcome.get(key, OUTCOME_NONE)
        if selected != self.market_winner[market_id]:
            raise gl.vm.UserError("not a winning position")
        stake = self.bettor_stake.get(key, 0)
        winning_pool = self.market_winning_pool.get(market_id, 0)
        total = self.market_pool.get(market_id, 0)
        claimed = self.market_claimed_pool.get(market_id, 0)
        claimed_stake = self.market_claimed_winning_stake.get(market_id, 0)
        new_stake = _add(claimed_stake, stake)
        if stake == 0 or winning_pool == 0 or new_stake > winning_pool or claimed > total:
            raise gl.vm.UserError("invalid winning accounting")
        payout = total - claimed if new_stake == winning_pool else _mul_div(stake, total, winning_pool)
        if payout == 0 or payout > total - claimed:
            raise gl.vm.UserError("payout exceeds remaining pool")
        self.bettor_claimed[key] = True
        self.market_claimed_pool[market_id] = _add(claimed, payout)
        self.market_claimed_winning_stake[market_id] = new_stake
        self._send(gl.message.sender_address, payout)

    @gl.public.write
    def claim_refund(self, market_id: u256) -> None:
        self._require_market(market_id)
        if self.market_state[market_id] != STATE_INCONCLUSIVE:
            raise gl.vm.UserError("market is not refundable")
        key = self._position_key(market_id, gl.message.sender_address)
        if self.bettor_claimed.get(key, False) or self.bettor_refunded.get(key, False):
            raise gl.vm.UserError("position already claimed")
        stake = self.bettor_stake.get(key, 0)
        total = self.market_pool.get(market_id, 0)
        refunded = self.market_refunded_pool.get(market_id, 0)
        if stake == 0 or refunded > total or stake > total - refunded:
            raise gl.vm.UserError("refund exceeds remaining pool")
        self.bettor_refunded[key] = True
        self.market_refunded_pool[market_id] = _add(refunded, stake)
        self._send(gl.message.sender_address, stake)
