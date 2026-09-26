import pytest
from fastapi.testclient import TestClient

from app.budget import enumerate_configs
from app.main import app
from app.stress import evaluation as ev

client = TestClient(app)


def test_dev_and_heldout_suites_share_families_but_not_seeds():
    dev = {s.seed for _, s in ev.SUITES["dev"]}
    held = {s.seed for _, s in ev.SUITES["heldout"]}
    assert dev.isdisjoint(held)
    assert {s.id for _, s in ev.SUITES["dev"]} == {s.id for _, s in ev.SUITES["heldout"]}
    assert len(ev.SUITES["heldout"]) == 3 * len(ev.families())


def test_suite_includes_clean_baselines_on_both_tracks():
    ids = {s.id for _, s in ev.SUITES["heldout"]}
    assert {"monza_clean", "baku_clean"} <= ids


@pytest.fixture(scope="module")
def evaluation():
    return ev.evaluate_all("heldout")


def test_all_eight_configs_on_every_group(evaluation):
    keys = {o.key for o in enumerate_configs()}
    for gid, group in evaluation["groups"].items():
        assert {c["key"] for c in group["configs"]} == keys
        for c in group["configs"]:
            assert [t["test_id"] for t in c["tests"]] == group["test_ids"]


def test_aggregates_match_the_declared_pass_rule(evaluation):
    for c in evaluation["configs"]:
        assert c["passed"] == all(t["passed"] for t in c["tests"])
        assert c["track_exits"] == sum(t["track_exit"] for t in c["tests"])
        for t in c["tests"]:
            expected = (not t["track_exit"]) and t["completed"] and t["min_clearance_m"] >= ev.MIN_CLEARANCE_M
            assert t["passed"] == expected


def test_clean_laps_pass_for_every_configuration(evaluation):
    for c in evaluation["configs"]:
        clean = [t for t in c["tests"] if t["scenario_id"].endswith("_clean")]
        assert clean and all(t["passed"] for t in clean), c["key"]


def test_run_replay_and_paired_endpoints():
    run = client.post("/evaluation/run").json()
    assert set(run["groups"]) == set(ev.SUITE_GROUPS)
    test_id = run["groups"]["telemetry"]["test_ids"][0]
    rep = client.post("/evaluation/replay", json={"test_id": test_id, "upgraded": {"local_fallback": True}}).json()
    assert rep["baseline"]["frames"] and rep["upgraded"]["frames"] and "tcn" in rep
    assert client.post("/evaluation/replay", json={"test_id": "nope", "upgraded": {}}).status_code == 404
    paired = client.post("/evaluation/paired", json={"scenario_id": "combined_moderate", "upgrade": {"local_fallback": True}}).json()
    assert [r["key"] for r in paired["rows"]] == ["clean", "a", "b", "ab", "ab_upgrade"]
