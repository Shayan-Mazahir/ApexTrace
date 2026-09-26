import math

import pytest

from app.placeholder_sim import (
    TRACK_PRESETS,
    DemoVehicleState,
    next_hazard_zone,
    sector_at,
    initial_state,
    loop_size,
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
        gaps = [math.dist(a, b) for a, b in zip(profile.centerline, profile.centerline[1:])]
        assert max(gaps) - min(gaps) < 0.08  # even along the curve (chords shrink ~1% in hairpins)
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
    idx = round(mid_distance / (profile.total_length / loop_size(profile.centerline)))
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


def test_leaving_the_track_is_recorded_but_does_not_freeze_the_car():
    profile = TRACK_PRESETS["monza"]
    start = initial_state(profile)
    # Start in the runoff, clear of the solid wall and its car-width margin.
    lateral = profile.track_width / 2 + profile.barrier_offset / 2
    off = DemoVehicleState(
        x=start.x - math.sin(start.heading) * lateral,
        y=start.y + math.cos(start.heading) * lateral,
        heading=start.heading,
        speed=60.0,
    )
    after = step(off, 0.0, 0.0, 0.0, 0.1, profile)
    assert after.off_track and after.track_exit and after.track_exits == 1
    assert after.speed > 0 and (after.x, after.y) != (off.x, off.y)  # still moving
    # runoff scrubs speed much faster than on-track coasting
    on = step(start.__class__(**{**start.__dict__, "speed": 60.0}), 0.0, 0.0, 0.0, 0.1, profile)
    later = after
    for _ in range(10):
        later = step(later, 0.0, 0.0, 0.0, 0.1, profile)
    assert later.speed < on.speed - 10

def test_track_exit_is_sticky_and_exits_are_counted_once_per_excursion():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(off_track=True, track_exit=True, track_exits=1, speed=10.0,
                             x=0.0, y=30.0, heading=initial_state(profile).heading)
    nxt = step(state, 0.0, 0.0, 0.0, 0.05, profile)
    assert nxt.track_exit and nxt.track_exits == 1  # still the same excursion

def test_driving_straight_through_a_curving_corner_eventually_exits():
    # No steering input ever, so the car can't follow the corner's curve —
    # it should drift off the track rather than reach the finish.
    profile = TRACK_PRESETS["baku"]
    state = initial_state(profile)
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


def _pure_pursuit(state, profile, lookahead_m=10.0):
    n = loop_size(profile.centerline)
    ahead = max(1, math.ceil(lookahead_m / (profile.total_length / n)))
    tx, ty = profile.centerline[(state.nearest_point_index + ahead) % n]
    dx, dy = tx - state.x, ty - state.y
    alpha = _wrap_angle(math.atan2(dy, dx) - state.heading)
    wanted = 2 * math.sin(alpha) / max(math.hypot(dx, dy), 1.0)
    from app.f1_car import steering_for_curvature

    return steering_for_curvature(state.speed, wanted)


def test_pure_pursuit_at_a_safe_speed_completes_clean_laps_and_times_them():
    # Geometry and integrator agree well enough for a sensible policy to lap
    # both real layouts, and laps keep counting with lap times recorded.
    for profile in TRACK_PRESETS.values():
        state = initial_state(profile)
        for _ in range(40000):
            throttle = 0.6 if state.speed < 15.0 else 0.0
            state = step(state, _pure_pursuit(state, profile), throttle, 0.0, 0.05, profile)
            if state.laps_completed >= 2 or state.track_exit:
                break
        assert not state.track_exit, f"{profile.id}: left the track at {state.distance_along_lap:.0f} m"
        assert state.laps_completed == 2 and state.lap_complete
        assert state.last_lap_time and state.best_lap_time
        assert abs(state.last_lap_time - profile.total_length / 15.0) < 0.25 * profile.total_length / 15.0

def test_corner_speed_limit_is_real():
    # Same path-following, but carrying far too much speed into the tightest
    # corner: the car cannot make it; at a safe speed it can.
    profile = TRACK_PRESETS["baku"]
    corner = min(profile.hazard_zones, key=lambda h: h.corner_speed)
    n = loop_size(profile.centerline)
    step_m = profile.total_length / n

    def drive_through(speed: float) -> DemoVehicleState:
        i0 = round((corner.start_distance - 60) / step_m) % n
        (x0, y0), (x1, y1) = profile.centerline[i0], profile.centerline[(i0 + 1) % n]
        state = DemoVehicleState(x=x0, y=y0, heading=math.atan2(y1 - y0, x1 - x0), speed=speed,
                                 nearest_point_index=i0, distance_along_lap=i0 * step_m)
        for _ in range(400):
            state = step(state, _pure_pursuit(state, profile, 5 + 0.25 * state.speed),
                         0.3 if state.speed < speed else 0.0, 0.0, 0.05, profile)
            if state.track_exit or state.distance_along_lap > corner.end_distance + 30:
                break
        return state

    assert not drive_through(corner.corner_speed * 0.85).track_exit
    assert drive_through(min(85.0, corner.corner_speed * 2.5)).track_exit

def test_grip_loss_lowers_the_speed_a_corner_can_be_taken_at():
    profile = TRACK_PRESETS["baku"]
    state = DemoVehicleState(speed=19.0, heading=0.0)
    full = step(state, 1.0, 0.0, 0.0, 0.05, profile, grip=1.0)
    wet = step(state, 1.0, 0.0, 0.0, 0.05, profile, grip=0.65)
    assert abs(wet.heading) < abs(full.heading)


def test_full_braking_reduces_cornering_grip():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(speed=40.0)
    coasting = step(state, 1.0, 0.0, 0.0, 0.05, profile)
    braking = step(state, 1.0, 0.0, 1.0, 0.05, profile)
    assert abs(braking.heading) < abs(coasting.heading)


def test_grip_loss_also_limits_braking():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(speed=60.0)
    dry = step(state, 0.0, 0.0, 1.0, 0.1, profile, grip=1.0)
    wet = step(state, 0.0, 0.0, 1.0, 0.1, profile, grip=0.65)
    assert wet.speed > dry.speed


def test_start_state_sits_on_the_line_pointing_down_the_track():
    for profile in TRACK_PRESETS.values():
        s0 = initial_state(profile)
        (x0, y0), (x1, y1) = profile.centerline[0], profile.centerline[1]
        assert (s0.x, s0.y) == profile.start_finish
        assert abs(_wrap_angle(s0.heading - math.atan2(y1 - y0, x1 - x0))) < 1e-9
        assert signed_clearance(s0.x, s0.y, profile) > 0


def test_real_layout_lengths_and_named_corners():
    assert TRACK_PRESETS["baku"].total_length == pytest.approx(6003)
    assert TRACK_PRESETS["monza"].total_length == pytest.approx(5793)
    labels = " ".join(h.label for h in TRACK_PRESETS["monza"].hazard_zones)
    for corner in ("Rettifilo", "Roggia", "Lesmo", "Ascari", "Parabolica"):
        assert corner in labels
    baku = TRACK_PRESETS["baku"]
    castle = next(h for h in baku.hazard_zones if h.kind == "narrow")
    assert "Turn 8" in castle.label


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
