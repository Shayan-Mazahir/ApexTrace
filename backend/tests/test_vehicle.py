import math

import pytest

from app.sim import constants as C
from app.sim.vehicle import ControlInput, VehicleKinematics, VehicleParams, max_corner_speed, step


def run(state, control, params, seconds, dt=C.DT):
    for _ in range(int(round(seconds / dt))):
        state = step(state, control, params, dt)
    return state


def test_throttle_accelerates():
    s = run(VehicleKinematics(0, 0, 0, 20.0), ControlInput(throttle=1.0), VehicleParams(1.0), 2.0)
    assert s.speed > 35.0
    assert s.x > 0 and s.y == pytest.approx(0.0)


def test_top_speed_is_bounded_by_drag():
    s = run(VehicleKinematics(0, 0, 0, 85.0), ControlInput(throttle=1.0), VehicleParams(1.0), 20.0)
    assert 88.0 < s.speed < 95.0


def test_braking_decelerates_and_stops_at_zero():
    s = run(VehicleKinematics(0, 0, 0, 50.0), ControlInput(brake=1.0), VehicleParams(1.0), 5.0)
    assert s.speed == 0.0


def braking_distance_to(v_end, params):
    s = VehicleKinematics(0, 0, 0, 80.0)
    while s.speed > v_end:
        s = step(s, ControlInput(brake=1.0), params, C.DT)
    return s.x


def test_degraded_brakes_lengthen_braking_distance():
    full = braking_distance_to(40.0, VehicleParams(1.0, 1.0))
    worn = braking_distance_to(40.0, VehicleParams(1.0, 0.6))
    assert worn > full * 1.4


def test_low_grip_lengthens_braking_distance():
    assert braking_distance_to(40.0, VehicleParams(0.6)) > braking_distance_to(40.0, VehicleParams(1.0))


def test_steering_turns_left_and_right():
    left = run(VehicleKinematics(0, 0, 0, 20.0), ControlInput(steering=0.2, throttle=0.3), VehicleParams(1.0), 1.0)
    right = run(VehicleKinematics(0, 0, 0, 20.0), ControlInput(steering=-0.2, throttle=0.3), VehicleParams(1.0), 1.0)
    assert left.heading > 0 and left.y > 0
    assert right.heading < 0 and right.y < 0


def test_curvature_limited_by_grip():
    # Ask for a 25 m radius at 30 m/s: needs 36 m/s^2 lateral, more than grip 1.0 provides (24).
    k = 1 / 25
    ctrl = ControlInput(steering=k / C.MAX_STEER_CURVATURE)
    s = step(VehicleKinematics(0, 0, 0, 30.0), ctrl, VehicleParams(1.0), C.DT)
    assert abs(s.lateral_acceleration) == pytest.approx(C.GRIP_ACCEL, rel=1e-6)
    assert s.grip_usage > 1.0
    # With lower grip the car turns even less.
    low = step(VehicleKinematics(0, 0, 0, 30.0), ctrl, VehicleParams(0.6), C.DT)
    assert abs(low.lateral_acceleration) < abs(s.lateral_acceleration)


def test_braking_reduces_cornering_capacity():
    k = 1 / 60
    ctrl = ControlInput(steering=k / C.MAX_STEER_CURVATURE)
    coast = step(VehicleKinematics(0, 0, 0, 38.0), ctrl, VehicleParams(1.0), C.DT)
    braking = step(VehicleKinematics(0, 0, 0, 38.0), ControlInput(steering=ctrl.steering, brake=1.0), VehicleParams(1.0), C.DT)
    assert abs(braking.lateral_acceleration) < abs(coast.lateral_acceleration)


def test_max_corner_speed():
    assert max_corner_speed(1.0, 1 / 60) == pytest.approx(math.sqrt(24 * 60))
    assert max_corner_speed(0.6, 1 / 60) < max_corner_speed(1.0, 1 / 60)


def test_step_is_pure():
    s0 = VehicleKinematics(1, 2, 0.1, 30.0)
    a = step(s0, ControlInput(0.1, 0.5, 0.0), VehicleParams(0.9), C.DT)
    b = step(s0, ControlInput(0.1, 0.5, 0.0), VehicleParams(0.9), C.DT)
    assert a == b
