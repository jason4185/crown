"""Optional official GenLayer direct-mode coverage.

The installed environment may not provide the ``direct_vm`` fixture plugin.
These tests use the official fixture names and skip cleanly when that provider
is absent; the deterministic contract suite in ``tests/test_crown.py`` remains
the local fallback.
"""

import json

import pytest


GEN = 10**18
START = 1767312000  # 2026-01-02T00:00:00Z
END = START + 14400
ASSETS = ("BTC", "ETH", "SOL", "BNB", "XRP")


@pytest.fixture
def crown_direct(request):
    try:
        return {
            "vm": request.getfixturevalue("direct_vm"),
            "deploy": request.getfixturevalue("direct_deploy"),
            "alice": request.getfixturevalue("direct_alice"),
            "bob": request.getfixturevalue("direct_bob"),
        }
    except pytest.FixtureLookupError:
        pytest.skip("official GenLayer direct fixtures are not installed")


def _valid_web_mocks(vm):
    for source in ("binance", "bitget", "gate"):
        for asset in ASSETS:
            candle_start = START
            candle_end = END
            symbol = asset + ("_USDT" if source == "gate" else "USDT")
            close = "110" if asset == "SOL" else "101"
            if source == "binance":
                body = json.dumps([[candle_start * 1000, "100", "0", "0", close, "0", candle_end * 1000 - 1, "0", "0", "0", "0", "0"]])
                pattern = rf".*api\.binance\.com.*{symbol}.*interval=4h.*startTime={candle_start * 1000}.*"
            elif source == "bitget":
                body = json.dumps({"code": "00000", "msg": "success", "data": [[str(candle_start * 1000), "100", "0", "0", close, "0", "0"]]})
                pattern = rf".*api\.bitget\.com.*{symbol}.*interval=4H.*startTime={candle_start * 1000}.*"
            else:
                body = json.dumps([[str(candle_start), "0", close, "0", "0", "100"]])
                pattern = rf".*api\.gateio\.ws.*{symbol}.*interval=4h.*from={candle_start}.*to={candle_end - 1}.*"
            vm.mock_web(pattern, {"status": 200, "body": body})


def test_direct_permissionless_creation_and_position(crown_direct):
    vm = crown_direct["vm"]
    contract = crown_direct["deploy"]("contracts/Crown.py")
    vm.warp("2026-01-01T00:00:00Z")
    vm.sender = crown_direct["bob"]
    vm.value = 0
    assert contract.create_market(START, 14400) == 1
    vm.sender = crown_direct["alice"]
    vm.value = GEN
    contract.place_position(1, "SOL")
    assert contract.get_user_position(1, crown_direct["alice"])["total_stake"] == GEN


def test_direct_rejected_top_up_does_not_change_position(crown_direct):
    vm = crown_direct["vm"]
    contract = crown_direct["deploy"]("contracts/Crown.py")
    vm.warp("2026-01-01T00:00:00Z")
    vm.sender = crown_direct["alice"]
    vm.value = 0
    contract.create_market(START, 14400)
    vm.value = GEN
    contract.place_position(1, "BTC")
    before = contract.get_user_position(1, crown_direct["alice"])
    vm.value = 2 * GEN
    with vm.expect_revert("one asset"):
        contract.place_position(1, "ETH")
    assert contract.get_user_position(1, crown_direct["alice"]) == before


def test_direct_permissionless_settlement_and_claim(crown_direct):
    vm = crown_direct["vm"]
    contract = crown_direct["deploy"]("contracts/Crown.py")
    vm.warp("2026-01-01T00:00:00Z")
    vm.sender = crown_direct["alice"]
    vm.value = 0
    contract.create_market(START, 14400)
    vm.value = GEN
    contract.place_position(1, "SOL")
    _valid_web_mocks(vm)
    vm.warp("2026-01-02T04:01:00Z")
    vm.sender = crown_direct["bob"]
    contract.settle_market(1)
    assert contract.get_resolution(1)["final_winner"] == "SOL"
    vm.sender = crown_direct["alice"]
    assert contract.claim(1) == GEN
