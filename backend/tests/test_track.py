import math

import pytest

from app.sim.track import PROFILES, get_track


@pytest.fixture(params=["monza", "baku"])
def track(request):
    return get_track(request.param)


def test_centerline_is_inside(track):
    for s in (0.0, 100.0, track.corners[0].s_entry + 10, track.length - 1):
        x, y = track.point_at(s)
        assert track.is_inside_track(x, y)
        assert track.distance_to_boundary(x, y) == pytest.approx(track.half_width, abs=0.3)


def test_point_beyond_edge_is_outside(track):
    s = 50.0
    x, y = track.point_at(s)
    h = track.heading_at(s)
    # Move perpendicular (to the left) by more than half the width.
    off = track.half_width + 1.0
    ox, oy = x - math.sin(h) * off, y + math.cos(h) * off
    assert not track.is_inside_track(ox, oy)
    assert track.distance_to_boundary(ox, oy) == pytest.approx(-1.0, abs=0.05)
    assert track.locate(ox, oy).lateral_offset > 0


def test_point_just_inside_edge(track):
    s = 30.0
    x, y = track.point_at(s)
    h = track.heading_at(s)
    off = track.half_width - 0.5
    ox, oy = x + math.sin(h) * off, y - math.cos(h) * off  # to the right
    assert track.is_inside_track(ox, oy)
    assert track.locate(ox, oy).lateral_offset < 0


def test_corner_lookup(track):
    corner = track.corners[0]
    mid = 0.5 * (corner.s_entry + corner.s_exit)
    assert track.get_current_corner(mid) is corner
    assert track.get_current_corner(corner.s_entry - 5) is None
    assert track.get_current_corner(corner.s_exit + 5) is None
    assert track.next_corner(0.0) is corner
    assert track.next_corner(corner.s_exit + 5) is None


def test_curvature(track):
    corner = track.corners[0]
    mid = 0.5 * (corner.s_entry + corner.s_exit)
    assert track.get_curvature(mid) == pytest.approx(corner.curvature)
    assert track.get_curvature(10.0) == 0.0
    # Turn direction matches the profile.
    assert math.copysign(1, corner.curvature) == track.profile.corner_direction


def test_corner_turns_full_angle(track):
    assert abs(track.heading[-1]) == pytest.approx(math.radians(track.profile.corner_angle_deg), abs=1e-6)


def test_braking_zone_precedes_corner(track):
    zone = track.braking_zones[0]
    assert zone.s_end == track.corners[0].s_entry
    assert track.in_braking_zone(zone.s_end - 1) is zone


def test_geometry_is_deterministic():
    a = get_track("monza", 1 / 50)
    b = get_track("monza", 1 / 50)
    assert (a.xy == b.xy).all()


def test_custom_curvature_and_bounds():
    t = get_track("baku", 1 / 20)
    assert t.corners[0].radius == pytest.approx(20.0)
    with pytest.raises(ValueError):
        get_track("baku", 1 / 5)
    with pytest.raises(KeyError):
        get_track("spa")


def test_local_search_matches_global():
    t = get_track("monza")
    x, y = t.point_at(480.0)
    glob = t.locate(x + 1, y - 2)
    loc = t.locate(x + 1, y - 2, hint=glob.index + 10)
    assert loc.index == glob.index


def test_profiles_have_two_tracks():
    assert set(PROFILES) == {"monza", "baku"}
    assert PROFILES["baku"].width < PROFILES["monza"].width
