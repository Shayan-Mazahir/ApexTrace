import pytest
from fastapi.testclient import TestClient

from app import placeholder_eval as ev
from app.budget import UPGRADE_IDS, config_cost, enumerate_configs
from app.main import app
from app.schemas import UpgradeConfig

client = TestClient(app)

FULL = UpgradeConfig(brake_servicing=True, comms_improvement=True, local_fallback=True)


# --- suite definition ----------------------------------------------------


def test_suite_is_fixed_and_covers_both_tracks_with_replicates():
    ids = [t.id for t in ev.SUITE_TESTS]
    assert len(ids) == len(set(ids)) == 36
    assert {t.track for t in ev.SUITE_TESTS} == {"monza", "baku"}
    assert sum(t.track == "monza" for t in ev.SUITE_TESTS) == 18


def test_suite_fault_severities_stay_inside_declared_ranges():
    for t in ev.SUITE_TESTS:
        assert 0.65 <= t.faults.grip_multiplier <= 1.0
        assert 0 <= t.faults.telemetry_delay_ms <= 400
        assert 0.75 <= t.faults.brake_wear <= 1.0
        assert 0 <= t.onset_distance < t.end_distance


def test_paired_faults_use_capped_combined_severity():
    paired = [t for t in ev.SUITE_TESTS if "delay_and_fade" in t.id or "grip_and_delay" in t.id]
    assert paired
    for t in paired:
        assert t.faults.telemetry_delay_ms < ev.WORST.telemetry_delay_ms
        assert t.faults.grip_multiplier > ev.WORST.grip_multiplier


def test_acceptance_criteria_are_declared_up_front():
    assert ev.ACCEPTANCE.max_track_exits == 0
    assert ev.ACCEPTANCE.min_clearance_m > 0
    assert ev.ACCEPTANCE.require_lap_complete


# --- runner --------------------------------------------------------------


def test_runs_are_deterministic():
    test = ev.TESTS_BY_ID["baku_stale_telemetry_1"]
    a = ev.run_test(test, UpgradeConfig()).result
    b = ev.run_test(test, UpgradeConfig()).result
    assert a == b


def test_healthy_car_completes_every_nominal_replicate():
    for test in ev.SUITE_TESTS:
        if "nominal" in test.id:
            result = ev.run_test(test, FULL).result
            assert result.completed and not result.track_exit, test.id


def test_a_run_that_leaves_the_track_stops_there():
    # Baseline brakes + a driver told nothing: force it by removing warnings.
    test = ev.TESTS_BY_ID["baku_nominal_1"]
    profile = ev.TRACK_PRESETS["baku"]
    driver = ev.ScriptedDriver(profile, cruise=38.0, reaction_s=0.3)  # never receives a warning
    from app.session_state import Session
    from app.placeholder_sim import DemoVehicleState

    session = Session(session_id="x", track_profile=profile)
    session.vehicle = DemoVehicleState()
    state = {}
    for i in range(1, 4000):
        steering, throttle, brake = driver.control(session.vehicle, i * 0.05)
        session.control.update(steering=steering, throttle=throttle, brake=brake)
        state = next(m for m in session.tick(now=session.start_time + i * 0.05) if m["type"] == "vehicle_state")
        if state["track_exit"] or state["lap_complete"]:
            break
    assert state["track_exit"], "flat-out with no warnings should not survive Baku's corners"
    assert test.id  # (the suite entry exists; this run is deliberately warning-free)


def test_injected_delay_delays_braking_and_fallback_restores_it():
    test = ev.TESTS_BY_ID["baku_stale_telemetry_1"]

    def first_warning_distance(cfg: UpgradeConfig) -> float:
        frames = ev.run_test(test, cfg, record=True).frames
        return next(f.distance for f in frames if f.warning_active)

    delayed = first_warning_distance(UpgradeConfig())
    comms = first_warning_distance(UpgradeConfig(comms_improvement=True))
    fallback = first_warning_distance(UpgradeConfig(local_fallback=True))
    # the warning fires later along the track the staler the data is
    assert delayed > comms > fallback


def test_driver_responds_to_warnings_rather_than_replaying_inputs():
    # Same test, different warning timing => different braking onset.
    test = ev.TESTS_BY_ID["baku_stale_telemetry_1"]

    def first_brake_distance(cfg: UpgradeConfig) -> float:
        frames = ev.run_test(test, cfg, record=True).frames
        return next(f.distance for f in frames if f.brake > 0 and f.distance > 200)

    assert first_brake_distance(UpgradeConfig()) != first_brake_distance(
        UpgradeConfig(local_fallback=True)
    )


# --- aggregation + API ---------------------------------------------------


@pytest.fixture(scope="module")
def evaluation():
    return ev.evaluate_all()  # cached + parallel: shared with the API test below


def test_all_eight_configs_are_evaluated_on_the_same_suite(evaluation):
    assert len(evaluation.configs) == 8
    assert {c.key for c in evaluation.configs} == {o.key for o in enumerate_configs()}
    for config in evaluation.configs:
        assert config.test_count == len(ev.SUITE_TESTS)
        assert [t.test_id for t in config.tests] == [t.id for t in ev.SUITE_TESTS]


def test_config_aggregates_match_their_tests(evaluation):
    for config in evaluation.configs:
        assert config.track_exits == sum(t.track_exit for t in config.tests)
        assert config.min_clearance_m == min(t.min_clearance_m for t in config.tests)
        assert config.passed == all(t.passed for t in config.tests)
        assert config.failed_test_ids == [t.test_id for t in config.tests if not t.passed]


def test_pass_rule_matches_declared_acceptance(evaluation):
    for config in evaluation.configs:
        for t in config.tests:
            expected = (
                not t.track_exit
                and t.completed
                and t.min_clearance_m >= ev.ACCEPTANCE.min_clearance_m
            )
            assert t.passed == expected


def test_replay_frames_are_recorded_at_10hz_and_match_the_run():
    test = ev.TESTS_BY_ID["monza_grip_patch_1"]
    output = ev.run_test(test, UpgradeConfig(), record=True)
    ts = [f.t for f in output.frames]
    assert ts == sorted(ts) and ts[1] - ts[0] == pytest.approx(0.1)
    assert output.result == ev.run_test(test, UpgradeConfig()).result


def test_upgrades_endpoint_lists_catalog_and_all_combinations():
    body = client.get("/upgrades").json()
    assert [u["id"] for u in body["upgrades"]] == list(UPGRADE_IDS)
    assert len(body["configs"]) == 8
    assert body["budget_defaults"] == {
        "cash_on_hand": 12000,
        "remaining_commitments": 6000,
        "reserve": 2000,
    }
    costs = {c["key"]: c["cost_cad"] for c in body["configs"]}
    assert costs["baseline"] == 0
    assert costs["brake_servicing+comms_improvement+local_fallback"] == 5000
    assert config_cost(FULL) == 5000


def test_suite_endpoint():
    body = client.get("/evaluation/suite").json()
    assert body["version"] == ev.SUITE_VERSION and len(body["tests"]) == 36


def test_run_endpoint_returns_all_configs():
    body = client.post("/evaluation/run").json()
    assert len(body["configs"]) == 8 and body["suite"]["acceptance"]["max_track_exits"] == 0


def test_replay_endpoint_returns_both_runs_and_404s_unknown_tests():
    ok = client.post(
        "/evaluation/replay",
        json={"test_id": "baku_stale_telemetry_1", "upgraded": {"local_fallback": True}},
    ).json()
    assert ok["baseline"]["frames"] and ok["upgraded"]["frames"]
    assert ok["upgraded"]["upgrades"]["local_fallback"] is True
    assert ok["baseline"]["upgrades"]["local_fallback"] is False
    missing = client.post("/evaluation/replay", json={"test_id": "nope", "upgraded": {}})
    assert missing.status_code == 404
