"""2026-spec car model (app/f1_car.py) and the driver features built on it."""

import json
import math

import pytest

from app.f1_car import (
    CAR,
    CarSetup,
    CarState,
    DriverRequests,
    braking_decel,
    corner_speed_for_radius,
    gear_for_speed,
    max_lateral_accel,
    step_car,
    top_speed_estimate,
)
from app.placeholder_sim import TRACK_PRESETS, DemoVehicleState, initial_state, state_at_distance, step
from app.schemas import CarSetupConfig
from app.session_state import Session, apply_message, handle_raw_message

G = 9.81


def drive(state, seconds, steering=0.0, throttle=0.0, brake=0.0, setup=CarSetup(), requests=DriverRequests()):
    heading = 0.0
    x = 0.0
    for i in range(round(seconds / 0.05)):
        state, heading, dx, _ = step_car(state, heading, steering, throttle, brake, 0.05, setup=setup,
                                         requests=requests if i == 0 else DriverRequests())
        x += dx
    return state, heading, x


def time_to(kmh_marks, setup=CarSetup()):
    state, t, out = CarState(), 0.0, {}
    while t < 15 and len(out) < len(kmh_marks):
        state, _, _, _ = step_car(state, 0.0, 0.0, 1.0, 0.0, 0.05, setup=setup)
        t += 0.05
        for m in kmh_marks:
            if m not in out and state.vx * 3.6 >= m:
                out[m] = t
    return out


def test_performance_is_in_the_2026_f1_range():
    marks = time_to((100, 200))
    assert 2.2 < marks[100] < 3.2  # published ~2.4-2.6 s
    assert 4.0 < marks[200] < 5.6  # ~4.8 s
    assert 310 < top_speed_estimate() * 3.6 < top_speed_estimate(drs_open=True) * 3.6 < 360


def test_downforce_makes_grip_and_braking_grow_with_speed():
    slow, fast = max_lateral_accel(100 / 3.6), max_lateral_accel(300 / 3.6)
    assert 1.6 * G < slow < 2.5 * G and 4.0 * G < fast < 5.5 * G
    assert braking_decel(300 / 3.6) > 1.8 * braking_decel(100 / 3.6)
    # a medium corner is much faster than sqrt(mu g R); a big sweeper is flat out
    assert corner_speed_for_radius(100) > 1.3 * math.sqrt(1.6 * G * 100)
    assert corner_speed_for_radius(400, cap=95) == 95


def test_traction_control_catches_power_oversteer():
    start = CarState(vx=80 / 3.6, gear=2)
    off, _, _ = drive(start, 1.5, steering=0.6, throttle=1.0, setup=CarSetup(traction_control="off"))
    full, _, _ = drive(start, 1.5, steering=0.6, throttle=1.0, setup=CarSetup(traction_control="full"))
    slip = lambda s: abs(math.degrees(math.atan2(s.vy, s.vx)))  # noqa: E731
    assert slip(off) > 10 and slip(full) < 5
    assert full.tc_cut > 0


def test_abs_prevents_lockups_and_its_absence_allows_them():
    start = CarState(vx=150 / 3.6, gear=4)
    with_abs, _, _ = drive(start, 0.5, steering=0.4, brake=1.0, setup=CarSetup(abs=True))
    without, _, _ = drive(start, 0.5, steering=0.4, brake=1.0, setup=CarSetup(abs=False))
    assert not with_abs.front_lock and without.front_lock


def test_automatic_gearbox_climbs_through_the_gears():
    state, _, _ = drive(CarState(), 10.0, throttle=1.0)
    assert state.gear >= 6 and state.rpm <= CAR.rev_limit


def test_manual_gearbox_obeys_requests_and_refuses_an_over_rev_downshift():
    manual = CarSetup(gearbox="manual")
    stuck, _, _ = drive(CarState(), 6.0, throttle=1.0, setup=manual)
    assert stuck.gear == 1 and stuck.vx * 3.6 < CAR.gear_speeds_kmh[0] * 1.05  # on the limiter
    up, _, _ = drive(CarState(vx=20, gear=1), 0.05, setup=manual, requests=DriverRequests(shift_up=2))
    assert up.gear == 3
    fast = CarState(vx=250 / 3.6, gear=6)
    down, _, _ = drive(fast, 0.05, setup=manual, requests=DriverRequests(shift_down=4))
    assert engine_ok(down) and down.gear >= gear_for_speed(fast.vx) - 1


def engine_ok(state):
    return state.rpm <= CAR.rev_limit


def test_mguk_fades_at_high_speed_and_overtake_mode_extends_it():
    def deploy(kmh, mode):
        s, _, _, _ = step_car(CarState(vx=kmh / 3.6, gear=gear_for_speed(kmh / 3.6)), 0.0, 0.0, 1.0, 0.0, 0.05,
                              setup=CarSetup(ers_mode=mode))
        return s.ers_deploy_kw

    assert deploy(250, "balanced") == pytest.approx(350, rel=0.01)
    assert deploy(320, "balanced") < deploy(300, "balanced") < 350
    assert deploy(320, "overtake") == pytest.approx(350, rel=0.01)
    assert deploy(250, "harvest") < 0  # recharging


def test_battery_drains_on_throttle_and_recharges_under_braking():
    full = CarState(vx=150 / 3.6, gear=4)
    after_push, _, _ = drive(full, 3.0, throttle=1.0)
    assert after_push.battery < full.battery - 0.8e6
    after_brake, _, _ = drive(after_push, 2.0, brake=1.0)
    assert after_brake.battery > after_push.battery


def test_active_aero_opens_on_straights_and_closes_under_braking():
    start = CarState(vx=250 / 3.6, gear=6)
    s, _, _, _ = step_car(start, 0.0, 0.0, 1.0, 0.0, 0.05, drs_allowed=True)
    assert s.drs_open
    s, _, _, _ = step_car(s, 0.0, 0.0, 0.0, 1.0, 0.05, drs_allowed=True)
    assert not s.drs_open
    s, _, _, _ = step_car(start, 0.0, 0.0, 1.0, 0.0, 0.05, drs_allowed=False)
    assert not s.drs_open  # not in a corner zone
    manual = CarSetup(drs_mode="manual")
    s, _, _, _ = step_car(start, 0.0, 0.0, 1.0, 0.0, 0.05, drs_allowed=True, setup=manual)
    assert not s.drs_open
    s, _, _, _ = step_car(start, 0.0, 0.0, 1.0, 0.0, 0.05, drs_allowed=True, setup=manual,
                          requests=DriverRequests(drs_toggle=1))
    assert s.drs_open


def test_reverse_gear():
    s, _, x = drive(CarState(gear=1), 4.0, throttle=1.0, requests=DriverRequests(reverse_toggle=1))
    assert s.gear == -1 and x < -10 and s.vx >= -CAR.reverse_max_speed - 1e-9
    moving, _, _ = drive(CarState(vx=30, gear=3), 0.05, requests=DriverRequests(reverse_toggle=1))
    assert moving.gear != -1  # only when nearly stopped


# ---------------------------------------------------------------- laps & sessions


def test_running_wide_keeps_the_lap_but_leaving_the_track_voids_it():
    profile = TRACK_PRESETS["monza"]
    half = profile.track_width / 2
    wide = state_at_distance(profile, 200, speed=30, lateral_offset=half + 0.5)  # centre just past the line
    out = state_at_distance(profile, 200, speed=30, lateral_offset=half + 2.5)  # whole car beyond it
    assert step(wide, 0, 0, 0, 0.05, profile).lap_clean
    assert not step(out, 0, 0, 0, 0.05, profile).lap_clean


def _session():
    return Session(session_id="t", track_profile=TRACK_PRESETS["monza"])


def _control(**counts):
    return json.dumps({"type": "control_input", "seq": 1, "session_id": "t", "track": "monza", "seed": 1,
                       "t_client": 0.0, "steering": 0.0, "throttle": 0.0, "brake": 0.0, **counts})


def test_manual_shifts_arrive_once_from_running_totals():
    s = _session()
    handle_raw_message(s, "driver", json.dumps({"type": "car_setup", "setup": {"gearbox": "manual"}}))
    assert s.run.config.setup.gearbox == "manual"
    s.run.vehicle = DemoVehicleState(**{**s.run.vehicle.__dict__, "speed": 20.0, "gear": 1})
    handle_raw_message(s, "driver", _control(shift_up_count=5))  # baseline only
    s.tick()
    assert s.run.vehicle.gear == 1
    handle_raw_message(s, "driver", _control(shift_up_count=6))
    handle_raw_message(s, "driver", _control(shift_up_count=6))  # repeated packet: no double shift
    s.tick()
    assert s.run.vehicle.gear == 2


def test_session_best_lap_survives_a_reset():
    s = _session()
    s.run.vehicle = DemoVehicleState(**{**s.run.vehicle.__dict__, "best_lap_time": 91.5})
    s.tick()
    apply_message(s, "driver", type("M", (), {"type": "reset"})())
    s.tick()
    msg = s.tick()[-1]
    assert msg["best_lap_s"] is None and msg["session_best_lap_s"] == 91.5


def test_state_message_reports_car_telemetry():
    s = _session()
    msg = s.tick()[-1]
    for key in ("gear", "rpm", "battery_pct", "drs_open", "tc_active", "lap_valid", "g_lat", "setup"):
        assert key in msg
    assert CarSetupConfig.model_validate(msg["setup"]).traction_control == "full"


def test_new_session_starts_stationary_on_the_grid():
    v = initial_state(TRACK_PRESETS["baku"])
    assert v.speed == 0 and v.gear == 0 and v.battery == CAR.battery_capacity
