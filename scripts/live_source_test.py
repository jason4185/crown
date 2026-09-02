"""Live Crown native-4H source check: 3 venues x 5 assets x 1 candle.

The URL builder and exact row validator are imported from Crown. This script
does not deploy or mutate a contract; it only performs the 15 public HTTP
requests needed to validate one completed Crown window.
"""

import datetime
import importlib.util
import json
import sys
import subprocess
import time
import types
from decimal import Decimal
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "Crown.py"
ASSETS = ("BTC", "ETH", "SOL", "BNB", "XRP")
SOURCES = ("BINANCE", "BITGET", "GATE")
DURATION = 14400
REQUEST_COUNT = 0


class Address:
    def __init__(self, value):
        self.as_bytes = value if isinstance(value, bytes) else bytes(20)
        self.as_b64 = ""
        self.as_hex = "0x" + self.as_bytes.hex()


class TreeMap:
    @classmethod
    def __class_getitem__(cls, _value):
        return cls


class Public:
    @staticmethod
    def view(function):
        return function

    class Write:
        def __call__(self, function):
            return function

        @property
        def payable(self):
            return self

    write = Write()


def load_contract():
    fake_gl = types.SimpleNamespace()
    fake_gl.Contract = object
    fake_gl.public = Public()
    fake_gl.vm = types.SimpleNamespace(UserError=RuntimeError, Return=object)
    fake = types.ModuleType("genlayer")
    fake.__all__ = ["gl", "u256", "Address", "TreeMap"]
    fake.gl = fake_gl
    fake.u256 = int
    fake.Address = Address
    fake.TreeMap = TreeMap
    previous = sys.modules.get("genlayer")
    sys.modules["genlayer"] = fake
    try:
        spec = importlib.util.spec_from_file_location("crown_live_contract", CONTRACT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("genlayer", None)
        else:
            sys.modules["genlayer"] = previous


CONTRACT = load_contract()


def utc_text(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")


def row_from_payload(source, payload):
    if source == "BINANCE":
        return payload[0] if isinstance(payload, list) and len(payload) == 1 else None
    if source == "BITGET":
        return payload["data"][0] if isinstance(payload, dict) and isinstance(payload.get("data"), list) and len(payload["data"]) == 1 else None
    return payload[0] if isinstance(payload, list) and len(payload) == 1 else None


def row_values(source, row):
    if source == "GATE":
        return row[5], row[2]
    return row[1], row[4]


def fetch(url):
    global REQUEST_COUNT
    REQUEST_COUNT += 1
    try:
        completed = subprocess.run(
            [
                "curl", "--silent", "--show-error", "--max-time", "20",
                "--user-agent", "Crown-live-native-4h-check/1.0",
                "--write-out", "\nCROWN_HTTP_STATUS:%{http_code}", url,
            ],
            capture_output=True,
            check=False,
        )
        if completed.returncode != 0:
            return 0, b"", completed.stderr.decode("utf-8", "replace").strip()
        marker = b"\nCROWN_HTTP_STATUS:"
        if marker not in completed.stdout:
            return 0, b"", "curl response had no HTTP status marker"
        body, status = completed.stdout.rsplit(marker, 1)
        return int(status), body, ""
    except Exception as error:
        return 0, b"", type(error).__name__ + ": " + str(error)


def target_window():
    now = int(time.time())
    target_end = ((now - 120) // DURATION) * DURATION
    return target_end - DURATION, target_end


def print_urls():
    target_start, target_end = target_window()
    for source in SOURCES:
        for asset in ASSETS:
            url = CONTRACT._source_url(source, asset, target_start, target_end, DURATION)
            print("\t".join((source, asset, str(target_start), str(target_end), url)))


def main():
    if len(sys.argv) > 1 and sys.argv[1] == "--urls":
        print_urls()
        return
    target_start, target_end = target_window()
    results = {source: {} for source in SOURCES}
    print("CROWN LIVE NATIVE 4H SOURCE TEST")
    print("Target UTC window: " + utc_text(target_start) + " -> " + utc_text(target_end))
    print("Expected opening timestamp: {}".format(target_start))
    print("Strategy: NATIVE_4H_CANDLES; expected requests: 15")

    for source in SOURCES:
        for asset in ASSETS:
            url = CONTRACT._source_url(source, asset, target_start, target_end, DURATION)
            status, body, error = fetch(url)
            record = {
                "source": source,
                "asset": asset,
                "symbol": CONTRACT._symbol(source, asset),
                "requested_start": target_start,
                    "requested_end": target_end,
                "url": url,
                "http_status": status,
                "error": error,
                "valid": False,
            }
            if status == 200 and body:
                try:
                    payload = json.loads(body.decode("utf-8"))
                    row = row_from_payload(source, payload)
                    parsed = CONTRACT._row_from_payload(source, payload, target_start, target_end)
                    record["returned_timestamp"] = (
                        int(row[0]) // 1000 if source in ("BINANCE", "BITGET") else int(row[0])
                    ) if row is not None else None
                    if row is not None:
                        opened, closed = row_values(source, row)
                        record["open"] = opened
                        record["close"] = closed
                    record["finalized"] = "ASSUMED_AFTER_FIXED_GRACE"
                    if source == "BINANCE" and row is not None:
                        record["finalized"] = len(row) == 12 and int(row[6]) == target_end * 1000 - 1
                    if source == "GATE" and row is not None and len(row) == 8:
                        record["finalized"] = row[7] is True or row[7] == "true"
                    if parsed is None:
                        record["error"] = "Crown exact native-4H row validation failed"
                    else:
                        record["valid"] = True
                        record["open_fixed"], record["close_fixed"] = parsed
                        record["return_scaled"] = CONTRACT._normalized_return(parsed[0], parsed[1])
                        record["return_percent"] = str(
                            Decimal(record["return_scaled"]) / Decimal(CONTRACT.RETURN_SCALE) * Decimal(100)
                        )
                except Exception as parse_error:
                    record["error"] = "parse/validation: " + type(parse_error).__name__ + ": " + str(parse_error)
            elif not record["error"]:
                record["error"] = "empty or non-200 response"
            results[source][asset] = record
            print(
                "CANDLE source={} asset={} symbol={} requested={} returned={} open={} close={} return={} finalized={} status={}".format(
                    source,
                    asset,
                    record["symbol"],
                    utc_text(target_start),
                    utc_text(record["returned_timestamp"]) if record.get("returned_timestamp") is not None else "NONE",
                    record.get("open", "NONE"),
                    record.get("close", "NONE"),
                    record.get("return_scaled", "NONE"),
                    record.get("finalized", "NONE"),
                    "VALID" if record["valid"] else "FAIL: " + record["error"],
                )
            )
            time.sleep(0.08)

    source_winners = {}
    for source in SOURCES:
        print("\n{}:".format(source))
        values = []
        source_pass = True
        for asset in ASSETS:
            record = results[source][asset]
            if not record["valid"]:
                source_pass = False
                print(asset + ": INVALID/UNAVAILABLE — " + record["error"])
                continue
            values.append((record["open_fixed"], record["close_fixed"]))
            print(
                "{}: open {} close {} return_scaled {} return_pct {}%".format(
                    asset, record["open"], record["close"], record["return_scaled"], record["return_percent"]
                )
            )
        winner = CONTRACT._dominance_winner(values) if len(values) == len(ASSETS) else ""
        source_winners[source] = winner
        print("PASS: {}".format(source_pass and winner != ""))
        print("Winner: {}".format(winner or "TIE/NO VALID WINNER"))

    votes = {asset: 0 for asset in ASSETS}
    for winner in source_winners.values():
        if winner in votes:
            votes[winner] += 1
    final_winner = ""
    consensus_count = 0
    for asset in ASSETS:
        if votes[asset] > consensus_count:
            final_winner = asset
            consensus_count = votes[asset]
    final_winner = final_winner if consensus_count >= 2 else "INCONCLUSIVE"
    print("\nTIMESTAMP ALIGNMENT:")
    for source in SOURCES:
        aligned = all(
            results[source][asset].get("returned_timestamp") == target_start and results[source][asset]["valid"]
            for asset in ASSETS
        )
        print("{}: {}".format(source, "PASS" if aligned else "FAIL"))
    print("\nSOURCE WINNERS:")
    for source in SOURCES:
        print(source + " -> " + (source_winners[source] or "NO VALID WINNER"))
    print("CROWN RESULT: {} ({} valid votes)".format(final_winner, consensus_count))
    print("ALL 15 REQUESTS VALID: {}".format(all(results[source][asset]["valid"] for source in SOURCES for asset in ASSETS)))
    print("REQUESTS MADE: {}".format(REQUEST_COUNT))
    print(json.dumps({"target_start": target_start, "target_end": target_end, "source_winners": source_winners, "result": final_winner, "results": results}, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
