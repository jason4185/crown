"""Analyze the response files produced by the direct curl live check."""

import json
import sys
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import live_source_test as live


ASSETS = live.ASSETS
SOURCES = live.SOURCES


def main():
    url_file = Path(sys.argv[1])
    response_dir = Path(sys.argv[2])
    results = {source: {asset: None for asset in ASSETS} for source in SOURCES}
    rows = [line.rstrip("\n").split("\t") for line in url_file.read_text().splitlines() if line]
    for source, asset, start, end, url in rows:
        start = int(start)
        end = int(end)
        stem = source + "_" + asset
        status_path = response_dir / (stem + ".status")
        body_path = response_dir / (stem + ".json")
        status = status_path.read_text().strip() if status_path.exists() else "000"
        body = body_path.read_bytes() if body_path.exists() else b""
        record = {
            "requested_start": start,
            "requested_end": end,
            "url": url,
            "http_status": int(status or 0),
            "valid": False,
        }
        if status == "200":
            try:
                payload = json.loads(body.decode("utf-8"))
                row = live.row_from_payload(source, payload)
                parsed = live.CONTRACT._row_from_payload(source, payload, start, end)
                record["returned_timestamp"] = (int(row[0]) // 1000 if source in ("BINANCE", "BITGET") else int(row[0])) if row is not None else None
                if source == "GATE":
                    record["open"] = row[5] if row is not None else None
                    record["close"] = row[2] if row is not None else None
                else:
                    record["open"] = row[1] if row is not None else None
                    record["close"] = row[4] if row is not None else None
                if source == "BINANCE" and row is not None:
                    record["finalized"] = len(row) == 12 and int(row[6]) == end * 1000 - 1
                else:
                    record["finalized"] = "ASSUMED_AFTER_FIXED_GRACE"
                if parsed is None:
                    record["error"] = "Crown exact-row validation failed"
                else:
                    record["valid"] = True
                    record["open_fixed"], record["close_fixed"] = parsed
            except Exception as error:
                record["error"] = "parse/validation: " + type(error).__name__ + ": " + str(error)
        else:
            error_path = response_dir / (stem + ".err")
            detail = error_path.read_text().strip() if error_path.exists() else ""
            record["error"] = detail or "HTTP " + (status or "000")
        results[source][asset] = record
        print("CANDLE source={} asset={} requested={} returned={} open={} close={} finalized={} valid={}".format(
            source,
            asset,
            live.utc_text(start),
            live.utc_text(record["returned_timestamp"]) if record.get("returned_timestamp") is not None else "NONE",
            record.get("open", "NONE"),
            record.get("close", "NONE"),
            record.get("finalized", "NONE"),
            record["valid"],
        ))

    target_start = int(rows[0][2])
    target_end = int(rows[0][3])
    source_winners = {}
    print("CROWN LIVE SOURCE TEST")
    print("Target UTC window: {} -> {}".format(live.utc_text(target_start), live.utc_text(target_end)))
    for source in SOURCES:
        print("\n{}:".format(source))
        values = []
        source_pass = True
        for asset in ASSETS:
            candle = results[source][asset]
            if not candle["valid"]:
                source_pass = False
                print(asset + ": INVALID/UNAVAILABLE")
                if candle.get("error"):
                    print("  failure: " + candle["error"])
                continue
            opened = candle["open_fixed"]
            closed = candle["close_fixed"]
            normalized = live.CONTRACT._normalized_return(opened, closed)
            values.append((opened, closed))
            percentage = Decimal(normalized) / Decimal(live.CONTRACT.RETURN_SCALE) * Decimal(100)
            print("{}: open {} close {} return_scaled {} return_pct {}%".format(
                asset, candle["open"], candle["close"], normalized, percentage
            ))
        winner = live.CONTRACT._dominance_winner(values) if len(values) == len(ASSETS) else ""
        source_winners[source] = winner
        print("PASS: {}".format(source_pass))
        print("Winner: {}".format(winner or "TIE/NO VALID WINNER"))
    votes = {asset: 0 for asset in ASSETS}
    for winner in source_winners.values():
        if winner in votes:
            votes[winner] += 1
    candidate = max(votes, key=votes.get)
    count = votes[candidate]
    print("\nSOURCE CONSENSUS:")
    for source in SOURCES:
        print(source + " -> " + (source_winners[source] or "NO VALID WINNER"))
    print("CROWN RESULT: {}".format(candidate if count >= 2 else "INCONCLUSIVE"))
    print("REQUESTS MADE: {}".format(len(rows)))


if __name__ == "__main__":
    main()
