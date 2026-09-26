"""Checks for the stress framework (spec section 15 plus scheduler/composition)."""

import math

import pytest
from pydantic import ValidationError

from app.placeholder_sim import TRACK_PRESETS, DemoVehicleState, initial_state, state_at_distance, step
from app.schemas import UpgradeConfig
from app.scenarios import SCENARIOS, ScenarioOverrides, apply_overrides
from app.session_state import Session, handle_raw_message
from app.stress.evaluation import run_scenario
from app.stress.pipeline import Packet, WarningService, assess, resolve
from app.stress.run import RunConfig, StressRun
from app.stress.scheduler import FaultScheduler
from app.stress.spec import CATALOG, FaultSpec, StressScenario, WarningPolicyConfig

MONZA = TRACK_PRESETS["monza"]
BAKU = TRACK_PRESETS["baku"]


def fault(id_, type_, trigger=None, **params):
    d = {"id": id_, "type": type_, "parameters": params}
    if trigger:
        d["trigger"] = trigger
    return FaultSpec.model_validate(d)


def scenario(track="monza", faults=(), **kw):
    return StressScenario(id="t", name="t", track=track, seed=kw.pop("seed", 7), faults=list(faults), **kw)


def drive(run: StressRun, seconds: float, steering=0.0, throttle=1.0, brake=0.0):
    for _ in range(int(round(seconds / 0.05))):
        run.tick(steering, throttle, brake)


def fresh_run(faults=(), track="monza", **cfg) -> StressRun:
    return StressRun(RunConfig(profile=TRACK_PRESETS[track], scenario=scenario(track, faults), **cfg))


# --- spec / catalogue -------------------------------------------------------


def test_unsupported_and_out_of_range_faults_are_rejected():
    for bad in [
        {"id": "a", "type": "crosswind"},
        {"id": "b", "type": "tyre_blowout"},
        {"id": "c", "type": "grip_loss", "parameters": {"grip_multiplier": 0.05}},
        {"id": "d", "type": "uplink_delay", "parameters": {"bogus": 1}},
        {"id": "e", "type": "grip_loss", "trigger": {"kind": "zone"}},
        {"id": "f", "type": "grip_loss", "target": "uplink"},
    ]:
        with pytest.raises(ValidationError):
            FaultSpec.model_validate(bad)


def test_unsupported_fault_cannot_be_launched_from_the_engineer_channel():
    s = Session(session_id="x", track_profile=MONZA)
    reply = handle_raw_message(s, "engineer", '{"type":"add_fault","fault":{"id":"w","type":"crosswind"}}')
    assert reply[0]["code"] == "invalid_fault"
    assert s.run.scheduler.faults == []


def test_catalogue_labels_every_type():
    implemented = [c for c in CATALOG.values() if c.status == "implemented"]
    assert len(implemented) >= 8
    for core in ["grip_loss", "grip_estimate_lag", "brake_fade", "uplink_delay", "uplink_blackout",
                 "speed_bias", "sensor_freeze", "driver_reaction_delay"]:
        assert CATALOG[core].status == "implemented"


def test_presets_all_validate_and_the_four_required_exist():
    for required in ["monza_wet_braking", "monza_fade_stale_speed", "baku_sensor_freeze", "baku_late_warning_delivery"]:
        assert required in SCENARIOS
    for s in SCENARIOS.values():
        zones = {h.id for h in TRACK_PRESETS[s.track].hazard_zones}
        for f in s.faults:
            assert f.source == "preset"
            if f.trigger.kind == "zone":
                assert f.trigger.zone_id in zones


# --- scheduler ----------------------------------------------------------------


def test_zone_trigger_fires_once_per_lap_and_reports_lifecycle():
    sched = FaultScheduler.from_specs(MONZA, [fault("w", "grip_loss", {"kind": "zone", "zone_id": "rettifilo__t1", "pad_m": 50})])
    z = next(h for h in MONZA.hazard_zones if h.id == "rettifilo__t1")
    assert sched.faults[0].state == "pending"
    ev = sched.update(1.0, 0.05, z.start_distance - 10, lap=0, speed=50)
    assert [e["event"] for e in ev] == ["fault_activated"] and sched.faults[0].state == "active"
    ev = sched.update(2.0, 0.05, z.end_distance + 5, lap=0, speed=50)
    assert [e["event"] for e in ev] == ["fault_deactivated"] and sched.faults[0].state == "waiting"
    # back inside the zone in the same lap: must not fire again
    assert sched.update(3.0, 0.05, z.start_distance, lap=0, speed=50) == []
    # next lap: fires again
    sched.update(4.0, 0.05, 10.0, lap=1, speed=50)
    ev = sched.update(5.0, 0.05, MONZA.total_length + z.start_distance, lap=1, speed=50)
    assert [e["event"] for e in ev] == ["fault_activated"]


def test_zone_with_pad_wraps_over_the_start_finish_line():
    first = MONZA.hazard_zones[0]
    spec = fault("w", "grip_loss", {"kind": "zone", "zone_id": first.id, "pad_m": first.start_distance + 30})
    sched = FaultScheduler.from_specs(MONZA, [spec])
    sched.update(0.0, 0.05, MONZA.total_length - 10, lap=0, speed=10)  # 10 m before the line
    assert sched.faults[0].level == 1.0


def test_ramps_and_duration_cap():
    sched = FaultScheduler.from_specs(MONZA, [fault("r", "grip_loss", {"kind": "time", "start": 0}, grip_multiplier=0.5)])
    sched.faults[0].spec.ramp_in_s = 1.0
    sched.update(0.05, 0.05, 0, 0, 0)
    assert 0 < sched.faults[0].level < 0.1
    capped = FaultScheduler.from_specs(MONZA, [FaultSpec(id="c", type="uplink_blackout", duration_s=1.0)])
    for i in range(40):
        capped.update(i * 0.05, 0.05, 0, 0, 0)
    assert capped.faults[0].level == 0 and capped.faults[0].state == "completed"


def test_speed_condition_trigger():
    sched = FaultScheduler.from_specs(MONZA, [fault("s", "uplink_delay", {"kind": "speed_above", "start": 60})])
    sched.update(0.0, 0.05, 0, 0, speed=50)
    assert sched.faults[0].level == 0
    sched.update(0.05, 0.05, 0, 0, speed=70)
    assert sched.faults[0].level == 1


# --- composition --------------------------------------------------------------


def test_composition_rules():
    specs = [
        fault("g1", "grip_loss", grip_multiplier=0.8),
        fault("g2", "grip_loss", grip_multiplier=0.5),
        fault("d1", "uplink_delay", delay_ms=100),
        fault("d2", "uplink_delay", delay_ms=200),
        fault("l1", "uplink_loss", probability=0.5),
        fault("l2", "uplink_loss", probability=0.5),
        fault("c1", "brake_saturation", max_brake=0.7),
        fault("c2", "brake_saturation", max_brake=0.4),
        fault("b1", "speed_bias", scale=1.1, offset_ms=2),
        fault("b2", "speed_bias", scale=1.1, offset_ms=3),
    ]
    sched = FaultScheduler.from_specs(MONZA, specs)
    sched.update(0.0, 0.05, 0, 0, 0)
    e = resolve(sched)
    assert e.grip == pytest.approx(0.4)  # 0.8 * 0.5, multipliers multiply
    assert e.uplink_delay_ms == pytest.approx(300)  # delays add
    assert e.uplink_loss == pytest.approx(0.75)  # 1 - 0.5 * 0.5
    assert e.brake_cap == pytest.approx(0.4)  # caps take the minimum
    assert e.speed_scale == pytest.approx(1.21) and e.speed_offset == pytest.approx(5)
    very = FaultScheduler.from_specs(MONZA, [fault(f"g{i}", "grip_loss", grip_multiplier=0.4) for i in range(3)])
    very.update(0.0, 0.05, 0, 0, 0)
    assert resolve(very).grip == 0.3  # clamped


# --- physics / world ----------------------------------------------------------


def test_lower_actual_grip_changes_vehicle_response():
    v = DemoVehicleState(speed=40.0)
    dry = step(v, 1.0, 0.0, 0.0, 0.05, MONZA, grip=1.0)
    wet = step(v, 1.0, 0.0, 0.0, 0.05, MONZA, grip=0.5)
    assert abs(wet.heading) < abs(dry.heading)


def stopping_distance(faults) -> float:
    run = fresh_run(faults)
    run.vehicle = state_at_distance(MONZA, 200, speed=60)
    start = run.vehicle.distance_along_lap
    while run.vehicle.speed > 1:
        run.tick(0.0, 0.0, 1.0)
    return run.vehicle.distance_along_lap - start


def test_brake_fade_increases_braking_distance_and_servicing_does_not_remove_it():
    clean = stopping_distance([])
    faded = stopping_distance([fault("f", "brake_fade", effectiveness=0.6)])
    assert faded > clean * 1.3

    def serviced(faults):
        run = StressRun(RunConfig(profile=MONZA, scenario=scenario("monza", faults),
                                  upgrades=UpgradeConfig(brake_servicing=True)))
        run.vehicle = state_at_distance(MONZA, 200, speed=60)
        start = run.vehicle.distance_along_lap
        while run.vehicle.speed > 1:
            run.tick(0.0, 0.0, 1.0)
        return run.vehicle.distance_along_lap - start

    assert serviced([]) < clean  # restores persistent wear
    assert serviced([fault("f", "brake_fade", effectiveness=0.6)]) > serviced([])  # fade still applies


def test_barrier_stops_the_car_leaving_into_the_scenery():
    v = state_at_distance(BAKU, 100, speed=60, heading_error=0.4)
    worst = 0.0
    for _ in range(100):
        v = step(v, 0.0, 0.5, 0.0, 0.05, BAKU)
        from app.placeholder_sim import signed_clearance
        worst = min(worst, signed_clearance(v.x, v.y, BAKU, hint=v.nearest_point_index))
    assert v.barrier_contacts >= 1
    assert worst >= -(BAKU.barrier_offset + 0.05)  # never past the wall
    assert v.speed < 60


def test_lap_cannot_complete_by_crossing_the_line_backwards():
    v = state_at_distance(MONZA, 30)
    v.heading += math.pi  # facing backwards
    for _ in range(200):
        v = step(v, 0.0, 0.6, 0.0, 0.05, MONZA)
    assert v.laps_completed == 0 and v.distance_along_lap < 0
    # ... and driving forward back over the line does not complete a lap either
    v.heading += math.pi
    for _ in range(400):
        v = step(v, 0.0, 0.6, 0.0, 0.05, MONZA)
        if v.distance_along_lap > 200:
            break
    assert v.laps_completed == 0


# --- sensors / transport / warning ------------------------------------------


def test_delayed_telemetry_increases_measurement_age():
    run = fresh_run([fault("d", "uplink_delay", delay_ms=400)])
    drive(run, 2.0)
    assert run.remote.data_age_ms(run.t) >= 390
    clean = fresh_run([])
    drive(clean, 2.0)
    assert clean.remote.data_age_ms(clean.t) < 60


def test_frozen_sensor_is_detected_while_packets_keep_arriving():
    run = fresh_run([fault("f", "sensor_freeze", {"kind": "time", "start": 1.0}, channel=0)])
    drive(run, 1.0)
    received_before = run.remote.received
    drive(run, 1.0)
    assert run.remote.received > received_before + 10  # packets still flowing
    assert run.remote.data_age_ms(run.t) > 900  # but the speed sample is old
    assert run.remote.decide(run.t).state == "stale"


def test_blackout_hits_the_warning_path_but_not_local_steering():
    blackout = fresh_run([fault("b", "uplink_blackout")])
    clean = fresh_run([])
    for r in (blackout, clean):
        drive(r, 1.0)
        drive(r, 1.0, steering=0.5)
    assert blackout.remote.received == 0 and clean.remote.received > 0
    assert blackout.vehicle.heading == pytest.approx(clean.vehicle.heading)
    assert (blackout.vehicle.x, blackout.vehicle.y) == pytest.approx((clean.vehicle.x, clean.vehicle.y))


def test_old_packets_cannot_override_newer_state():
    svc = WarningService(MONZA, WarningPolicyConfig(), "remote")
    newer = Packet(seq=5, sent_t=1.0, channels={"speed": (50, 1.0), "position": (100, 1.0), "grip": (1, 1.0)})
    older = Packet(seq=3, sent_t=0.9, channels={"speed": (80, 0.9), "position": (90, 0.9), "grip": (1, 0.9)})
    svc.receive(newer)
    svc.receive(older)
    assert svc.channels["speed"][0] == 50 and svc.rejected_old == 1


def test_buffered_packets_released_after_reconnect_are_rejected():
    r = run_scenario(SCENARIOS["baku_stale_after_reconnect"]).result
    assert r["packets_rejected_old"] > 0


def test_fallback_uses_only_its_sensors_and_shares_their_corruption():
    # local fallback reads the onboard packet channels: a speed under-read
    # reaches it exactly as it reaches the remote service
    run = StressRun(RunConfig(profile=MONZA, scenario=scenario("monza", [fault("u", "speed_bias", scale=0.8, offset_ms=0)]),
                              upgrades=UpgradeConfig(local_fallback=True)))
    drive(run, 3.0)
    true_speed = run.vehicle.speed
    assert run.local.channels["speed"][0] == pytest.approx(true_speed * 0.8, rel=0.05)
    assert run.remote.channels["speed"][0] == pytest.approx(true_speed * 0.8, rel=0.1)


def test_shared_sensor_corruption_is_not_fixed_by_fallback():
    # a frozen speed channel feeds both paths, so fallback cannot rescue it
    s = SCENARIOS["baku_sensor_freeze"]
    base = run_scenario(s).result
    fb = run_scenario(s, UpgradeConfig(local_fallback=True)).result
    assert not base["passed"] and not fb["passed"]


def test_fallback_does_fix_a_transport_only_blackout():
    s = SCENARIOS["monza_high_speed_blackout"]
    assert not run_scenario(s).result["passed"]
    assert run_scenario(s, UpgradeConfig(local_fallback=True)).result["passed"]


def test_stale_clear_becomes_a_caution_but_late_brake_is_still_shown():
    run = fresh_run([fault("d", "downlink_delay", delay_ms=600)])
    drive(run, 2.0)
    assert run.display.shown.state == "stale"  # an old "all clear" is not trusted
    r = run_scenario(SCENARIOS["baku_late_warning_delivery"]).result
    assert r["warnings"] > 0  # late BRAKE warnings still reach the driver


def test_warning_looks_along_the_route_for_the_most_overdue_corner():
    policy = WarningPolicyConfig()
    # far down a straight at top speed, the corner ahead needs braking
    h = MONZA.hazard_zones[0]
    found = assess(h.start_distance - 100, 85.0, 1.0, MONZA, policy)
    assert found is not None and found[0].id == h.id
    # ~118 m is needed from 85 m/s, so 150 m out it is correctly still clear
    assert assess(h.start_distance - 150, 85.0, 1.0, MONZA, policy) is None
    # just past a corner, the next one (not the one behind) is considered
    past = assess(h.end_distance + 5, 85.0, 1.0, MONZA, policy)
    assert past is None or past[0].id != h.id


def test_removing_a_fault_restores_normal_configuration():
    s = Session(session_id="x", track_profile=MONZA)
    handle_raw_message(s, "engineer", '{"type":"add_fault","fault":{"id":"d","type":"uplink_delay","parameters":{"delay_ms":300}}}')
    s.tick()
    assert s.run.effective.uplink_delay_ms == 300
    handle_raw_message(s, "engineer", '{"type":"cancel_fault","fault_id":"d"}')
    s.tick()
    assert s.run.effective.uplink_delay_ms == 0
    assert s.run.scheduler.faults[0].state == "cancelled"


def test_reset_clears_queues_fault_states_and_lap_state():
    s = Session(session_id="x", track_profile=MONZA)
    handle_raw_message(s, "engineer", '{"type":"add_fault","fault":{"id":"d","type":"uplink_delay","parameters":{"delay_ms":500}}}')
    s.control["throttle"] = 1.0
    for _ in range(60):
        s.tick()
    assert s.run.uplink.queue and s.vehicle.distance_along_lap > 10
    handle_raw_message(s, "driver", '{"type":"reset"}')
    assert s.run.uplink.queue == [] and s.run.t == 0
    assert s.vehicle.distance_along_lap == 0 and s.vehicle.laps_completed == 0
    assert s.run.scheduler.faults[0].state == "pending"  # re-armed, not active


def test_arming_a_scenario_does_not_activate_every_fault():
    s = Session(session_id="x", track_profile=MONZA)
    handle_raw_message(s, "engineer", '{"type":"arm_scenario","scenario_id":"monza_wet_braking"}')
    s.tick()
    states = {f.spec.id: f.state for f in s.run.scheduler.faults}
    assert states["wet_patch"] == "pending"  # waits for its zone
    assert states["slow_estimator"] == "active"  # whole-run fault


def test_overrides_scale_severity_within_bounds_and_retarget_zone():
    base = SCENARIOS["monza_wet_braking"]
    harsh = apply_overrides(base, ScenarioOverrides(severity=1.5, zone_id="ascari__t8", seed=99))
    wet = next(f for f in harsh.faults if f.id == "wet_patch")
    assert wet.parameters["grip_multiplier"] == pytest.approx(0.4)  # 1 - 0.4*1.5 = 0.4 (bound)
    assert wet.trigger.zone_id == "ascari__t8" and harsh.seed == 99


# --- reproducibility / paired experiments ------------------------------------


def test_same_seed_config_driver_gives_the_same_outcome():
    s = SCENARIOS["monza_fade_stale_speed"]
    a = run_scenario(s, record=True)
    b = run_scenario(s, record=True)
    assert a.result == b.result and a.frames == b.frames


def test_upgrades_preserve_the_same_exogenous_scenario():
    # time-triggered faults fire at the same instant whatever the upgrade
    s = scenario("monza", [fault("g", "grip_loss", {"kind": "time", "start": 5, "end": 9, "repeat": "once_per_run"}),
                           fault("l", "uplink_loss", probability=0.3)], seed=4)
    times = []
    drops = []
    for cfg in (UpgradeConfig(), UpgradeConfig(brake_servicing=True), UpgradeConfig(local_fallback=True)):
        out = run_scenario(s, cfg)
        times.append([(e["event"], e["t"]) for e in out.events if e["type"] == "fault_event" and e["fault_id"] == "g"])
        drops.append(out.result["test_id"])
    assert times[0] == times[1] == times[2] and times[0]


def test_paired_experiment_rows_share_seed_and_differ_only_in_faults():
    from app.stress.evaluation import paired

    out = paired(SCENARIOS["monza_fade_stale_speed"], UpgradeConfig(local_fallback=True))
    keys = [r["key"] for r in out["rows"]]
    assert keys == ["clean", "a", "b", "ab", "ab_upgrade"]
    by = {r["key"]: r["result"] for r in out["rows"]}
    assert by["clean"]["passed"]
    assert not by["ab"]["passed"] and by["ab_upgrade"]["passed"]


def test_no_trained_model_reports_unavailable_honestly(tmp_path, monkeypatch):
    from app.ml import risk

    monkeypatch.setattr(risk, "MODEL_DIR", tmp_path, raising=False)
    if hasattr(risk, "reset_cache"):
        risk.reset_cache()
    st = risk.status()
    assert st["available"] is False and st["reason"]
