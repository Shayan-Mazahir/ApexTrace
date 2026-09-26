"""Swept vehicle/barrier contact using the same edge offsets as the renderer.

The car is a 5.6 x 2 m rectangle. Contact stops it at the first impact;
this is a solid-wall constraint, not a damage or rebound model.
"""

import math

from app.schemas import TrackProfile

HALF_LENGTH = 2.8
HALF_WIDTH = 1.0
SKIN = 0.02
CELL = 20.0
_cache: dict[int, tuple[TrackProfile, dict]] = {}


def barrier_grid(profile: TrackProfile) -> dict:
    key = id(profile)
    if key in _cache:
        return _cache[key][1]
    normals = []
    for (cx, cy), (lx, ly) in zip(profile.centerline, profile.left_edge):
        length = math.hypot(lx - cx, ly - cy) or 1.0
        normals.append(((lx - cx) / length, (ly - cy) / length))
    grid: dict = {}
    for edge, side in ((profile.left_edge, 1), (profile.right_edge, -1)):
        wall = [(x + nx * profile.barrier_offset * side,
                 y + ny * profile.barrier_offset * side)
                for (x, y), (nx, ny) in zip(edge, normals)]
        if wall[-1] != wall[0]:
            wall.append(wall[0])
        for a, b in zip(wall, wall[1:]):
            for gx in range(math.floor(min(a[0], b[0]) / CELL), math.floor(max(a[0], b[0]) / CELL) + 1):
                for gy in range(math.floor(min(a[1], b[1]) / CELL), math.floor(max(a[1], b[1]) / CELL) + 1):
                    grid.setdefault((gx, gy), []).append((a, b))
    if len(_cache) >= 8:
        _cache.pop(next(iter(_cache)))
    _cache[key] = (profile, grid)
    return grid


def _hit_fraction(x, y, dx, dy, heading, padding, a, b):
    """Continuous separating-axis test: moving rectangle vs a wall segment."""
    fx, fy = math.cos(heading), math.sin(heading)
    sx, sy = -fy, fx
    wx, wy = b[0] - a[0], b[1] - a[1]
    length = math.hypot(wx, wy)
    if length < 1e-9:
        return None
    enter, leave = 0.0, 1.0
    for nx, ny in ((fx, fy), (sx, sy), (-wy / length, wx / length)):
        radius = ((HALF_LENGTH + padding) * abs(fx * nx + fy * ny)
                  + (HALF_WIDTH + padding) * abs(sx * nx + sy * ny))
        p, q = a[0] * nx + a[1] * ny, b[0] * nx + b[1] * ny
        center, velocity = x * nx + y * ny, dx * nx + dy * ny
        lo, hi = min(p, q) - radius - center, max(p, q) + radius - center
        if abs(velocity) < 1e-12:
            if lo > 0 or hi < 0:
                return None
            continue
        t0, t1 = lo / velocity, hi / velocity
        enter, leave = max(enter, min(t0, t1)), min(leave, max(t0, t1))
        if enter > leave:
            return None
    return enter


def constrain_motion(profile, x0, y0, heading0, x1, y1, heading1):
    """Return a non-penetrating pose and contact flag, even across a whole wall.

    Small angular slices conservatively bound the rotating footprint. Each
    slice sweeps continuously, so high speed cannot tunnel between samples.
    """
    radius = math.hypot(HALF_LENGTH, HALF_WIDTH) + SKIN
    grid = barrier_grid(profile)
    candidates = set()
    for gx in range(math.floor((min(x0, x1) - radius) / CELL), math.floor((max(x0, x1) + radius) / CELL) + 1):
        for gy in range(math.floor((min(y0, y1) - radius) / CELL), math.floor((max(y0, y1) + radius) / CELL) + 1):
            candidates.update(grid.get((gx, gy), ()))
    if not candidates:
        return x1, y1, heading1, False
    angle = heading1 - heading0
    slices = max(1, math.ceil(abs(angle) / 0.02))
    dx, dy = (x1 - x0) / slices, (y1 - y0) / slices
    padding = SKIN + radius * abs(angle) / slices / 2
    for i in range(slices):
        x, y = x0 + dx * i, y0 + dy * i
        heading = heading0 + angle * (i + 0.5) / slices
        first = None
        for a, b in candidates:
            hit = _hit_fraction(x, y, dx, dy, heading, padding, a, b)
            if hit is not None and (first is None or hit < first):
                first = hit
        if first is not None:
            # Leave a tiny gap so a subsequent move away from the wall is free.
            fraction = (i + max(0.0, first - 1e-5)) / slices
            return (x0 + (x1 - x0) * fraction, y0 + (y1 - y0) * fraction,
                    heading0 + angle * fraction, True)
    return x1, y1, heading1, False
