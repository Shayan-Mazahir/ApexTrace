import threading

import pytest

from app import result_cache
from app.schemas import UpgradeConfig
from app.stress import evaluation as ev


def t(test_id, passed, clearance):
    return {"test_id": test_id, "passed": passed, "min_clearance_m": clearance}


def test_default_test_matches_the_compare_screen():
    base = [t("a", True, 0.2), t("b", False, 1.0), t("c", False, -3.0)]
    # the tightest test the upgrade fixes wins...
    assert ev.default_test(base, [t("a", True, 1), t("b", True, 1), t("c", False, 0)]) == "b"
    # ...else the tightest baseline failure...
    assert ev.default_test(base, [t("a", True, 1), t("b", False, 1), t("c", False, 0)]) == "c"
    # ...else the tightest test overall
    assert ev.default_test([t("a", True, 0.9), t("b", True, 0.6)], []) == "b"
    assert ev.default_test([], []) is None


def test_warm_order_covers_every_compare_request_once_defaults_first():
    configs = ev.evaluate_all("heldout")["configs"]
    base = next(c for c in configs if not any(c["upgrades"].values()))
    others = [c for c in configs if c is not base]
    jobs = ev.replay_warm_order("heldout")
    assert len(jobs) == len({(tid, tuple(sorted(up.items()))) for tid, up in jobs})
    assert len(jobs) == len(others) * len(ev.SUITES["heldout"])
    for c in others[:3]:
        assert (ev.default_test(base["tests"], c["tests"]), c["upgrades"]) in jobs[: len(others)]


@pytest.fixture
def isolated_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("LIMITLAB_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("LIMITLAB_PREWARM", "1")
    result_cache.clear_memory()
    yield
    result_cache.clear_memory()


def test_prewarm_stores_replays_identical_to_on_demand(isolated_cache, monkeypatch):
    test_id = ev.SUITES["heldout"][0][0]
    upgrades = UpgradeConfig(local_fallback=True).model_dump(mode="json")
    monkeypatch.setattr(ev, "replay_warm_order", lambda kind: [(test_id, upgrades)])
    assert ev.prewarm_replays("heldout") == 1
    key = ev._replay_key(test_id, UpgradeConfig(), UpgradeConfig(local_fallback=True))
    assert result_cache.contains("replay", key)
    assert ev.prewarm_replays("heldout") == 0  # already stored: no worker started
    stored = ev.replay(test_id, UpgradeConfig(), UpgradeConfig(local_fallback=True))
    fresh = ev._replay(test_id, UpgradeConfig(), UpgradeConfig(local_fallback=True))
    assert stored["baseline"]["result"] == fresh["baseline"]["result"]
    assert stored["upgraded"]["frames"][-1]["t"] == fresh["upgraded"]["frames"][-1]["t"]


def test_prewarm_stops_between_replays(isolated_cache, monkeypatch):
    monkeypatch.setattr(ev, "replay_warm_order", lambda kind: [(ev.SUITES["heldout"][0][0], {})] * 3)
    stop = threading.Event()
    stop.set()
    assert ev.prewarm_replays("heldout", stop) == 0


def test_prewarm_can_be_switched_off(isolated_cache, monkeypatch):
    monkeypatch.setenv("LIMITLAB_PREWARM", "0")
    assert ev.prewarm_replays("heldout") == 0
