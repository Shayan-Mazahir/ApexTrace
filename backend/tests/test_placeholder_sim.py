import math

from app.placeholder_sim import TRACK_PRESETS, DemoVehicleState, nearest_clearance, step


def test_track_presets_have_consistent_sampled_geometry():
    for profile in TRACK_PRESETS.values():
        assert len(profile.centerline) >= 3
        assert len(profile.left_edge) == len(profile.centerline)
        assert len(profile.right_edge) == len(profile.centerline)


def test_start_position_is_within_track():
    profile = TRACK_PRESETS["monza"]
    assert nearest_clearance(0.0, 0.0, profile) > 0


def test_far_from_centerline_is_off_track():
    profile = TRACK_PRESETS["monza"]
    assert nearest_clearance(0.0, 1000.0, profile) < 0


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


def test_frozen_state_does_not_advance_once_completed():
    profile = TRACK_PRESETS["monza"]
    state = DemoVehicleState(completed=True, x=5.0)
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
        if state.completed or state.track_exit:
            break
    assert state.track_exit
    assert not state.completed


def _nearest_index(x: float, y: float, centerline: list[tuple[float, float]]) -> int:
    return min(range(len(centerline)), key=lambda i: math.hypot(x - centerline[i][0], y - centerline[i][1]))


def _lookahead_point(x: float, y: float, centerline: list[tuple[float, float]], lookahead: float) -> tuple[float, float]:
    i = _nearest_index(x, y, centerline)
    travelled = 0.0
    while i < len(centerline) - 1 and travelled < lookahead:
        travelled += math.hypot(
            centerline[i + 1][0] - centerline[i][0], centerline[i + 1][1] - centerline[i][1]
        )
        i += 1
    return centerline[i]


def _wrap_angle(angle: float) -> float:
    return (angle + math.pi) % (2 * math.pi) - math.pi


def test_lookahead_steering_can_complete_the_run():
    # A generic pure-pursuit-style controller (steer toward a point some
    # distance ahead on the centerline) rather than a track-specific hack —
    # proves the geometry and integrator agree well enough for *some*
    # sensible policy to actually finish a run, on both presets.
    for profile in TRACK_PRESETS.values():
        state = DemoVehicleState()
        for _ in range(4000):
            target = _lookahead_point(state.x, state.y, profile.centerline, lookahead=6.0)
            desired_heading = math.atan2(target[1] - state.y, target[0] - state.x)
            heading_error = _wrap_angle(desired_heading - state.heading)
            steering = max(-1.0, min(1.0, heading_error * 2.0))
            state = step(state, steering=steering, throttle=0.5, brake=0.0, dt=0.05, profile=profile)
            if state.completed or state.track_exit:
                break
        assert state.completed, f"{profile.id} did not complete: {state}"
        assert not state.track_exit
