import pytest

from app.schemas import ConfigurationName as CN
from app.schemas import Scenario, WarningLevel, WarningSource
from app.sim.runner import run_batch, run_scenario
from app.sim.simulator import Simulator
from app.sim.vehicle import ControlInput

NOMINAL = Scenario(scenario_id="nominal", track="monza", entry_speed=85.0)


def test_nominal_run_succeeds_with_warning():
    r = run_scenario(NOMINAL)
    assert r.success and not r.failed and not r.left_track
    assert r.warning_triggered and r.warning_timestamp is not None
    assert r.failure_timestamp is None
    assert r.minimum_boundary_distance > 0
    assert r.metrics.corner_entry_speed == pytest.approx(r.metrics.advised_corner_speed, abs=0.5)


def test_slow_car_gets_no_warning():
    r = run_scenario(Scenario(track="baku", entry_speed=20.0))
    assert r.success and not r.warning_triggered


def test_identical_seed_identical_result():
    sc = Scenario(scenario_id="d", track="baku", entry_speed=55, sensor_noise=0.8, packet_loss=0.3,
                  telemetry_delay_ms=120, seed=99)
    a = run_scenario(sc, include_telemetry=True)
    b = run_scenario(sc, include_telemetry=True)
    assert a.model_dump() == b.model_dump()
    c = run_scenario(sc.model_copy(update={"seed": 100}), include_telemetry=True)
    assert a.telemetry != c.telemetry


def test_grip_mismatch_causes_failure():
    ok = run_scenario(NOMINAL.model_copy(update={"actual_grip": 0.7, "estimated_grip": 0.7}))
    bad = run_scenario(NOMINAL.model_copy(update={"actual_grip": 0.7, "estimated_grip": 0.95}))
    assert ok.success
    assert bad.failed and bad.left_track and bad.failure_reason == "left_track"
    assert bad.failure_timestamp is not None
    assert bad.metrics.overspeed_at_entry > 0


def test_lower_grip_is_harder():
    hi = run_scenario(NOMINAL.model_copy(update={"actual_grip": 1.0, "estimated_grip": 1.05}))
    lo = run_scenario(NOMINAL.model_copy(update={"actual_grip": 0.7, "estimated_grip": 0.75}))
    assert lo.minimum_boundary_distance < hi.minimum_boundary_distance


def test_brake_degradation_causes_failure():
    base = NOMINAL.model_copy(update={"warning_margin": 0.0, "driver_reaction_delay": 0.5})
    assert run_scenario(base).success
    worn = run_scenario(base.model_copy(update={"brake_effectiveness": 0.5}))
    assert worn.failed and worn.metrics.warning_too_late


def test_reaction_delay_causes_failure():
    base = NOMINAL.model_copy(update={"warning_margin": 0.0})
    assert run_scenario(base).success
    assert run_scenario(base.model_copy(update={"driver_reaction_delay": 1.2})).failed


def test_telemetry_delay_makes_warning_later():
    base = NOMINAL.model_copy(update={"warning_margin": 0.0})
    r0 = run_scenario(base)
    r300 = run_scenario(base.model_copy(update={"telemetry_delay_ms": 300}))
    assert r300.warning_timestamp > r0.warning_timestamp
    assert r300.metrics.warning_lead_time < r0.metrics.warning_lead_time


def test_stale_telemetry_is_reported():
    r = run_scenario(Scenario(track="baku", entry_speed=55, packet_loss=0.4, seed=4), include_telemetry=True)
    assert r.metrics.packets_dropped > 0
    assert r.metrics.stale_telemetry_fraction > 0
    assert any(f.packet_dropped for f in r.telemetry)


def test_telemetry_frames_are_consistent():
    r = run_scenario(NOMINAL, include_telemetry=True)
    frames = r.telemetry
    assert len(frames) == r.metrics.ticks
    assert frames[0].timestamp == 0.0 and frames[0].speed == 85.0
    assert all(b.timestamp > a.timestamp for a, b in zip(frames, frames[1:]))
    assert any(f.warning is WarningLevel.BRAKE_NOW for f in frames)
    assert all(f.warning_source is WarningSource.REMOTE for f in frames)


def test_external_control_input():
    sim = Simulator(NOMINAL)
    for _ in range(100):
        state = sim.step(ControlInput(steering=0.0, throttle=0.0, brake=1.0))
    assert state.brake == 1.0
    assert sim.kin.speed < 85.0 - 10


def test_run_batch_matches_single_runs_and_parallel():
    scs = [NOMINAL.model_copy(update={"scenario_id": f"b{i}", "seed": i, "sensor_noise": 0.5}) for i in range(10)]
    serial = run_batch(scs)
    parallel = run_batch(scs, workers=2)
    assert [r.model_dump() for r in serial] == [r.model_dump() for r in parallel]
    assert [r.scenario_id for r in serial] == [f"b{i}" for i in range(10)]


# ----------------------------- upgrades ----------------------------------- #

WORN = NOMINAL.model_copy(update={"warning_margin": 0.0, "driver_reaction_delay": 0.5, "brake_effectiveness": 0.5})


def test_brake_service_fixes_worn_brakes():
    assert run_scenario(WORN, CN.BASELINE).failed
    fixed = run_scenario(WORN, CN.BRAKE_SERVICE)
    assert fixed.success
    assert fixed.scenario.brake_effectiveness == 1.0


def test_reliable_telemetry_caps_delay_and_loss():
    sc = NOMINAL.model_copy(update={"telemetry_delay_ms": 300, "packet_loss": 0.3})
    r = run_scenario(sc, CN.RELIABLE_TELEMETRY)
    assert r.scenario.telemetry_delay_ms == 40 and r.scenario.packet_loss == 0.02


def test_local_fallback_takes_over_when_stale():
    sc = Scenario(track="baku", entry_speed=58, telemetry_delay_ms=300, warning_margin=0.0,
                  driver_reaction_delay=0.5, seed=1)
    base = run_scenario(sc, CN.BASELINE, include_telemetry=True)
    local = run_scenario(sc, CN.LOCAL_WARNING_FALLBACK, include_telemetry=True)
    assert any(f.warning_source is WarningSource.LOCAL for f in local.telemetry)
    assert local.warning_timestamp < base.warning_timestamp
    assert local.metrics.stale_telemetry_fraction == 0.0


def test_upgrades_do_not_change_unaffected_scenarios():
    """Upgrades act through the simulator; a scenario they don't touch gives an identical run."""
    base = run_scenario(NOMINAL, CN.BASELINE).model_dump(exclude={"configuration"})
    for cfg in (CN.BRAKE_SERVICE, CN.RELIABLE_TELEMETRY, CN.LOCAL_WARNING_FALLBACK):
        assert run_scenario(NOMINAL, cfg).model_dump(exclude={"configuration"}) == base
