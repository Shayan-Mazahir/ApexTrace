import math

import numpy as np
import pytest

from app.sim.track import PROFILES, get_track


@pytest.fixture(params=["monza", "baku"])
def track(request):
    return get_track(request.param)


def offset_point(track, s, lateral):
    """World point ``lateral`` metres left (+) / right (-) of the centerline at ``s``."""
    x, y = track.point_at(s)
    h = track.heading_at(s)
    return x - math.sin(h) * lateral, y + math.cos(h) * lateral


def test_lap_closes(track):
    first, last = track.xy[0], track.xy[-1]
    assert np.hypot(*(first - last)) <= track.ds + 1e-6  # last sample is one step before the start
    turn = sum(c.curvature * c.length for c in track.corners)
    assert abs(turn) == pytest.approx(2 * math.pi, abs=1e-6)


def test_no_self_intersection(track):
    xy, s = track.xy[::8], track.s[::8]
    d = np.sqrt(((xy[:, None] - xy[None]) ** 2).sum(-1))
    sep = np.abs(s[:, None] - s[None])
    sep = np.minimum(sep, track.length - sep)
    assert d[sep > 80].min() > track.width * 2


def test_centerline_is_inside(track):
    for s in np.linspace(0, track.length, 40, endpoint=False):
        x, y = track.point_at(s)
        assert track.is_inside_track(x, y)
        assert track.distance_to_boundary(x, y) == pytest.approx(track.width_at(s) / 2, abs=0.3)


def test_point_beyond_edge_is_outside(track):
    for s in (50.0, track.corners[3].s_entry + 5):
        ox, oy = offset_point(track, s, track.width_at(s) / 2 + 1.0)
        assert not track.is_inside_track(ox, oy)
        assert track.distance_to_boundary(ox, oy) == pytest.approx(-1.0, abs=0.1)
        assert track.locate(ox, oy).lateral_offset > 0


def test_point_just_inside_edge(track):
    ox, oy = offset_point(track, 30.0, -(track.width_at(30.0) / 2 - 0.5))
    assert track.is_inside_track(ox, oy)
    assert track.locate(ox, oy).lateral_offset < 0


def test_corner_lookup(track):
    for i, corner in enumerate(track.corners):
        mid = 0.5 * (corner.s_entry + corner.s_exit)
        assert track.get_current_corner(mid) is corner
        assert track.next_corner(mid) is corner
        assert corner.index == i
    first = track.corners[0]
    assert track.get_current_corner(1.0) is None  # start line is on a straight
    assert track.next_corner(1.0) is first
    # Past the last corner, the next corner wraps around to the first.
    last = track.corners[-1]
    assert track.next_corner(last.s_exit + 1.0) is first


def test_corners_ahead(track):
    c0, c1 = track.corners[0], track.corners[1]
    ahead = track.corners_ahead(c0.s_entry - 10.0, horizon=c1.s_entry - c0.s_entry + 20)
    assert [c.name for c, _ in ahead[:2]] == [c0.name, c1.name]
    assert ahead[0][1] == pytest.approx(10.0)
    inside = track.corners_ahead(c0.s_entry + 1.0, horizon=0.0)
    assert inside[0][0] is c0 and inside[0][1] < 0


def test_curvature(track):
    for c in track.corners:
        assert track.get_curvature(0.5 * (c.s_entry + c.s_exit)) == pytest.approx(c.curvature)
    assert track.get_curvature(10.0) == 0.0


def test_lap_direction():
    # Monza runs clockwise (net right turn), Baku anticlockwise.
    assert sum(c.curvature * c.length for c in get_track("monza").corners) < 0
    assert sum(c.curvature * c.length for c in get_track("baku").corners) > 0


def test_braking_zones_precede_corners(track):
    assert len(track.braking_zones) == len(track.corners)
    for zone, corner in zip(track.braking_zones, track.corners):
        assert zone.corner == corner.name and zone.s_end == corner.s_entry
        if track.distance_ahead(zone.s_start, zone.s_end) > 1.0:  # back-to-back arcs have an empty zone
            assert track.in_braking_zone(corner.s_entry - 1) is zone


def test_wraparound_locate(track):
    x, y = track.point_at(track.length - 1.0)
    loc = track.locate(x, y, hint=2)  # hint near the start: window wraps
    assert loc.s == pytest.approx(track.length - 1.0, abs=0.6)
    assert track.distance_ahead(track.length - 1.0, 1.0) == pytest.approx(2.0)


def test_local_search_matches_global():
    t = get_track("monza")
    x, y = t.point_at(1480.0)
    glob = t.locate(x + 1, y - 2)
    loc = t.locate(x + 1, y - 2, hint=glob.index + 10)
    assert loc.index == glob.index


def test_baku_castle_is_narrow_and_shadowed():
    t = get_track("baku")
    castle = t.corner_by_name("T9 Castle")
    assert castle.width == 7.5 and t.width_at(castle.s_entry + 1) == 7.5
    assert t.in_shadow_zone(castle.s_entry)
    assert not t.in_shadow_zone(10.0)


def test_geometry_is_deterministic():
    from app.sim.track import MONZA, _build

    assert (_build(MONZA).xy == get_track("monza").xy).all()
    with pytest.raises(KeyError):
        get_track("spa")


def test_profiles():
    assert set(PROFILES) == {"monza", "baku"}
    assert len(get_track("monza").corners) >= 10 and len(get_track("baku").corners) >= 10
    assert 3500 < get_track("monza").length < 6000 and 3500 < get_track("baku").length < 6000
