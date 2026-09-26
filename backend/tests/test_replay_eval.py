import numpy as np

from app.schemas import ConfigurationName as CN
from app.schemas import Scenario
from app.sim.evaluation import compare_configurations, evaluate_configuration
from app.sim.replay import build_replay, get_track_geometry, load_replay, save_replay
from app.sim.scenario_space import ScenarioSpace

FAIL = Scenario(scenario_id="worn", track="monza", entry_speed=85, warning_margin=0.0,
                driver_reaction_delay=0.5, brake_effectiveness=0.5)


def test_replay_contains_reconstruction_fields():
    rp = build_replay(FAIL, CN.BASELINE, sample_hz=20)
    assert rp.sample_hz == 20
    assert rp.result.failed and rp.result.telemetry is None
    f = rp.frames[0]
    for field in ("x", "y", "speed", "heading", "steering", "brake", "actual_grip", "estimated_grip",
                  "warning", "telemetry_age_ms", "packet_dropped"):
        assert hasattr(f, field)
    kinds = [e.kind for e in rp.events]
    assert "brake_now_shown" in kinds and "left_track" in kinds and kinds[-1] == "finished"
    assert "lap_completed" not in kinds
    assert next(e for e in rp.events if e.kind == "left_track").detail == rp.result.failure_corner
    assert len(rp.track.centerline) == len(rp.track.left_boundary) > 1000
    assert rp.track.closed


def test_completed_lap_replay_has_every_corner():
    rp = build_replay(Scenario(track="baku", entry_speed=75), CN.BASELINE)
    entries = [e.detail.split(" speed")[0] for e in rp.events if e.kind == "corner_entry"]
    assert entries == [c.name for c in rp.track.corners]
    assert any(e.kind == "lap_completed" for e in rp.events)
    assert rp.sample_hz == 20


def test_replay_is_deterministic_and_roundtrips(tmp_path):
    a = build_replay(FAIL, CN.BASELINE)
    b = build_replay(FAIL, CN.BASELINE)
    assert a.model_dump() == b.model_dump()
    p = save_replay(a, tmp_path / "r.json")
    assert load_replay(p).model_dump() == a.model_dump()


def test_baseline_vs_upgraded_replay_differ():
    base = build_replay(FAIL, CN.BASELINE)
    up = build_replay(FAIL, CN.BRAKE_SERVICE)
    assert base.result.failed and up.result.success
    assert base.scenario.brake_effectiveness == 0.5 and up.scenario.brake_effectiveness == 1.0


def test_track_geometry():
    g = get_track_geometry("baku")
    assert g.width == 10.0 and g.min_width == 7.5 and g.corners[0].direction == "left"
    assert any(c.width == 7.5 for c in g.corners)
    assert g.telemetry_shadow_zones and g.length > 3000


def test_evaluate_and_compare_use_identical_scenarios():
    scs = ScenarioSpace().sample(np.random.default_rng(1), 40)
    ev = evaluate_configuration(CN.BASELINE, scs)
    assert ev.scenario_count == 40 and ev.stress_test_failures == len(ev.failed_scenario_ids)
    cmp = compare_configurations(scs)
    assert [e.configuration for e in cmp.evaluations] == list(CN)
    assert all([o.scenario_id for o in e.outcomes] == cmp.scenario_ids for e in cmp.evaluations)
    assert cmp.evaluations[0].model_dump() == ev.model_dump()
    # brake service can only fix or not; every fix is a real baseline failure
    base_failed = set(ev.failed_scenario_ids)
    for fixed in cmp.fixed_vs_baseline.values():
        assert set(fixed) <= base_failed
