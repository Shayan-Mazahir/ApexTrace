"""Geometry checks for the drive-screen circuits (track_layouts.py)."""

import math

import numpy as np
import pytest

from app.placeholder_sim import _clearance_at_index, _signed_curvatures, build_profile_from_layout, half_width_at
from app.track_layouts import LAYOUTS

PROFILES = {name: build_profile_from_layout(layout) for name, layout in LAYOUTS.items()}


def heading_steps_deg(profile) -> np.ndarray:
    c = np.array(profile.centerline)
    h = np.arctan2(np.diff(c[:, 1]), np.diff(c[:, 0]))
    return np.degrees(np.abs((np.diff(h) + math.pi) % (2 * math.pi) - math.pi))


@pytest.mark.parametrize("track", sorted(PROFILES))
def test_no_cusps(track):
    """A traced corner collapsed onto one waypoint turns into a spike; the tightest
    real corners here (Baku T5-T6, castle) stay under ~20 degrees per 4 m sample."""
    assert heading_steps_deg(PROFILES[track]).max() < 20.0


@pytest.mark.parametrize("track", sorted(PROFILES))
def test_distant_parts_of_the_lap_do_not_touch(track):
    p = PROFILES[track]
    c = np.array(p.centerline)[::2]
    n = len(c)
    d = np.sqrt(((c[:, None] - c[None]) ** 2).sum(-1))
    idx = np.arange(n)
    sep = np.abs(idx[:, None] - idx[None])
    sep = np.minimum(sep, n - sep) * 8.0
    assert d[sep > 150].min() > p.track_width + 2 * p.barrier_offset


def test_baku_castle_clearance_uses_the_narrow_width():
    p = PROFILES["baku"]
    narrow = [i for i in range(len(p.centerline) - 1) if half_width_at(i, p) < 3.81]
    assert len(narrow) * 4 > 150  # full 7.6 m width for ~200 m, plus tapers either side
    i = narrow[len(narrow) // 2]
    x, y = p.centerline[i]
    assert _clearance_at_index(x, y, i, p) == pytest.approx(7.6 / 2, abs=0.05)


def test_baku_runs_straight_into_turn_15():
    """No S-wobble between Turn 13 and Turn 15 (the traced points used to zig-zag)."""
    p = PROFILES["baku"]
    hz = {h.label: h for h in p.hazard_zones}
    k = np.array(_signed_curvatures(p.centerline, 3))
    seg = k[int(hz["Turn 13"].end_distance // 4): int(hz["Turn 15"].start_distance // 4)]
    significant = seg[np.abs(seg) > 1 / 500]
    assert int((np.diff(np.sign(significant)) != 0).sum()) == 0
