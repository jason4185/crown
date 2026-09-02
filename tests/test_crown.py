import base64
import copy
import datetime
import importlib.util
import json
import pickle
import re
import sys
import types
import urllib.parse
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "Crown.py"
NOW = 1767225600  # 2026-01-01T00:00:00Z
FOUR_H_DAY = NOW + 86400  # 2026-01-02T00:00:00Z
START = FOUR_H_DAY  # 2026-01-02T00:00:00Z
GEN = 10**18
ALICE = "0x" + "11" * 20
BOB = "0x" + "22" * 20
CHARLIE = "0x" + "33" * 20
ASSETS = ("BTC", "ETH", "SOL", "BNB", "XRP")
SOURCES = ("BINANCE", "BITGET", "GATE")
HOSTS = {
    "BINANCE": r"api\.binance\.com",
    "BITGET": r"api\.bitget\.com",
    "GATE": r"api\.gateio\.ws",
}


class ContractError(RuntimeError):
    pass


class ConsensusError(RuntimeError):
    pass


class Address:
    def __init__(self, value):
        if isinstance(value, Address):
            self.as_bytes = value.as_bytes
        elif isinstance(value, str):
            self.as_bytes = bytes.fromhex(value[2:])
        else:
            self.as_bytes = bytes(value)
        if len(self.as_bytes) != 20:
            raise ValueError("invalid address")
        self.as_b64 = base64.b64encode(self.as_bytes).decode("ascii")
        self.as_hex = "0x" + self.as_bytes.hex()

    def __eq__(self, other):
        return isinstance(other, Address) and self.as_bytes == other.as_bytes


class TreeMap:
    @classmethod
    def __class_getitem__(cls, _value):
        return cls


class FakeVM:
    class UserError(ContractError):
        pass

    class Return:
        def __init__(self, calldata):
            self.calldata = calldata

    def __init__(self):
        self.proposals = []

    def run_nondet(self, leader, validator):
        proposal = leader()
        self.proposals.append(copy.deepcopy(proposal))
        if not validator(self.Return(copy.deepcopy(proposal))):
            raise ConsensusError("proposal mismatch")
        return proposal


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


def load_contract_module():
    fake_gl = types.SimpleNamespace()
    fake_gl.Contract = object
    fake_gl.public = Public()
    fake_gl.vm = types.SimpleNamespace(UserError=ContractError, Return=FakeVM.Return)
    fake = types.ModuleType("genlayer")
    fake.__all__ = ["gl", "u256", "Address", "TreeMap"]
    fake.gl = fake_gl
    fake.u256 = int
    fake.Address = Address
    fake.TreeMap = TreeMap
    previous = sys.modules.get("genlayer")
    sys.modules["genlayer"] = fake
    try:
        spec = importlib.util.spec_from_file_location("crown_test_contract", CONTRACT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        if previous is None:
            sys.modules.pop("genlayer", None)
        else:
            sys.modules["genlayer"] = previous


CONTRACT = load_contract_module()


def response(status=200, body=b""):
    return types.SimpleNamespace(status=status, body=body if isinstance(body, bytes) else body.encode())


class FakeWeb:
    def __init__(self):
        self.routes = []
        self.calls = []

    def add(self, pattern, value):
        self.routes.append((re.compile(pattern), value))

    def get(self, url):
        self.calls.append(url)
        for pattern, value in self.routes:
            if pattern.search(url):
                if isinstance(value, list):
                    selected = value.pop(0) if len(value) > 1 else value[0]
                else:
                    selected = value
                if callable(selected):
                    selected = selected(url)
                if isinstance(selected, BaseException):
                    raise selected
                return copy.deepcopy(selected)
        raise RuntimeError("unmocked web request")


class Harness:
    def __init__(self, sender=ALICE):
        self.module = CONTRACT
        self.vm = FakeVM()
        self.web = FakeWeb()
        self.transfers = []
        self.gl = types.SimpleNamespace(
            vm=self.vm,
            nondet=types.SimpleNamespace(web=self.web),
            message=types.SimpleNamespace(sender_address=Address(sender), value=0),
            message_raw={"datetime": "2026-01-01T00:00:00Z"},
        )
        self.gl.get_contract_at = lambda user: types.SimpleNamespace(
            emit_transfer=lambda **kwargs: self.transfers.append((user.as_hex, kwargs))
        )
        self.module.gl = self.gl
        self.contract = self.module.Crown()
        self.contract.market_records = {}
        self.contract.market_identity = {}
        self.contract.position_records = {}

    def sender(self, value):
        self.gl.message.sender_address = Address(value)

    def time(self, value):
        self.gl.message_raw["datetime"] = value

    def create(self, start=START, duration=14400):
        return self.contract.create_market(start, duration)

    def bet(self, asset, amount=GEN, sender=ALICE, market_id=1):
        self.sender(sender)
        self.gl.message.value = amount
        self.contract.place_position(market_id, asset)
        self.gl.message.value = 0

    def mock_sources(self, winners=None, modes=None, negative=False):
        winners = {} if winners is None else winners
        modes = {} if modes is None else modes
        for source in SOURCES:
            for asset in ASSETS:
                symbol = asset + ("_USDT" if source == "GATE" else "USDT")

                def make_response(url, source=source, asset=asset):
                    mode = modes.get(source, "VALID")
                    if mode == "UNAVAILABLE":
                        return response(500, b"provider unavailable")
                    parsed = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
                    if source == "GATE":
                        candle_start = int(parsed["from"][0])
                        candle_end = int(parsed["to"][0])
                        start_ms = candle_start * 1000
                        end_ms = candle_end * 1000
                    else:
                        start_ms = int(parsed["startTime"][0])
                        end_ms = int(parsed["endTime"][0])
                    close = "98" if negative else "101"
                    winner = winners.get(source, "SOL")
                    if winner == asset:
                        close = "99" if negative else "110"
                    if mode == "TIE":
                        close = "98" if negative else "101"
                    timestamp = start_ms if source != "GATE" else candle_start
                    if mode == "WRONG_TIMESTAMP":
                        timestamp += 14400000 if source == "GATE" else 14400000
                    opened = "0" if mode == "ZERO" else "100"
                    if mode in ("MALFORMED", "MALFORMED_ENVELOPE"):
                        return response(200, b"{" if mode == "MALFORMED" else b'{"unexpected":true}')
                    if mode == "INVALID_PRICE":
                        opened = "bad"
                    if mode == "WRONG_CLOSE":
                        end_ms += 1
                    if source == "BINANCE":
                        row = [timestamp, opened, "0", "0", close, "0", end_ms, "0", "0", "0", "0", "0"]
                        body = json.dumps([row])
                    elif source == "BITGET":
                        data = [] if mode == "MISSING" else [[str(timestamp), opened, "0", "0", close, "0", "0"]]
                        body = json.dumps({"code": "00000", "msg": "success", "data": data})
                    else:
                        data = [] if mode == "MISSING" else [[str(timestamp), "0", close, "0", "0", opened]]
                        body = json.dumps(data)
                    if mode == "MISSING" and source == "BINANCE":
                        body = b"[]"
                    return response(200, body)

                self.web.add(HOSTS[source] + r".*" + re.escape(symbol) + r".*", make_response)


def expect_error(function, text=None):
    with pytest.raises(ContractError) as caught:
        function()
    if text is not None:
        assert text in str(caught.value)


def settle(harness, winners=None, modes=None, negative=False, market_id=1):
    harness.mock_sources(winners=winners, modes=modes, negative=negative)
    market = harness.contract._market(market_id)
    ready = int(market["settlement_ready_timestamp"])
    ready_text = datetime.datetime.fromtimestamp(ready, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    harness.time(ready_text)
    harness.sender(CHARLIE)
    harness.contract.settle_market(market_id)


def settle_at(harness, timestamp, market_id=1):
    text = datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    harness.time(text)
    harness.sender(CHARLIE)
    harness.contract.settle_market(market_id)


def test_protocol_config_is_fixed_and_complete():
    h = Harness()
    config = h.contract.get_protocol_config()
    assert config["assets"] == list(ASSETS)
    assert config["durations_seconds"] == [14400]
    assert config["sources"] == list(SOURCES)
    assert config["min_stake"] == GEN
    assert config["max_stake"] == 10 * GEN
    assert config["consensus_threshold"] == 2
    assert config["minimum_creation_lead_seconds"] == 300
    assert config["betting_close_lead_seconds"] == 60
    assert config["settlement_grace_seconds"] == 60
    assert config["duration"] == 14400
    assert config["settlement_retry_window_seconds"] == 1800
    assert config["source_strategy"] == "NATIVE_4H_CANDLES"


def test_permissionless_creation_and_market_detail():
    h = Harness(sender=BOB)
    market_id = h.create()
    assert market_id == 1
    market = h.contract.get_market(market_id)
    assert market["creator"] == BOB.lower()
    assert market["betting_close_timestamp"] == START - 60
    assert market["performance_start_timestamp"] == START
    assert market["duration"] == 14400
    assert market["performance_end_timestamp"] == START + 14400
    assert market["settlement_ready_timestamp"] == START + 14400 + 60
    assert market["settlement_timestamp"] == START + 14400 + 60
    assert market["status"] == "OPEN"


@pytest.mark.parametrize("duration", [1, 3600, 7200, 43200, 86400, 172800])
def test_invalid_duration_is_rejected(duration):
    h = Harness()
    expect_error(lambda: h.create(duration=duration), "duration")
    assert h.contract.market_count == 0


def test_past_malformed_unaligned_and_duplicate_starts_are_rejected():
    h = Harness()
    expect_error(lambda: h.create(start=NOW), "future")
    expect_error(lambda: h.create(start=START + 1), "aligned")
    h.time("2026-01-01T00:00:00")
    expect_error(lambda: h.create(), "transaction time")
    h.time("2026-01-01T00:00:00Z")
    h.create()
    expect_error(lambda: h.create(), "duplicate")


@pytest.mark.parametrize("start", [FOUR_H_DAY + (index * 14400) for index in range(6)])
def test_all_exchange_aligned_4h_boundaries_are_accepted(start):
    h = Harness()
    market_id = h.create(start=start, duration=14400)
    market = h.contract.get_market(market_id)
    assert market["start_timestamp"] == start
    assert market["performance_end_timestamp"] == start + 14400
    assert start % 14400 == 0


@pytest.mark.parametrize(
    "start",
    [FOUR_H_DAY + 3600, FOUR_H_DAY + 3 * 3600 + 1800, FOUR_H_DAY + 9 * 3600],
)
def test_non_boundary_4h_starts_are_rejected(start):
    h = Harness()
    expect_error(lambda: h.create(start=start, duration=14400), "aligned")


@pytest.mark.parametrize("offset", [-1, 1])
def test_one_second_around_4h_boundary_is_rejected(offset):
    h = Harness()
    boundary = FOUR_H_DAY + 14400
    expect_error(lambda: h.create(start=boundary + offset, duration=14400), "aligned")


def test_past_aligned_candle_and_insufficient_creation_lead_are_rejected():
    h = Harness()
    expect_error(lambda: h.create(start=NOW, duration=14400), "future")
    h.time("2026-01-02T03:56:00Z")
    expect_error(lambda: h.create(start=FOUR_H_DAY + 14400, duration=14400), "lead time")


def test_positions_support_same_asset_topups_but_no_second_asset():
    h = Harness()
    h.create()
    h.bet("BTC", 2 * GEN)
    h.bet("BTC", 3 * GEN)
    position = h.contract.get_user_position(1, Address(ALICE))
    assert position["selected_asset"] == "BTC"
    assert position["total_stake"] == 5 * GEN
    expect_error(lambda: h.bet("ETH", GEN), "one asset")
    assert h.contract.get_user_position(1, Address(ALICE))["total_stake"] == 5 * GEN


@pytest.mark.parametrize("amount", [0, GEN - 1, 10 * GEN + 1])
def test_stake_bounds_leave_no_partial_mutation(amount):
    h = Harness()
    h.create()
    expect_error(lambda: h.bet("SOL", amount), "GEN")
    market = h.contract.get_market(1)
    assert market["total_pool"] == 0
    assert h.contract.get_user_position(1, Address(ALICE))["has_position"] is False


def test_cumulative_stake_cap_and_close_boundary():
    h = Harness()
    h.create()
    h.bet("SOL", 9 * GEN)
    expect_error(lambda: h.bet("SOL", 2 * GEN), "cumulative")
    h.time("2026-01-01T23:59:00Z")
    expect_error(lambda: h.bet("SOL", GEN), "closed")
    assert h.contract.get_market(1)["total_pool"] == 9 * GEN


def test_timestamp_lifecycle_and_exact_settlement_boundary():
    h = Harness()
    h.create()
    assert h.contract.get_market(1)["status"] == "OPEN"
    h.time("2026-01-01T23:58:59Z")
    assert h.contract.get_market(1)["status"] == "OPEN"
    h.time("2026-01-01T23:59:00Z")
    assert h.contract.get_market(1)["status"] == "LOCKED"
    h.time("2026-01-01T23:59:59Z")
    assert h.contract.get_market(1)["status"] == "LOCKED"
    h.time("2026-01-02T00:00:00Z")
    assert h.contract.get_market(1)["status"] == "LIVE"
    h.time("2026-01-02T03:59:59Z")
    assert h.contract.get_market(1)["status"] == "LIVE"
    h.time("2026-01-02T04:00:00Z")
    assert h.contract.get_market(1)["status"] == "FINALIZING"
    h.time("2026-01-02T04:00:59Z")
    assert h.contract.get_market(1)["status"] == "FINALIZING"
    h.time("2026-01-02T04:01:00Z")
    assert h.contract.get_market(1)["status"] == "SETTLEMENT_READY"


@pytest.mark.parametrize("winner", ASSETS)
def test_each_asset_can_win_relative_performance(winner):
    h = Harness()
    h.create()
    h.bet(winner)
    settle(h, winners={source: winner for source in SOURCES})
    assert h.contract.get_resolution(1)["final_winner"] == winner


def test_all_negative_returns_choose_the_least_negative_asset():
    h = Harness()
    h.create()
    h.bet("XRP")
    settle(h, winners={source: "XRP" for source in SOURCES}, negative=True)
    assert h.contract.get_resolution(1)["final_winner"] == "XRP"
    assert h.module._normalized_return(100 * 10**18, 99 * 10**18) > h.module._normalized_return(100 * 10**18, 98 * 10**18)


def test_exact_fixed_precision_tie_is_not_a_source_winner():
    h = Harness()
    h.create()
    h.bet("BTC")
    h.mock_sources(modes={source: "TIE" for source in SOURCES})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    resolution = h.contract.get_resolution(1)
    assert resolution["binance_status"] == "TIE"
    assert resolution["valid_source_count"] == 0
    assert resolution["status"] == "INCONCLUSIVE"


def test_source_envelopes_timestamps_prices_and_retry_bounds():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={source: "SOL" for source in SOURCES}, modes={"BINANCE": "WRONG_TIMESTAMP"})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    resolution = h.contract.get_resolution(1)
    assert resolution["binance_status"] == "INVALID"
    assert resolution["bitget_status"] == "VALID"
    assert resolution["gate_status"] == "VALID"
    # Leader and validator each independently fetch the bounded proposal.
    assert sum("api.binance.com" in url for url in h.web.calls) == 2


@pytest.mark.parametrize("source", SOURCES)
def test_wrong_source_timestamp_is_rejected_for_every_venue(source):
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={name: "SOL" for name in SOURCES}, modes={source: "WRONG_TIMESTAMP"})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1)[source.lower() + "_status"] == "INVALID"


@pytest.mark.parametrize("source", SOURCES)
def test_missing_candle_is_invalid_for_every_source(source):
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={name: "SOL" for name in SOURCES}, modes={source: "MISSING"})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1)[source.lower() + "_status"] == "INVALID"


def test_binance_close_boundary_and_gate_row_shape_are_strict():
    for source, mode in (("BINANCE", "WRONG_CLOSE"), ("GATE", "MALFORMED")):
        h = Harness()
        h.create()
        h.bet("SOL")
        h.mock_sources(winners={name: "SOL" for name in SOURCES}, modes={source: mode})
        h.time("2026-01-02T04:02:00Z")
        h.contract.settle_market(1)
        assert h.contract.get_resolution(1)[source.lower() + "_status"] == "INVALID"


def test_bitget_current_seven_field_row_is_valid_and_legacy_eight_field_is_not():
    valid = {
        "code": "00000",
        "msg": "success",
        "data": [[str(START * 1000), "100", "101", "99", "100", "1", "2"]],
    }
    assert CONTRACT._row_from_payload("BITGET", valid, START, START + 14400) is not None
    legacy = {
        "code": "00000",
        "msg": "success",
        "data": [[str(START * 1000), "100", "101", "99", "100", "1", "2", "3"]],
    }
    assert CONTRACT._row_from_payload("BITGET", legacy, START, START + 14400) is None


@pytest.mark.parametrize("mode", ["MALFORMED", "MALFORMED_ENVELOPE", "INVALID_PRICE", "ZERO"])
def test_malformed_source_data_is_invalid_and_cannot_vote(mode):
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={source: "SOL" for source in SOURCES}, modes={"BITGET": mode})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1)["bitget_status"] == "INVALID"


def test_unavailable_source_is_bounded_and_does_not_brick_settlement():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={source: "SOL" for source in SOURCES}, modes={"GATE": "UNAVAILABLE"})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    resolution = h.contract.get_resolution(1)
    assert resolution["gate_status"] == "UNAVAILABLE"
    assert resolution["valid_source_count"] == 2
    assert resolution["final_winner"] == "SOL"
    # The adapter retries that source three times for both leader and validator.
    assert sum("api.gateio.ws" in url for url in h.web.calls) == 6


def test_one_valid_source_and_all_unavailable_sources_are_inconclusive():
    for modes in (
        {"BINANCE": "VALID", "BITGET": "UNAVAILABLE", "GATE": "UNAVAILABLE"},
        {"BINANCE": "UNAVAILABLE", "BITGET": "UNAVAILABLE", "GATE": "UNAVAILABLE"},
    ):
        h = Harness()
        h.create()
        h.bet("SOL")
        h.mock_sources(winners={source: "SOL" for source in SOURCES}, modes=modes)
        h.time("2026-01-02T04:02:00Z")
        h.contract.settle_market(1)
        resolution = h.contract.get_resolution(1)
        assert resolution["status"] == "UNRESOLVED"
        assert resolution["final_winner"] == ""
        assert resolution["valid_source_count"] <= 1
        ready = int(h.contract._market(1)["settlement_ready_timestamp"])
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS)
        assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"


def test_two_of_three_consensus_and_caller_independence():
    h = Harness()
    h.create()
    h.bet("SOL")
    settle(h, winners={"BINANCE": "SOL", "BITGET": "SOL", "GATE": "ETH"})
    first = copy.deepcopy(h.contract.get_resolution(1))
    h.sender(BOB)
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1) == first


@pytest.mark.parametrize("modes", [
    {"BINANCE": "VALID", "BITGET": "VALID", "GATE": "VALID"},
    {"BINANCE": "VALID", "BITGET": "VALID", "GATE": "UNAVAILABLE"},
])
def test_consensus_resolves_only_when_two_sources_agree(modes):
    h = Harness()
    h.create()
    h.bet("SOL")
    winners = {"BINANCE": "SOL", "BITGET": "SOL", "GATE": "ETH"}
    settle(h, winners=winners, modes=modes)
    assert h.contract.get_resolution(1)["final_winner"] == "SOL"


@pytest.mark.parametrize("modes", [
    {"BINANCE": "VALID", "BITGET": "VALID", "GATE": "VALID"},
    {"BINANCE": "VALID", "BITGET": "VALID", "GATE": "UNAVAILABLE"},
])
def test_no_two_source_agreement_is_inconclusive(modes):
    h = Harness()
    h.create()
    h.bet("SOL")
    winners = {"BINANCE": "BTC", "BITGET": "ETH", "GATE": "BNB"}
    settle(h, winners=winners, modes=modes)
    expected_status = "UNRESOLVED" if "UNAVAILABLE" in modes.values() else "INCONCLUSIVE"
    assert h.contract.get_resolution(1)["status"] == expected_status
    assert h.contract.get_resolution(1)["final_winner"] == ""


def test_parimutuel_claims_are_independent_and_final_claim_gets_integer_dust():
    h = Harness()
    h.create()
    h.bet("SOL", GEN, ALICE)
    h.bet("SOL", 2 * GEN, BOB)
    h.bet("BTC", GEN, CHARLIE)
    settle(h, winners={source: "SOL" for source in SOURCES})
    h.sender(ALICE)
    assert h.contract.claim(1) == GEN + GEN // 3
    h.sender(BOB)
    assert h.contract.claim(1) == 4 * GEN - (GEN + GEN // 3)
    assert sum(item[1]["value"] for item in h.transfers) == 4 * GEN
    expect_error(lambda: h.contract.claim(1), "claimed")
    h.sender(CHARLIE)
    expect_error(lambda: h.contract.claim(1), "claimable")


def test_settlement_cannot_run_early_or_overwrite_a_final_result():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.time("2026-01-02T03:59:59Z")
    expect_error(lambda: h.contract.settle_market(1), "not ready")
    assert h.contract.get_resolution(1)["status"] == "UNRESOLVED"
    settle(h, winners={source: "SOL" for source in SOURCES})
    first = copy.deepcopy(h.contract.get_resolution(1))
    h.mock_sources(winners={source: "BTC" for source in SOURCES})
    h.sender(BOB)
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1) == first


def test_native_4h_candle_cannot_settle_until_close_and_grace_complete():
    h = Harness()
    h.create(start=FOUR_H_DAY + 14400, duration=14400)
    h.bet("SOL")
    h.mock_sources(winners={source: "SOL" for source in SOURCES})
    h.time("2026-01-02T07:59:59Z")
    expect_error(lambda: h.contract.settle_market(1), "not ready")
    assert h.web.calls == []
    h.time("2026-01-02T08:00:00Z")
    assert h.contract.get_market(1)["status"] == "FINALIZING"
    expect_error(lambda: h.contract.settle_market(1), "not ready")
    h.time("2026-01-02T08:00:59Z")
    expect_error(lambda: h.contract.settle_market(1), "not ready")
    h.time("2026-01-02T08:01:00Z")
    assert h.contract.get_market(1)["status"] == "SETTLEMENT_READY"
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1)["final_winner"] == "SOL"
    assert len(h.web.calls) == 3 * 5 * 2


def test_inconclusive_refund_and_zero_backed_winner_refund():
    h = Harness()
    h.create()
    h.bet("BTC", GEN)
    settle(h, winners={source: "SOL" for source in SOURCES})
    assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"
    h.sender(ALICE)
    assert h.contract.claim(1) == GEN
    expect_error(lambda: h.contract.claim(1), "claimed")


def test_empty_market_is_inconclusive_without_source_calls():
    h = Harness()
    h.create()
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"
    assert h.web.calls == []


def test_read_methods_and_bounded_sparse_pagination():
    h = Harness()
    h.create(start=START)
    h.create(start=START + 86400)
    h.create(start=START + 2 * 86400)
    page = h.contract.get_markets(0, 2)
    assert page["market_ids"] == [1, 2]
    assert page["next_offset"] == 2 and page["has_more"] is True
    open_page = h.contract.get_open_markets(0, 2)
    assert open_page["market_ids"] == [1, 2]
    assert open_page["scanned_count"] == 2
    assert h.contract.get_open_markets(3, 25)["market_ids"] == []
    expect_error(lambda: h.contract.get_markets(0, 0), "limit")


def test_open_market_pagination_handles_expired_sparse_ids():
    h = Harness()
    h.create(start=START)
    h.create(start=START + 86400)
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    page = h.contract.get_open_markets(0, 1)
    assert page["market_ids"] == [2]
    assert page["scanned_count"] == 2
    assert page["has_more"] is False


def test_source_urls_bind_symbols_windows_and_native_4h_intervals():
    for source, interval in zip(SOURCES, ("4h", "4H", "4h")):
        url = CONTRACT._source_url(source, "BTC", START, START + 14400, 14400)
        query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
        if source == "GATE":
            assert "BTC_USDT" in url
            assert query["interval"] == [interval]
            assert query["from"] == [str(START)]
            assert query["to"] == [str(START + 14400 - 1)]
            assert "limit" not in query
        elif source == "BINANCE":
            assert "BTCUSDT" in url
            assert query["interval"] == [interval]
            assert query["timeZone"] == ["0"]
            assert query["startTime"] == [str(START * 1000)]
            assert query["endTime"] == [str((START + 14400) * 1000 - 1)]
        else:
            assert "BTCUSDT" in url
            assert query["category"] == ["SPOT"]
            assert query["interval"] == [interval]
            assert query["type"] == ["MARKET"]
            assert query["startTime"] == [str(START * 1000)]
            assert query["endTime"] == [str((START + 14400) * 1000 - 1)]


def test_gate_native_row_uses_documented_seconds_and_field_order():
    payload = [[str(START), "12", "110", "111", "99", "100"]]
    # The documented REST row has no finalization marker; the fixed settlement
    # grace is the finalization safeguard in this case.
    assert CONTRACT._row_from_payload("GATE", payload, START, START + 14400) == (
        100 * CONTRACT.PRICE_SCALE,
        110 * CONTRACT.PRICE_SCALE,
    )
    # Gate's response schema may include base volume at index 6 without a
    # finalization marker; it is still valid because the fixed grace applies.
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "34"]], START, START + 14400) is not None
    assert CONTRACT._row_from_payload("GATE", [[str(START + 14400), "12", "110", "111", "99", "100"]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [["bad", "12", "110", "111", "99", "100"]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "0", True]], START, START + 14400) is not None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "0", "true"]], START, START + 14400) is not None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "0", False]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "0", "false"]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "0", "yes"]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99"]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "100", "0", True, "extra"]], START, START + 14400) is None
    # Do not fall back to adjacent fields if the documented open or close
    # field is malformed.
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "110", "111", "99", "bad"]], START, START + 14400) is None
    assert CONTRACT._row_from_payload("GATE", [[str(START), "12", "bad", "111", "99", "100"]], START, START + 14400) is None


def test_equivalence_requires_a_common_two_source_financial_witness():
    h = Harness()
    leader = {
        "binance_status": "VALID", "binance_winner": "XRP",
        "bitget_status": "VALID", "bitget_winner": "XRP",
        "gate_status": "UNAVAILABLE", "gate_winner": "",
        "valid_source_count": 2, "consensus_winner": "XRP", "consensus_count": 2,
    }
    # Both executions say XRP, but they rely on different second sources.
    validator = {
        "binance_status": "VALID", "binance_winner": "XRP",
        "bitget_status": "VALID", "bitget_winner": "SOL",
        "gate_status": "VALID", "gate_winner": "XRP",
        "valid_source_count": 3, "consensus_winner": "XRP", "consensus_count": 2,
    }
    calls = [leader, validator]
    original = h.module._collect_sources
    h.module._collect_sources = lambda _start, _end, _duration: calls.pop(0)
    try:
        with pytest.raises(ConsensusError):
            h.contract._settlement_proposal({
                "performance_start_timestamp": str(START),
                "performance_end_timestamp": str(START + 14400),
                "duration": "14400",
            })
    finally:
        h.module._collect_sources = original


def test_equivalence_failure_stays_unresolved_before_deadline_and_refunds_after():
    h = Harness()
    h.create()
    h.bet("SOL")
    calls = 0

    def always_fail(_leader, _validator):
        nonlocal calls
        calls += 1
        raise RuntimeError("validator disagreement")

    original = h.vm.run_nondet
    h.vm.run_nondet = always_fail
    try:
        ready = int(h.contract._market(1)["settlement_ready_timestamp"])
        settle_at(h, ready + 1)
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS - 1)
        assert h.contract.get_resolution(1)["status"] == "UNRESOLVED"
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS)
        assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"
        # Finalization is immutable and does not invoke nondeterminism again.
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS + 1)
        assert calls == 3
    finally:
        h.vm.run_nondet = original


@pytest.mark.parametrize("winners,modes", [
    (
        {"BINANCE": "XRP", "BITGET": "SOL", "GATE": "BNB"},
        {"GATE": "UNAVAILABLE"},
    ),
    (
        {"BINANCE": "XRP", "BITGET": "XRP", "GATE": "SOL"},
        {"BINANCE": "TIE", "GATE": "UNAVAILABLE"},
    ),
    (
        {"BINANCE": "XRP", "BITGET": "XRP", "GATE": "SOL"},
        {"BINANCE": "INVALID_PRICE", "GATE": "UNAVAILABLE"},
    ),
])
def test_retryable_evidence_changes_only_at_exact_deadline(winners, modes):
    for offset, expected in (
        (-1, "UNRESOLVED"),
        (0, "INCONCLUSIVE"),
        (1, "INCONCLUSIVE"),
    ):
        h = Harness()
        h.create()
        h.bet("SOL")
        h.mock_sources(winners=winners, modes=modes)
        ready = int(h.contract._market(1)["settlement_ready_timestamp"])
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS + offset)
        assert h.contract.get_resolution(1)["status"] == expected


def test_two_source_consensus_resolves_immediately_at_all_retry_boundaries():
    for offset in (-1, 0, 1):
        h = Harness()
        h.create()
        h.bet("XRP")
        h.mock_sources(
            winners={"BINANCE": "XRP", "BITGET": "XRP", "GATE": "SOL"},
            modes={"GATE": "UNAVAILABLE"},
        )
        ready = int(h.contract._market(1)["settlement_ready_timestamp"])
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS + offset)
        resolution = h.contract.get_resolution(1)
        assert resolution["status"] == "RESOLVED"
        assert resolution["final_winner"] == "XRP"


def test_all_valid_disagreement_is_inconclusive_without_retry_delay():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={"BINANCE": "SOL", "BITGET": "ETH", "GATE": "BNB"})
    ready = int(h.contract._market(1)["settlement_ready_timestamp"])
    settle_at(h, ready)
    assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"


def test_settlement_spam_by_different_callers_cannot_force_early_refunds():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(
        winners={source: "SOL" for source in SOURCES},
        modes={"BINANCE": "VALID", "BITGET": "UNAVAILABLE", "GATE": "UNAVAILABLE"},
    )
    ready = int(h.contract._market(1)["settlement_ready_timestamp"])
    deadline = ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS
    for timestamp, sender in ((ready, ALICE), (ready + 1, BOB), (deadline - 1, CHARLIE)):
        h.time(datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
        h.sender(sender)
        h.contract.settle_market(1)
    assert h.contract.get_resolution(1)["status"] == "UNRESOLVED"
def test_address_normalization_prevents_duplicate_positions():
    h = Harness()
    h.create()
    h.bet("ETH", sender=ALICE.upper())
    h.sender(BOB)
    h.gl.message.value = GEN
    h.contract.place_position(1, "ETH")
    assert h.contract.get_market(1)["ETH_pool"] == 2 * GEN
    assert h.contract.get_user_position(1, Address(ALICE))["total_stake"] == GEN


def test_storage_is_flat_and_has_no_declared_dynarray():
    assert set(CONTRACT.Crown.__annotations__) == {
        "market_count", "market_records", "market_identity", "position_records"
    }
    assert "DynArray" not in CONTRACT_PATH.read_text()
    assert "run_nondet" in CONTRACT_PATH.read_text()


def test_nondeterministic_callbacks_use_frozen_args_not_mutable_storage():
    source = CONTRACT_PATH.read_text()
    callbacks_start = source.index("        def leader()", source.index("def _settlement_proposal"))
    callbacks_end = source.index("        return gl.vm.run_nondet", callbacks_start)
    callbacks = source[callbacks_start:callbacks_end]
    assert "self." not in callbacks
    for mutable_name in ("market_records", "position_records", "market_identity", "claimed_pool", "_pool"):
        assert mutable_name not in callbacks
    assert callbacks.count("_collect_sources(start, end, duration)") == 2


def test_storage_records_round_trip_through_json_and_pickle():
    h = Harness()
    h.create()
    h.bet("BTC", 2 * GEN)
    market_records = pickle.loads(pickle.dumps(h.contract.market_records))
    position_records = pickle.loads(pickle.dumps(h.contract.position_records))
    assert market_records == h.contract.market_records
    assert position_records == h.contract.position_records
    for record in list(market_records.values()) + list(position_records.values()):
        assert json.loads(record) == json.loads(json.dumps(json.loads(record), separators=(",", ":")))


def _assert_native_4h_rejects(source, source_mode):
    # Native 4H adapters accept exactly one row at the Crown opening timestamp.
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(winners={name: "SOL" for name in SOURCES}, modes={source: source_mode})
    h.time("2026-01-02T04:02:00Z")
    h.contract.settle_market(1)
    assert h.contract.get_resolution(1)[source.lower() + "_status"] == "INVALID"


@pytest.mark.parametrize("source,source_mode", [
    (source, mode) for source in SOURCES for mode in ("WRONG_TIMESTAMP", "MISSING")
])
def test_native_4h_rejects_wrong_or_missing_candle(source, source_mode):
    _assert_native_4h_rejects(source, source_mode)


def test_claim_is_bound_to_sender_and_cannot_be_redirected():
    h = Harness()
    h.create()
    h.bet("SOL", sender=ALICE)
    settle(h, winners={source: "SOL" for source in SOURCES})
    h.sender(BOB)
    expect_error(lambda: h.contract.claim(1), "claimable")
    assert h.transfers == []
    assert h.contract.get_user_position(1, Address(ALICE))["already_claimed"] is False
    h.sender(ALICE)
    assert h.contract.claim(1) == GEN
    assert h.transfers[0][0] == ALICE.lower()


def test_retry_window_keeps_temporary_unavailability_unresolved_then_refunds():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(
        winners={source: "SOL" for source in SOURCES},
        modes={"BINANCE": "VALID", "BITGET": "UNAVAILABLE", "GATE": "UNAVAILABLE"},
    )
    ready = int(h.contract._market(1)["settlement_ready_timestamp"])
    settle_at(h, ready)
    assert h.contract.get_resolution(1)["status"] == "UNRESOLVED"
    settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS)
    assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"
    h.sender(ALICE)
    assert h.contract.claim(1) == GEN


def test_retry_later_recovery_resolves_same_winner():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(
        winners={source: "SOL" for source in SOURCES},
        modes={"BINANCE": "VALID", "BITGET": "UNAVAILABLE", "GATE": "UNAVAILABLE"},
    )
    ready = int(h.contract._market(1)["settlement_ready_timestamp"])
    settle_at(h, ready)
    assert h.contract.get_resolution(1)["status"] == "UNRESOLVED"
    h.web.routes = []
    h.mock_sources(winners={"BINANCE": "SOL", "BITGET": "SOL", "GATE": "ETH"})
    settle_at(h, ready + 1)
    assert h.contract.get_resolution(1)["final_winner"] == "SOL"


def test_retry_waits_for_unavailable_third_source_to_break_a_tie():
    h = Harness()
    h.create()
    h.bet("SOL")
    h.mock_sources(
        winners={"BINANCE": "SOL", "BITGET": "ETH", "GATE": "SOL"},
        modes={"GATE": "UNAVAILABLE"},
    )
    ready = int(h.contract._market(1)["settlement_ready_timestamp"])
    settle_at(h, ready)
    assert h.contract.get_resolution(1)["status"] == "UNRESOLVED"
    h.web.routes = []
    h.mock_sources(winners={"BINANCE": "SOL", "BITGET": "ETH", "GATE": "SOL"})
    settle_at(h, ready + 1)
    assert h.contract.get_resolution(1)["final_winner"] == "SOL"


def test_all_valid_disagreement_is_final_immediately():
    h = Harness()
    h.create()
    h.bet("SOL")
    settle(h, winners={"BINANCE": "SOL", "BITGET": "ETH", "GATE": "BNB"})
    assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"


def test_partial_equivalence_ignores_only_transient_source_statuses():
    h = Harness()
    first = {
        "binance_status": "VALID", "binance_winner": "XRP",
        "bitget_status": "VALID", "bitget_winner": "XRP",
        "gate_status": "UNAVAILABLE", "gate_winner": "",
        "valid_source_count": 2, "consensus_winner": "XRP", "consensus_count": 2,
    }
    second = dict(first)
    second["gate_status"] = "VALID"
    second["gate_winner"] = "BNB"
    second["valid_source_count"] = 3
    calls = [first, second]
    original = h.module._collect_sources
    h.module._collect_sources = lambda _start, _end, _duration: calls.pop(0)
    try:
        result = h.contract._settlement_proposal({
            "performance_start_timestamp": str(START),
            "performance_end_timestamp": str(START + 14400),
            "duration": "14400",
        })
    finally:
        h.module._collect_sources = original
    assert result == first


def test_equivalence_failure_cannot_brick_market_past_retry_deadline():
    h = Harness()
    h.create()
    h.bet("SOL")
    leader = {
        "binance_status": "VALID", "binance_winner": "SOL",
        "bitget_status": "VALID", "bitget_winner": "SOL",
        "gate_status": "UNAVAILABLE", "gate_winner": "",
        "valid_source_count": 2, "consensus_winner": "SOL", "consensus_count": 2,
    }
    validator = dict(leader)
    validator["bitget_winner"] = "ETH"
    validator["consensus_winner"] = ""
    validator["consensus_count"] = 1
    calls = [leader, validator]
    original = h.module._collect_sources
    h.module._collect_sources = lambda _start, _end, _duration: calls.pop(0)
    try:
        ready = int(h.contract._market(1)["settlement_ready_timestamp"])
        settle_at(h, ready + CONTRACT.SETTLEMENT_RETRY_WINDOW_SECONDS)
    finally:
        h.module._collect_sources = original
    assert h.contract.get_resolution(1)["status"] == "INCONCLUSIVE"


def test_get_market_and_position_reads_expose_retry_and_claim_helpers():
    h = Harness()
    h.create()
    h.bet("BTC", 2 * GEN)
    market = h.contract.get_market(1)
    assert market["settlement_retry_deadline"] == START + 14400 + 60 + 1800
    assert market["betting_open"] is True
    assert market["settlement_available"] is False
    assert market["winning_pool"] == 0
    assert market["claimed_pool"] == 0 and market["remaining_pool"] == 2 * GEN
    position = h.contract.get_user_position(1, Address(ALICE))
    assert position["remaining_stake_capacity"] == 8 * GEN
    assert position["can_top_up"] is True
    assert position["position_won"] is False and position["position_lost"] is False
    assert h.contract.get_market_by_start(START) == {"exists": True, "market_id": 1}
    assert h.contract.get_market_by_start(START + 1) == {"exists": False, "market_id": 0}


@pytest.mark.parametrize("amount,expected", [
    (5 * GEN, True),
    (9 * GEN, True),
    (9 * GEN + GEN // 2, False),
    (10 * GEN, False),
])
def test_can_top_up_requires_a_full_minimum_stake_capacity(amount, expected):
    h = Harness()
    h.create()
    h.bet("BTC", amount)
    position = h.contract.get_user_position(1, Address(ALICE))
    assert position["remaining_stake_capacity"] == 10 * GEN - amount
    assert position["can_top_up"] is expected


def test_can_top_up_is_false_when_market_is_not_open():
    h = Harness()
    h.create()
    h.bet("BTC", 5 * GEN)
    h.time("2026-01-01T23:59:00Z")
    position = h.contract.get_user_position(1, Address(ALICE))
    assert position["remaining_stake_capacity"] == 5 * GEN
    assert position["can_top_up"] is False


@pytest.mark.parametrize("order", [
    (ALICE, BOB, CHARLIE),
    (CHARLIE, ALICE, BOB),
    (BOB, CHARLIE, ALICE),
])
def test_claim_order_cannot_overpay_and_final_claim_gets_dust(order):
    h = Harness()
    h.create()
    h.bet("SOL", GEN, ALICE)
    h.bet("SOL", 2 * GEN, BOB)
    h.bet("SOL", 3 * GEN, CHARLIE)
    h.bet("BTC", GEN, "0x" + "44" * 20)
    settle(h, winners={source: "SOL" for source in SOURCES})
    for sender in order:
        h.sender(sender)
        h.contract.claim(1)
    assert sum(item[1]["value"] for item in h.transfers) == 7 * GEN
    assert len(h.transfers) == 3
    stored_market = json.loads(h.contract.market_records["1"])
    assert int(stored_market["claimed_pool"]) == 7 * GEN
    assert int(stored_market["claimed_winning_stake"]) == 6 * GEN
    assert int(stored_market["claimed_pool"]) <= int(stored_market["total_pool"])


def test_all_inconclusive_refunds_sum_to_pool_without_winner_path():
    h = Harness()
    h.create()
    h.bet("BTC", GEN, ALICE)
    h.bet("ETH", 2 * GEN, BOB)
    h.bet("XRP", 3 * GEN, CHARLIE)
    settle(h, winners={"BINANCE": "BTC", "BITGET": "ETH", "GATE": "SOL"})
    for sender in (ALICE, BOB, CHARLIE):
        h.sender(sender)
        h.contract.claim(1)
    assert sum(item[1]["value"] for item in h.transfers) == 6 * GEN
    stored_market = json.loads(h.contract.market_records["1"])
    assert int(stored_market["claimed_pool"]) == int(stored_market["total_pool"]) == 6 * GEN
    assert int(stored_market["claimed_winning_stake"]) == 0


def test_claim_state_and_pool_accounting_are_saved_before_finalized_transfer():
    h = Harness()
    h.create()
    h.bet("SOL", GEN)
    settle(h, winners={source: "SOL" for source in SOURCES})
    h.sender(ALICE)
    observed = []

    def emit_transfer(**_kwargs):
        observed.append((
            h.contract.get_user_position(1, Address(ALICE)),
            json.loads(h.contract.market_records["1"]),
        ))

    h.gl.get_contract_at = lambda _user: types.SimpleNamespace(emit_transfer=emit_transfer)
    assert h.contract.claim(1) == GEN
    assert observed[0][0]["already_claimed"] is True
    assert int(observed[0][1]["claimed_pool"]) == GEN


def test_exact_ten_gen_then_one_wei_is_rejected_without_mutation():
    h = Harness()
    h.create()
    h.bet("BTC", 10 * GEN)
    before_market = copy.deepcopy(h.contract.get_market(1))
    before_position = copy.deepcopy(h.contract.get_user_position(1, Address(ALICE)))
    expect_error(lambda: h.bet("BTC", 1), "GEN")
    expect_error(lambda: h.bet("BTC", GEN + 1), "cumulative")
    assert h.contract.get_market(1) == before_market
    assert h.contract.get_user_position(1, Address(ALICE)) == before_position


def test_invalid_asset_is_rejected_without_partial_pool_change():
    h = Harness()
    h.create()
    expect_error(lambda: h.bet("DOGE"), "protocol-approved")
    assert h.contract.get_market(1)["total_pool"] == 0


def test_pool_sum_invariant_holds_after_each_successful_position():
    h = Harness()
    h.create()
    for asset, amount, sender in (("BTC", GEN, ALICE), ("ETH", 2 * GEN, BOB), ("SOL", 3 * GEN, CHARLIE)):
        h.bet(asset, amount, sender)
        market = h.contract.get_market(1)
        assert sum(market[asset_name + "_pool"] for asset_name in ASSETS) == market["total_pool"]


def test_market_pool_overflow_is_rejected_before_position_write():
    h = Harness()
    h.create()
    market = json.loads(h.contract.market_records["1"])
    market["BTC_pool"] = str(CONTRACT.U256_MAX)
    market["total_pool"] = str(CONTRACT.U256_MAX)
    h.contract.market_records["1"] = json.dumps(market)
    expect_error(lambda: h.bet("BTC"), "overflows")
    assert h.contract.get_user_position(1, Address(ALICE))["has_position"] is False


def test_market_counter_overflow_is_rejected():
    h = Harness()
    h.contract.market_count = CONTRACT.U256_MAX
    expect_error(lambda: h.create(), "counter")


@pytest.mark.parametrize(
    "winners,modes,expected",
    [
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {}, "SOL"),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "ETH"}, {}, "SOL"),
        ({"BINANCE": "SOL", "BITGET": "ETH", "GATE": "SOL"}, {}, "SOL"),
        ({"BINANCE": "ETH", "BITGET": "SOL", "GATE": "SOL"}, {}, "SOL"),
        ({"BINANCE": "SOL", "BITGET": "ETH", "GATE": "BNB"}, {}, ""),
        ({"BINANCE": "SOL", "BITGET": "ETH", "GATE": "BNB"}, {"GATE": "UNAVAILABLE"}, ""),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "ETH"}, {"BINANCE": "TIE"}, ""),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {"BINANCE": "TIE"}, "SOL"),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {"BINANCE": "TIE", "BITGET": "UNAVAILABLE"}, ""),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {"BINANCE": "INVALID_PRICE"}, "SOL"),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {"BINANCE": "INVALID_PRICE", "BITGET": "UNAVAILABLE"}, ""),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "ETH"}, {"BINANCE": "UNAVAILABLE", "GATE": "UNAVAILABLE"}, ""),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {source: "TIE" for source in SOURCES}, ""),
        ({"BINANCE": "SOL", "BITGET": "SOL", "GATE": "SOL"}, {source: "INVALID_PRICE" for source in SOURCES}, ""),
    ],
)
def test_consensus_matrix_counts_only_valid_votes(winners, modes, expected):
    h = Harness()
    h.create()
    h.bet("SOL")
    settle(h, winners=winners, modes=modes)
    resolution = h.contract.get_resolution(1)
    assert resolution["final_winner"] == expected
    if expected:
        assert resolution["status"] == "RESOLVED"
    else:
        expected_status = "UNRESOLVED" if "UNAVAILABLE" in modes.values() else "INCONCLUSIVE"
        assert resolution["status"] == expected_status


def test_pagination_handles_large_offsets_and_open_filter_is_current():
    h = Harness()
    h.create()
    assert h.contract.get_markets(10**80, 25)["market_ids"] == []
    assert h.contract.get_open_markets(10**80, 25)["market_ids"] == []
    h.time("2026-01-01T23:59:00Z")
    assert h.contract.get_market(1)["status"] == "LOCKED"
    assert h.contract.get_open_markets(0, 25)["market_ids"] == []


def test_external_http_failures_are_classified_and_bounded():
    h = Harness()
    for status in (408, 425, 429, 500):
        h.web = FakeWeb()
        h.gl.nondet.web = h.web
        h.web.add(r".*", response(status, b"temporary failure"))
        assert CONTRACT._request_json("https://example.invalid/source")[0] == "UNAVAILABLE"
    for body in (b"", b"x" * (CONTRACT.MAX_RESPONSE_BYTES + 1), b"not-json"):
        h.web = FakeWeb()
        h.gl.nondet.web = h.web
        h.web.add(r".*", response(200, body))
        assert CONTRACT._request_json("https://example.invalid/source")[0] == "INVALID"


def test_source_identity_and_duration_are_fixed_before_any_external_call():
    h = Harness()
    assert CONTRACT._source_once("SPOOF", START, START + 14400, 14400)["status"] == "INVALID"
    assert CONTRACT._source_once("BINANCE", START, START + 3600, 3600)["status"] == "INVALID"
    assert h.web.calls == []
