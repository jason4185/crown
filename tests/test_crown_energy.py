import base64
import copy
import datetime
import importlib.util
import json
import sys
import types
import urllib.parse
from pathlib import Path

import pytest


ROOT = Path(__file__).resolve().parents[1]
CONTRACT_PATH = ROOT / "contracts" / "CrownEnergy.py"
NOW = 1767225600
GEN = 10**18
ALICE = "0x" + "11" * 20
BOB = "0x" + "22" * 20
CHARLIE = "0x" + "33" * 20


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
        self.as_hex = "0x" + self.as_bytes.hex()
        self.as_b64 = base64.b64encode(self.as_bytes).decode("ascii")

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

    def run_nondet(self, leader, validator):
        proposal = leader()
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
    fake_gl.public = Public()
    fake_gl.vm = types.SimpleNamespace(UserError=ContractError, Return=FakeVM.Return)
    fake_gl.evm = types.SimpleNamespace(contract_interface=lambda cls: cls)
    fake = types.ModuleType("genlayer")
    fake.gl = fake_gl
    fake.public = fake_gl.public
    fake.vm = fake_gl.vm
    fake.evm = fake_gl.evm
    fake_contract = types.ModuleType("genlayer.contract")
    fake_contract.Contract = object
    fake_storage = types.ModuleType("genlayer.storage")
    fake_storage.TreeMap = TreeMap
    fake_types = types.ModuleType("genlayer.types")
    fake_types.Address = Address
    fake_types.u256 = int
    names = ("genlayer", "genlayer.contract", "genlayer.storage", "genlayer.types")
    previous = {name: sys.modules.get(name) for name in names}
    sys.modules["genlayer"] = fake
    sys.modules["genlayer.contract"] = fake_contract
    sys.modules["genlayer.storage"] = fake_storage
    sys.modules["genlayer.types"] = fake_types
    try:
        spec = importlib.util.spec_from_file_location("crown_energy_test_contract", CONTRACT_PATH)
        module = importlib.util.module_from_spec(spec)
        assert spec.loader is not None
        spec.loader.exec_module(module)
        return module
    finally:
        for name, previous_module in previous.items():
            if previous_module is None:
                sys.modules.pop(name, None)
            else:
                sys.modules[name] = previous_module


CONTRACT = load_contract_module()


class Response:
    def __init__(self, status=200, body=b""):
        self.status = status
        self.body = body if isinstance(body, bytes) else body.encode()


class FakeWeb:
    def __init__(self):
        self.handler = None
        self.calls = []

    def get(self, url, headers=None):
        self.calls.append(url)
        if self.handler is None:
            raise RuntimeError("unmocked web request")
        return self.handler(url, len(self.calls))


def utc_text(timestamp):
    return datetime.datetime.fromtimestamp(timestamp, datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def expect_error(function, text=None):
    with pytest.raises(ContractError) as caught:
        function()
    if text is not None:
        assert text in str(caught.value)


class Harness:
    def __init__(self, sender=ALICE):
        self.module = CONTRACT
        self.vm = FakeVM()
        self.web = FakeWeb()
        self.transfers = []
        message = types.SimpleNamespace(sender_address=Address(sender), value=0)
        message.raw = {"datetime": utc_text(NOW)}
        self.gl = types.SimpleNamespace(
            vm=self.vm,
            nondet=types.SimpleNamespace(web=self.web),
            message=message,
            message_raw={"datetime": utc_text(NOW)},
        )
        self.module.gl = self.gl
        self.contract = self.module.CrownEnergy()
        for name in (
            "market_type", "market_asset", "market_start", "market_end", "market_duration",
            "market_state", "market_winner", "market_reason", "market_deadline",
            "market_creation_keys", "market_source_evidence", "market_pool", "outcome_pool",
            "market_winning_pool", "market_claimed_pool", "market_claimed_winning_stake",
            "market_refunded_pool", "bettor_outcome", "bettor_stake", "bettor_claimed",
            "bettor_refunded",
        ):
            setattr(self.contract, name, {})

        harness = self

        class NativeRecipient:
            def __init__(self, recipient):
                self.recipient = recipient

            def emit_transfer(self, value):
                harness.transfers.append((self.recipient.as_hex, value))

        self.module._NativeRecipient = NativeRecipient

    def sender(self, value):
        self.gl.message.sender_address = Address(value)

    def time(self, timestamp):
        value = utc_text(timestamp) if isinstance(timestamp, int) else timestamp
        self.gl.message.raw["datetime"] = value
        self.gl.message_raw["datetime"] = value

    def create_up(self, asset="WTI_CRUDE", start=None, duration_hours=1):
        start = start if start is not None else ((NOW // 3600) + 2) * 3600
        return self.contract.create_up_down_market(asset, start, duration_hours)

    def create_dominance(self, start=None, duration_hours=1):
        start = start if start is not None else ((NOW // 3600) + 2) * 3600
        return self.contract.create_dominance_market("ENERGY", start, duration_hours)

    def bet(self, market_id, outcome, amount=GEN, sender=ALICE):
        self.sender(sender)
        self.gl.message.value = amount
        self.contract.place_bet(market_id, outcome)
        self.gl.message.value = 0

    def mock_sources(self, market_type, asset, duration, winners=None, modes=None, second_round_winners=None, negative=False):
        winners = {} if winners is None else winners
        modes = {} if modes is None else modes
        second_round_winners = {} if second_round_winners is None else second_round_winners
        self.web.calls = []
        source_asset = {"WTI_CRUDE": 0, "BRENT_CRUDE": 1, "NATURAL_GAS": 2}
        source_names = ("BINANCE", "GATE", "BITGET")
        asset_names = ("WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS")
        asset_symbols = {
            "BINANCE": ("CLUSDT", "BZUSDT", "NATGASUSDT"),
            "GATE": ("CL_USDT", "BZ_USDT", "NG_USDT"),
            "BITGET": ("CLUSDT", "BZUSDT", "NATGASUSDT"),
        }
        asset_count = 1 if market_type == CONTRACT.UP_DOWN else 3
        calls_per_round = len(source_names) * asset_count

        def source_from_url(url):
            if "binance" in url:
                return "BINANCE"
            if "gateio" in url:
                return "GATE"
            return "BITGET"

        def price_pair(source, asset_name, round_number):
            chosen = dict(winners)
            if round_number != 1:
                chosen.update(second_round_winners)
            winner = chosen.get(source, "UP" if market_type == CONTRACT.UP_DOWN else "WTI_CRUDE")
            if market_type == CONTRACT.UP_DOWN:
                if winner == "UP":
                    return "100", "110"
                if winner == "DOWN":
                    return "100", "90"
                return "100", "100"
            if negative:
                return {"WTI_CRUDE": ("100", "90"), "BRENT_CRUDE": ("100", "95"), "NATURAL_GAS": ("100", "80")}[asset_name]
            if winner == "TIE":
                return {"WTI_CRUDE": ("100", "110"), "BRENT_CRUDE": ("100", "110"), "NATURAL_GAS": ("100", "100")}[asset_name]
            returns = {"WTI_CRUDE": 105, "BRENT_CRUDE": 102, "NATURAL_GAS": 101}
            returns[winner] = 110
            return "100", str(returns[asset_name])

        def handler(url, call_number):
            source = source_from_url(url)
            round_number = 1 if call_number <= calls_per_round else 2
            mode = modes.get(source, "VALID")
            if mode == "UNAVAILABLE":
                return Response(500, b"provider unavailable")
            if mode == "INVALID":
                return Response(200, b"{")
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(url).query)
            if source == "GATE":
                start = int(query["from"][0])
                end = int(query["to"][0])
                timestamps = [start] if end - start + 1 == 3600 else [start, start + 3600]
            else:
                start = int(query["startTime"][0]) // 1000
                timestamps = [start] if int(query["limit"][0]) == 1 else [start, start + 3600]
            symbol = query.get("symbol", query.get("contract", [""]))[0]
            asset_index = next(index for index, value in enumerate(asset_symbols[source]) if value == symbol)
            asset_name = asset_names[asset_index]
            opening, closing = price_pair(source, asset_name, round_number)
            if source == "BINANCE":
                rows = []
                for timestamp in timestamps:
                    row_close = closing if timestamp == timestamps[-1] else opening
                    rows.append([str(timestamp * 1000), opening, "0", "0", row_close, "0", str(timestamp * 1000 + 3_599_999), "0", "0", "0", "0", "0"])
                return Response(200, json.dumps(rows))
            if source == "BITGET":
                rows = []
                for timestamp in timestamps:
                    row_close = closing if timestamp == timestamps[-1] else opening
                    rows.append([str(timestamp * 1000), opening, "0", "0", row_close, "0", "0"])
                return Response(200, json.dumps({"code": "00000", "data": rows}))
            rows = []
            for timestamp in timestamps:
                row_close = closing if timestamp == timestamps[-1] else opening
                rows.append([str(timestamp), "0", row_close, "101", "99", opening, "0"])
            return Response(200, json.dumps(rows))

        self.web.handler = handler

    def settle(self, market_id, market_type, asset, duration, winners=None, modes=None, second_round_winners=None, negative=False):
        self.mock_sources(market_type, asset, duration, winners, modes, second_round_winners, negative)
        self.time(self.contract.market_end[market_id])
        self.sender(CHARLIE)
        return self.contract.settle_market(market_id)


def test_config_and_empty_pagination_do_not_require_datetime():
    harness = Harness()
    config = harness.contract.get_config()
    assert config["protocol"] == "CROWN_ENERGY"
    assert config["market_types"] == ["UP_DOWN", "DOMINANCE"]
    assert config["supported_assets"] == ["WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS"]
    assert config["durations"] == {"1H": 3600, "2H": 7200}
    assert config["minimum_bet"] == GEN
    assert config["maximum_bet_per_wallet_per_market"] == 40 * GEN
    assert config["settlement_retry_window_seconds"] == 46800
    harness.gl.message.raw = {}
    harness.gl.message_raw = {}
    assert harness.contract.get_markets(0, 25) == {"market_ids": [], "markets": [], "next_offset": 0, "has_more": False}
    assert harness.contract.get_open_markets(0, 25) == {"market_ids": [], "markets": [], "next_offset": 0, "has_more": False, "scanned_count": 0}


def test_studio_next_transaction_time_uses_typed_message_raw():
    harness = Harness()
    harness.gl.message_raw = {}
    assert harness.create_up() == 1


def test_creation_duration_alignment_and_duplicate_protection():
    harness = Harness()
    one_hour = ((NOW // 3600) + 2) * 3600
    two_hours = ((NOW // 7200) + 2) * 7200
    assert harness.create_up("WTI_CRUDE", one_hour, 1) == 1
    assert harness.create_dominance(two_hours, 2) == 2
    expect_error(lambda: harness.create_up("WTI_CRUDE", one_hour, 1), "duplicate")
    expect_error(lambda: harness.create_up("WTI_CRUDE", one_hour + 3600, 3), "duration")
    expect_error(lambda: harness.create_dominance(one_hour + 3600, 2), "aligned")
    expect_error(lambda: harness.create_dominance(two_hours + 3600, 2), "aligned")
    expect_error(lambda: harness.contract.create_dominance_market("OIL", two_hours, 1), "ENERGY")


@pytest.mark.parametrize("asset", ["WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS"])
@pytest.mark.parametrize("direction", ["UP", "DOWN"])
def test_up_down_markets_settle_each_asset_and_direction(asset, direction):
    harness = Harness()
    market_id = harness.create_up(asset)
    harness.bet(market_id, direction)
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT._asset_id(asset), 3600, {source: direction for source in CONTRACT.SOURCES}) == CONTRACT.STATE_RESOLVED
    assert harness.contract.market_winner[market_id] == (CONTRACT.UP if direction == "UP" else CONTRACT.DOWN)


def test_up_down_flat_is_a_tie_and_remains_retryable():
    harness = Harness()
    market_id = harness.create_up()
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, {source: "TIE" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_AWAITING
    assert harness.contract.market_reason[market_id] == CONTRACT.REASON_NO_CONSENSUS


@pytest.mark.parametrize("winner", ["WTI_CRUDE", "BRENT_CRUDE", "NATURAL_GAS"])
def test_dominance_markets_settle_each_energy_winner(winner):
    harness = Harness()
    market_id = harness.create_dominance()
    harness.bet(market_id, winner)
    assert harness.settle(market_id, CONTRACT.DOMINANCE, CONTRACT.WTI_CRUDE, 3600, {source: winner for source in CONTRACT.SOURCES}) == CONTRACT.STATE_RESOLVED
    assert harness.contract.market_winner[market_id] == CONTRACT._asset_id(winner)


def test_dominance_all_negative_uses_least_negative_and_exact_top_tie_is_no_vote():
    harness = Harness()
    market_id = harness.create_dominance()
    harness.bet(market_id, "BRENT_CRUDE")
    assert harness.settle(market_id, CONTRACT.DOMINANCE, CONTRACT.WTI_CRUDE, 3600, negative=True) == CONTRACT.STATE_RESOLVED
    assert harness.contract.market_winner[market_id] == CONTRACT.BRENT_CRUDE

    harness = Harness()
    market_id = harness.create_dominance()
    assert harness.settle(market_id, CONTRACT.DOMINANCE, CONTRACT.WTI_CRUDE, 3600, {source: "TIE" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_AWAITING


def test_consensus_unavailable_invalid_and_retry():
    harness = Harness()
    market_id = harness.create_up()
    harness.bet(market_id, "UP")
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, modes={source: "UNAVAILABLE" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_AWAITING
    assert harness.contract.market_reason[market_id] == CONTRACT.REASON_NO_CONSENSUS
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, modes={source: "INVALID" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_AWAITING
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, {source: "UP" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_RESOLVED


@pytest.mark.parametrize("mode", ["UNAVAILABLE", "INVALID"])
def test_two_of_three_valid_sources_resolve_with_one_failed_provider(mode):
    harness = Harness()
    market_id = harness.create_up()
    harness.bet(market_id, "UP")
    assert harness.settle(
        market_id,
        CONTRACT.UP_DOWN,
        CONTRACT.WTI_CRUDE,
        3600,
        {source: "UP" for source in CONTRACT.SOURCES},
        modes={"BITGET": mode},
    ) == CONTRACT.STATE_RESOLVED


def test_three_different_source_votes_do_not_resolve():
    harness = Harness()
    market_id = harness.create_up()
    harness.bet(market_id, "UP")
    winners = {"BINANCE": "UP", "GATE": "DOWN", "BITGET": "TIE"}
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, winners) == CONTRACT.STATE_AWAITING
    assert harness.contract.market_reason[market_id] == CONTRACT.REASON_NO_CONSENSUS


def test_validator_requires_matching_independent_source_evidence():
    harness = Harness()
    start = ((NOW // 3600) + 2) * 3600
    harness.mock_sources(CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, {source: "UP" for source in CONTRACT.SOURCES}, second_round_winners={"GATE": "DOWN"})
    with pytest.raises(ConsensusError):
        CONTRACT._settlement_proposal(CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, start, start + 3600, 3600)


def test_two_hour_settlement_uses_two_exact_one_hour_candles():
    harness = Harness()
    market_id = harness.create_up("WTI_CRUDE", ((NOW // 7200) + 2) * 7200, 2)
    harness.bet(market_id, "UP")
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 7200, {source: "UP" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_RESOLVED
    evidence = harness.contract.get_settlement_evidence(market_id)
    for source in evidence["sources"]:
        assert len(source["assets"][0]["candles"]) == 2
        assert source["assets"][0]["interval"] == "1h"


def test_retry_expiry_and_zero_backed_winner_are_inconclusive():
    harness = Harness()
    market_id = harness.create_up()
    deadline = harness.contract.market_deadline[market_id]
    harness.time(deadline)
    assert harness.contract.settle_market(market_id) == CONTRACT.STATE_INCONCLUSIVE
    assert harness.contract.market_reason[market_id] == CONTRACT.REASON_EXPIRED

    harness = Harness()
    market_id = harness.create_up()
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, {source: "UP" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_INCONCLUSIVE
    assert harness.contract.market_reason[market_id] == CONTRACT.REASON_ZERO_BACKED


def test_staking_rules_and_closed_market():
    harness = Harness()
    market_id = harness.create_up()
    expect_error(lambda: harness.bet(market_id, "UP", GEN - 1), "minimum bet")
    harness.bet(market_id, "UP", GEN)
    harness.bet(market_id, "UP", 39 * GEN)
    expect_error(lambda: harness.bet(market_id, "UP", GEN), "maximum cumulative")
    expect_error(lambda: harness.bet(market_id, "DOWN", GEN), "outcome already selected")
    harness.time(harness.contract.market_start[market_id])
    expect_error(lambda: harness.bet(market_id, "UP", GEN), "betting is closed")


def test_pari_mutuel_dust_loser_and_double_claim():
    harness = Harness()
    market_id = harness.create_up()
    harness.bet(market_id, "UP", GEN, ALICE)
    harness.bet(market_id, "UP", 2 * GEN, BOB)
    harness.bet(market_id, "DOWN", GEN, CHARLIE)
    assert harness.settle(market_id, CONTRACT.UP_DOWN, CONTRACT.WTI_CRUDE, 3600, {source: "UP" for source in CONTRACT.SOURCES}) == CONTRACT.STATE_RESOLVED
    harness.sender(CHARLIE)
    expect_error(lambda: harness.contract.claim(market_id), "not a winning")
    harness.sender(ALICE)
    harness.contract.claim(market_id)
    harness.sender(BOB)
    harness.contract.claim(market_id)
    assert [amount for _recipient, amount in harness.transfers] == [1_333_333_333_333_333_333, 2_666_666_666_666_666_667]
    assert sum(amount for _recipient, amount in harness.transfers) == 4 * GEN
    expect_error(lambda: harness.contract.claim(market_id), "already claimed")


def test_inconclusive_refund_and_double_refund():
    harness = Harness()
    market_id = harness.create_up()
    harness.bet(market_id, "UP", GEN)
    harness.time(harness.contract.market_deadline[market_id])
    harness.contract.settle_market(market_id)
    harness.sender(ALICE)
    harness.contract.claim_refund(market_id)
    assert harness.transfers == [(Address(ALICE).as_hex, GEN)]
    expect_error(lambda: harness.contract.claim_refund(market_id), "already claimed")


def test_bounded_pagination_and_open_scan():
    harness = Harness()
    starts = [((NOW // 3600) + 2 + index) * 3600 for index in range(3)]
    for start in starts:
        harness.create_up(start=start)
    page = harness.contract.get_markets(0, 1)
    assert page["market_ids"] == [1]
    assert page["next_offset"] == 1 and page["has_more"] is True
    assert harness.contract.get_markets(3, 25)["market_ids"] == []
    assert harness.contract.get_markets(99, 25)["next_offset"] == 3
    expect_error(lambda: harness.contract.get_markets(0, 0), "page limit")
    expect_error(lambda: harness.contract.get_open_markets(0, 0), "page limit")

    harness = Harness()
    for index in range(26):
        harness.create_up(start=((NOW // 3600) + 2 + index) * 3600)
    assert len(harness.contract.get_markets(0, 26)["market_ids"]) == 25

    harness = Harness()
    for index in range(101):
        harness.create_up(start=((NOW // 3600) + 2 + index) * 3600)
    scan_time = ((NOW // 3600) + 2 + 99) * 3600 + 1800
    harness.time(scan_time)
    capped = harness.contract.get_open_markets(0, 25)
    assert capped["market_ids"] == []
    assert capped["next_offset"] == 100
    assert capped["has_more"] is True
    assert capped["scanned_count"] == 100
    assert harness.contract.get_open_markets(100, 25)["market_ids"] == [101]
