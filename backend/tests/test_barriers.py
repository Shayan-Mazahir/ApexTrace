"""Regression: the nose cannot penetrate a wall or tunnel through it."""

import math

import pytest

from app.placeholder_sim import TRACK_PRESETS, state_at_distance, step


def walls(profile):
    for edge, side in ((profile.left_edge, 1), (profile.right_edge, -1)):
        points = []
        for (x, y), (cx, cy), (lx, ly) in zip(edge, profile.centerline, profile.left_edge):
            width = math.hypot(lx - cx, ly - cy)
            points.append((x + side * profile.barrier_offset * (lx - cx) / width,
                           y + side * profile.barrier_offset * (ly - cy) / width))
        yield from zip(points, points[1:])


def assert_body_inside_wall(v, profile):
    # Independently clip each rendered wall segment to the car rectangle.
    # No wall should enter the body, even when its centre remains on track.
    c, s = math.cos(v.heading), math.sin(v.heading)
    for a, b in walls(profile):
        local = [((x - v.x) * c + (y - v.y) * s,
                  -(x - v.x) * s + (y - v.y) * c) for x, y in (a, b)]
        lo, hi = 0.0, 1.0
        for axis, extent in ((0, 2.8), (1, 1.0)):
            start, end = local[0][axis], local[1][axis]
            delta = end - start
            if abs(delta) < 1e-10:
                if abs(start) >= extent:
                    lo, hi = 1.0, 0.0
                    break
            else:
                t0, t1 = (-extent - start) / delta, (extent - start) / delta
                lo, hi = max(lo, min(t0, t1)), min(hi, max(t0, t1))
        assert lo >= hi, "rendered barrier intersects the car footprint"


@pytest.mark.parametrize("track", ["monza", "baku"])
@pytest.mark.parametrize("angle", [math.pi / 2, -math.pi / 2, 0.4, -0.4, 2.7])
@pytest.mark.parametrize("distance", [100, 2500, -10])
def test_impacts_stop_full_car_and_held_throttle_cannot_push_through(track, angle, distance):
    profile = TRACK_PRESETS[track]
    v = state_at_distance(profile, distance, speed=88, heading_error=angle)
    for _ in range(200):
        v = step(v, 0, 1, 0, 0.05, profile)
        if v.in_contact:
            break
    assert v.in_contact and v.speed == 0
    assert_body_inside_wall(v, profile)
    impact = (v.x, v.y)
    for _ in range(100):
        v = step(v, 0, 1, 0, 0.05, profile)
    assert math.hypot(v.x - impact[0], v.y - impact[1]) < 0.01
    assert v.speed == 0
    assert_body_inside_wall(v, profile)


@pytest.mark.parametrize("track", ["monza", "baku"])
def test_large_step_cannot_tunnel_completely_through_barrier(track):
    profile = TRACK_PRESETS[track]
    v = state_at_distance(profile, 100, speed=88, heading_error=math.pi / 2)
    v = step(v, 0, 1, 0, 0.5, profile)
    assert v.in_contact and v.speed == 0
    assert_body_inside_wall(v, profile)


@pytest.mark.parametrize("track", ["monza", "baku"])
def test_normal_straight_driving_is_unobstructed(track):
    profile = TRACK_PRESETS[track]
    v = state_at_distance(profile, 100, speed=30)
    v = step(v, 0, 1, 0, 0.05, profile)
    assert not v.in_contact and v.speed > 30
