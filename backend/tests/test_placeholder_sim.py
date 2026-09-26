import math

import pytest

from app.placeholder_sim import (
    TRACK_PRESETS,
    DemoVehicleState,
    next_hazard_zone,
    sector_at,
    signed_clearance,
    required_warning_distance,
    step,
    warning_hazard,
    warning_reason,
)


def test_tracks_are_closed_loops_with_sectors_and_hazards():
    for profile in TRACK_PRESETS.values():
        assert len(profile.centerline) >= 10
        assert profile.centerline[0] == profile.centerline[-1] == (0.0, 0.0)
        assert len(profile.left_edge) == len(profile.centerline)
        assert len(profile.right_edge) == len(profile.centerline)
        assert len(profile.sectors) == 3
        assert profile.sectors[-1].end_distance == pytest.approx(profile.total_length)
        assert len(profile.hazard_zones) > 0
        for hazard in profile.hazard_zones:
            assert 0 <= hazard.start_distance < hazard.end_distance <= profile.total_length


def test_narrow_hazard_zone_reduces_track_width():
    profile = TRACK_PRESETS["baku"]
    narrow = next(hz for hz in profile.hazard_zones if hz.kind == "narrow")
    mid_distance = (narrow.start_distance + narrow.end_distance) / 2
    idx = min(range(len(profile.centerline)), key=lambda i: abs(_distance_at(profile, i) - mid_distance))
    half_width_here = math.hypot(
        profile.left_edge[idx][0] - profile.centerline[idx][0],
        profile.left_edge[idx][1] - profile.centerline[idx][1],
    )
    assert half_width_here < profile.track_width / 2


def _distance_at(profile, index: int) -> float:
    total = 0.0
    for i in range(1, index + 1):
        total += math.hypot(
            profile.centerline[i][0] - profile.centerline[i - 1][0],
            profile.centerline[i][1] - profile.centerline[i - 1][1],
        )
    return total


def test_start_position_is_within_track():
    profile = TRACK_PRESETS["monza"]
    assert signed_clearance(0.0, 0.0, profile) > 0


def test_far_from_centerline_is_off_track():
    profile = TRACK_PRESETS["monza"]
    assert signed_clearance(0.0, 1000.0, profile) < 0


def test_sector_at_covers_the_whole_lap():
    profile = TRACK_PRESETS["monza"]
    assert sector_at(0.0, profile).index == 0
    assert sector_at(profile.total_length - 0.01, profile).index == 2
    # wraps correctly past a full lap
    assert sector_at(profile.total_length + 1.0, profile).index == 0


def test_next_hazard_zone_wraps_around_the_loop():
    profile = TRACK_PRESETS["monza"]
    last_hazard_start = profile.hazard_zones[-1].start_distance
    # just past the last hazard's start, the *next* one should wrap to the first
    hazard = next_hazard_zone(last_hazard_start + 1.0, profile)
    assert hazard is not None
    assert hazard.id == profile.hazard_zones[0].id


def test_warning_reason_none_when_far_from_any_hazard():
    profile = TRACK_PRESETS["monza"]
    hazard = next_hazard_zone(0.0, profile)
    assert hazard is not None
    far_before_hazard = (hazard.start_distance - 200) % profile.total_length
    assert warning_reason(far_before_hazard, profile, speed=30.0) is None


def test_warning_reason_set_when_close_to_a_hazard():
    profile = TRACK_PRESETS["monza"]
    hazard = next_hazard_zone(0.0, profile)
    assert hazard is not None
    just_before_hazard = (hazard.start_distance - 10) % profile.total_length
    reason = warning_reason(just_before_hazard, profile, speed=30.0)
    assert reason is not None
    assert hazard.label in reason


def test_throttle_increases_speed():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState()
    next_state = step(state, steering=0.0, throttle=1.0, brake=0.0, dt=0.1, profile=profile)
    assert next_state.speed > state.speed


def test_brake_decreases_speed():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(speed=20.0)
    next_state = step(state, steering=0.0, throttle=0.0, brake=1.0, dt=0.1, profile=profile)
    assert next_state.speed < state.speed


def test_steering_changes_heading_while_moving():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(speed=10.0)
    next_state = step(state, steering=1.0, throttle=0.0, brake=0.0, dt=0.1, profile=profile)
    assert next_state.heading != state.heading


def test_zero_control_does_not_turn():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(speed=10.0)
    next_state = step(state, steering=0.0, throttle=0.0, brake=0.0, dt=0.1, profile=profile)
    assert next_state.heading == state.heading


def test_frozen_state_does_not_advance_once_lap_complete():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(lap_complete=True, x=5.0)
    next_state = step(state, steering=1.0, throttle=1.0, brake=0.0, dt=0.1, profile=profile)
    assert next_state == state


def test_frozen_state_does_not_advance_once_off_track():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(track_exit=True, x=5.0)
    next_state = step(state, steering=1.0, throttle=1.0, brake=0.0, dt=0.1, profile=profile)
    assert next_state == state


def test_driving_straight_through_a_curving_corner_eventually_exits():
    # No steering input ever, so the car can't follow the corner's curve —
    # it should drift off the track rather than reach the finish.
    profile = TRACK_PRESETS["baku"]
    state = DemoVehicleState()
    for _ in range(2000):
        state = step(state, steering=0.0, throttle=1.0, brake=0.0, dt=0.05, profile=profile)
        if state.lap_complete or state.track_exit:
            break
    assert state.track_exit
    assert not state.lap_complete


def _nearest_index(x: float, y: float, centerline: list[tuple[float, float]]) -> int:
    return min(range(len(centerline)), key=lambda i: math.hypot(x - centerline[i][0], y - centerline[i][1]))


def _lookahead_point(
    x: float, y: float, centerline: list[tuple[float, float]], lookahead: float
) -> tuple[float, float]:
    i = _nearest_index(x, y, centerline)
    travelled = 0.0
    while travelled < lookahead:
        nxt = (i + 1) % len(centerline)
        travelled += math.hypot(
            centerline[nxt][0] - centerline[i][0], centerline[nxt][1] - centerline[i][1]
        )
        i = nxt
    return centerline[i]


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2 * math.pi) - math.pi


def test_lookahead_steering_can_complete_a_full_lap_at_a_safe_speed():
    # A generic pure-pursuit controller holding a speed below every corner's
    # limit: proves geometry and integrator agree well enough for a sensible
    # policy to finish a full lap on both presets.
    for profile in TRACK_PRESETS.values():
        state = DemoVehicleState()
        for _ in range(20000):
            target = _lookahead_point(state.x, state.y, profile.centerline, lookahead=6.0)
            desired_heading = math.atan2(target[1] - state.y, target[0] - state.x)
            heading_error = _wrap_angle(desired_heading - state.heading)
            steering = max(-1.0, min(1.0, heading_error * 2.0))
            throttle = 0.6 if state.speed < 12.0 else 0.0
            state = step(state, steering=steering, throttle=throttle, brake=0.0, dt=0.05, profile=profile)
            if state.lap_complete or state.track_exit:
                break
        assert state.lap_complete, f"{profile.id} did not complete a lap: {state}"
        assert not state.track_exit


def test_corner_speed_limit_is_real():
    # Same steering and path, but flat out at a hazard corner: it can't be taken.
    profile = TRACK_PRESETS["baku"]
    turn1 = next(h for h in profile.hazard_zones if h.id == "turn1")

    def drive_through(speed: float) -> DemoVehicleState:
        state = DemoVehicleState(
            x=turn1.start_distance - 20,
            speed=speed,
            nearest_point_index=int((turn1.start_distance - 20) / 4),
            distance_along_lap=turn1.start_distance - 20,
        )
        for _ in range(200):
            target = _lookahead_point(state.x, state.y, profile.centerline, lookahead=6.0)
            err = _wrap_angle(math.atan2(target[1] - state.y, target[0] - state.x) - state.heading)
            hold = speed if speed < 25 else 40
            throttle = 0.5 if state.speed < hold else 0.0
            state = step(state, max(-1, min(1, err * 2)), throttle, 0.0, 0.05, profile)
            if state.track_exit or state.distance_along_lap > turn1.end_distance + 15:
                break
        return state

    assert not drive_through(turn1.corner_speed * 0.9).track_exit
    assert drive_through(38.0).track_exit


def test_grip_loss_lowers_the_speed_a_corner_can_be_taken_at():
    profile = TRACK_PRESETS["baku"]
    state = DemoVehicleState(speed=19.0, heading=0.0)
    full = step(state, 1.0, 0.0, 0.0, 0.05, profile, grip=1.0)
    wet = step(state, 1.0, 0.0, 0.0, 0.05, profile, grip=0.65)
    assert abs(wet.heading) < abs(full.heading)


def test_brake_wear_reduces_deceleration():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(speed=30.0)
    good = step(state, 0.0, 0.0, 1.0, 0.1, profile, brake_wear=1.0)
    worn = step(state, 0.0, 0.0, 1.0, 0.1, profile, brake_wear=0.75)
    assert worn.speed > good.speed


def test_warning_only_when_braking_is_needed():
    profile = TRACK_PRESETS["monza"]
    hazard = profile.hazard_zones[0]
    close = hazard.start_distance - 10
    assert warning_hazard(close, profile, speed=hazard.corner_speed * 0.9) is None
    assert warning_hazard(close, profile, speed=hazard.corner_speed * 1.5) is hazard


def test_required_warning_distance_grows_with_speed():
    hazard = TRACK_PRESETS["baku"].hazard_zones[0]
    slow = required_warning_distance(hazard.corner_speed * 1.1, hazard)
    fast = required_warning_distance(38.0, hazard)
    assert fast > slow > 0


def test_windowed_nearest_matches_full_scan_along_a_lap():
    from app.placeholder_sim import nearest_index

    profile = TRACK_PRESETS["monza"]
    centerline = profile.centerline
    hint = 0
    for i in range(0, len(centerline), 3):
        x, y = centerline[i][0] + 1.0, centerline[i][1] - 1.0
        full = nearest_index(x, y, centerline)
        hint = nearest_index(x, y, centerline, hint=max(0, i - 2))
        assert math.hypot(x - centerline[hint][0], y - centerline[hint][1]) == math.hypot(
            x - centerline[full][0], y - centerline[full][1]
        )
