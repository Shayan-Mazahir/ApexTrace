import pytest

from app.schemas import ConfigurationName as CN
from app.schemas import Scenario, WarningLevel, WarningSource
from app.sim.runner import run_batch, run_scenario
from app.sim.simulator import Simulator
from app.sim.track import get_track
from app.sim.vehicle import ControlInput

NOMINAL = Scenario(scenario_id="nominal", track="monza", entry_speed=85.0)
WORN = NOMINAL.model_copy(update={"warning_margin": 0.0, "driver_reaction_delay": 0.5, "brake_effectiveness": 0.5})
DELAYED = NOMINAL.model_copy(update={"warning_margin": 0.0, "driver_reaction_delay": 0.45, "telemetry_delay_ms": 300})


@pytest.mark.parametrize("track,speed", [("monza", 85.0), ("baku", 75.0)])
def test_nominal_lap_completes(track, speed):
    r = run_scenario(Scenario(track=track, entry_speed=speed))
    m = r.metrics
    assert r.success and not r.failed and r.failure_corner is None
    assert m.lap_completed and m.lap_time is not None
    assert m.lap_distance == pytest.approx(get_track(track).length, abs=1.0)
    assert r.warning_triggered and r.minimum_boundary_distance > 0
    assert [c.name for c in m.corners] == [c.name for c in get_track(track).corners]
    # With accurate grip and healthy brakes every corner is entered at or below the safe speed.
    assert all(c.overspeed_at_entry <= 0 for c in m.corners)
    assert not m.warning_too_late


def test_corner_without_warning_is_held_at_entry_speed():
    m = run_scenario(NOMINAL).metrics
    cg = next(c for c in m.corners if c.name == "T3 Curva Grande")
    assert cg.warning_timestamp is None and cg.entry_speed < cg.advised_speed


def test_chicane_is_taken_as_one_complex():
    m = run_scenario(NOMINAL).metrics
    t1, t2 = m.corners[0], m.corners[1]
    assert t2.entry_speed <= t1.advised_speed + 0.5


def test_identical_seed_identical_result():
    sc = Scenario(scenario_id="d", track="baku", entry_speed=70, sensor_noise=0.8, packet_loss=0.3,
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
    assert bad.failure_timestamp is not None and bad.failure_corner is not None
    assert not bad.metrics.lap_completed and bad.metrics.lap_time is None
    failed_corner = next(c for c in bad.metrics.corners if c.name == bad.failure_corner)
    assert failed_corner.overspeed_at_entry > 0


def test_lower_grip_is_harder():
    hi = run_scenario(NOMINAL.model_copy(update={"actual_grip": 1.0, "estimated_grip": 1.05}))
    lo = run_scenario(NOMINAL.model_copy(update={"actual_grip": 0.7, "estimated_grip": 0.75}))
    assert lo.minimum_boundary_distance < hi.minimum_boundary_distance


def test_brake_degradation_causes_failure():
    assert run_scenario(WORN.model_copy(update={"brake_effectiveness": 1.0})).success
    worn = run_scenario(WORN)
    assert worn.failed and worn.metrics.warning_too_late
    assert worn.failure_corner == "T1 Rettifilo"


def test_reaction_delay_causes_failure():
    base = NOMINAL.model_copy(update={"warning_margin": 0.0})
    assert run_scenario(base).success
    assert run_scenario(base.model_copy(update={"driver_reaction_delay": 1.2})).failed


def test_telemetry_delay_makes_warnings_later():
    r0 = run_scenario(DELAYED.model_copy(update={"telemetry_delay_ms": 0}))
    r300 = run_scenario(DELAYED)
    assert r0.success and r300.failed
    assert r300.warning_timestamp > r0.warning_timestamp
    lead0, lead300 = r0.metrics.corners[0].warning_lead_time, r300.metrics.corners[0].warning_lead_time
    assert lead300 < lead0


def test_stale_telemetry_is_reported():
    r = run_scenario(Scenario(track="baku", entry_speed=75, packet_loss=0.4, seed=4), include_telemetry=True)
    assert r.metrics.packets_dropped > 0
    assert r.metrics.stale_telemetry_fraction > 0
    assert any(f.packet_dropped for f in r.telemetry)


def test_telemetry_frames_are_consistent():
    r = run_scenario(NOMINAL, include_telemetry=True)
    frames = r.telemetry
    assert len(frames) == r.metrics.ticks
    assert frames[0].timestamp == 0.0 and frames[0].speed == 85.0 and frames[0].s == 0.0
    assert all(b.timestamp > a.timestamp for a, b in zip(frames, frames[1:]))
    assert all(b.lap_progress >= a.lap_progress - 1e-6 for a, b in zip(frames, frames[1:]))
    assert frames[-1].lap_progress == pytest.approx(get_track("monza").length, abs=1.0)
    assert any(f.warning is WarningLevel.BRAKE_NOW and f.warning_corner == "T1 Rettifilo" for f in frames)
    assert {f.next_corner for f in frames} == {c.name for c in get_track("monza").corners}
    assert all(f.warning_source is WarningSource.REMOTE for f in frames)


def test_external_control_input():
    sim = Simulator(NOMINAL)
    for _ in range(100):
        state = sim.step(ControlInput(steering=0.0, throttle=0.0, brake=1.0))
    assert state.brake == 1.0
    assert sim.kin.speed < 85.0 - 10


def test_run_batch_matches_single_runs_and_parallel():
    scs = [NOMINAL.model_copy(update={"scenario_id": f"b{i}", "seed": i, "sensor_noise": 0.5}) for i in range(8)]
    serial = run_batch(scs)
    parallel = run_batch(scs, workers=2)
    assert [r.model_dump() for r in serial] == [r.model_dump() for r in parallel]
    assert [r.scenario_id for r in serial] == [f"b{i}" for i in range(8)]


# ----------------------------- upgrades ----------------------------------- #


def test_brake_service_fixes_worn_brakes():
    assert run_scenario(WORN, CN.BASELINE).failed
    fixed = run_scenario(WORN, CN.BRAKE_SERVICE)
    assert fixed.success
    assert fixed.scenario.brake_effectiveness == 1.0


def test_reliable_telemetry_fixes_delay():
    r = run_scenario(DELAYED, CN.RELIABLE_TELEMETRY)
    assert r.scenario.telemetry_delay_ms == 40 and r.success
    lossy = run_scenario(DELAYED.model_copy(update={"packet_loss": 0.3}), CN.RELIABLE_TELEMETRY)
    assert lossy.scenario.packet_loss == 0.02


def test_local_fallback_takes_over_when_stale():
    base = run_scenario(DELAYED, CN.BASELINE, include_telemetry=True)
    local = run_scenario(DELAYED, CN.LOCAL_WARNING_FALLBACK, include_telemetry=True)
    assert base.failed and local.success
    assert any(f.warning_source is WarningSource.LOCAL for f in local.telemetry)
    assert local.warning_timestamp < base.warning_timestamp
    assert local.metrics.stale_telemetry_fraction == 0.0


def test_upgrades_do_not_change_unaffected_scenarios():
    """Upgrades act through the simulator; a scenario they don't touch gives an identical run."""
    base = run_scenario(NOMINAL, CN.BASELINE).model_dump(exclude={"configuration"})
    for cfg in (CN.BRAKE_SERVICE, CN.RELIABLE_TELEMETRY, CN.LOCAL_WARNING_FALLBACK):
        assert run_scenario(NOMINAL, cfg).model_dump(exclude={"configuration"}) == base
