"""Simplified closed-lap track geometry.

A track is a closed loop of straights and constant-radius arcs. Layouts follow
the corner sequence of the real circuits (names, directions, rough radii) but
are simplified test environments, not accurate reproductions. Two designated
straights are solved for so the loop closes exactly; everything is
deterministic.

Arc-length position ``s`` runs from the start/finish line (s = 0) to
``length`` and wraps around.
"""

from __future__ import annotations

import bisect
import math
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

SAMPLE_SPACING = 0.5  # target metres between centerline samples


# --------------------------------------------------------------------------- #
# Layout description
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Straight:
    length: float  # ignored for the two closure straights (solved)
    name: str = ""
    width: float | None = None


@dataclass(frozen=True)
class Arc:
    name: str
    radius: float
    angle_deg: float  # signed: + = left turn
    width: float | None = None


Segment = Straight | Arc


@dataclass(frozen=True)
class TrackProfile:
    name: str
    display_name: str
    purpose: str
    width: float  # default width; segments may override
    segments: tuple[Segment, ...]
    closure: tuple[str, str]  # names of the two straights whose lengths close the loop
    entry_speed_range: tuple[float, float]  # speed at the start line, m/s (search bounds)
    braking_zone_length: float
    # (first corner, last corner): radio shadow from 60 m before the first
    # corner's entry to the last corner's exit; packet loss is amplified there.
    telemetry_shadow: tuple[tuple[str, str], ...] = ()


# Monza: clockwise, fast. Main straight -> Rettifilo chicane -> Curva Grande ->
# Roggia chicane -> Lesmos -> Serraglio -> Ascari -> back straight -> Parabolica.
MONZA = TrackProfile(
    name="monza",
    display_name="Monza (simplified)",
    purpose="High-speed straights, heavy braking into chicanes, fast sweepers",
    width=12.0,
    segments=(
        Straight(0.0, "main straight (line to T1)"),
        Arc("T1 Rettifilo", 18.0, -85.0),
        Straight(12.0),
        Arc("T2 Rettifilo", 18.0, 75.0),
        Straight(250.0),
        Arc("T3 Curva Grande", 250.0, -80.0),
        Straight(0.0, "Curva Grande to Roggia"),
        Arc("T4 Roggia", 22.0, 55.0),
        Straight(12.0),
        Arc("T5 Roggia", 22.0, -65.0),
        Straight(150.0),
        Arc("T6 Lesmo 1", 70.0, -45.0),
        Straight(180.0),
        Arc("T7 Lesmo 2", 55.0, -45.0),
        Straight(450.0, "Serraglio"),
        Arc("T8 Ascari", 70.0, 30.0),
        Arc("T9 Ascari", 45.0, -70.0),
        Arc("T10 Ascari", 80.0, 30.0),
        Straight(900.0, "back straight"),
        Arc("T11 Parabolica", 200.0, -160.0),
        Straight(250.0, "main straight (Parabolica to line)"),
    ),
    closure=("main straight (line to T1)", "Curva Grande to Roggia"),
    entry_speed_range=(70.0, 90.0),
    braking_zone_length=250.0,
)

# Baku: anticlockwise street circuit. Start/finish on the long bottom straight,
# 90-degree city corners (T1-T6), the narrow castle climb (T8-T12, 7.5 m) with
# poor radio coverage, then the long flat-out run down the seafront and back
# onto the start straight.
BAKU = TrackProfile(
    name="baku",
    display_name="Baku (simplified)",
    purpose="Narrow street corners, castle section, telemetry-staleness testing",
    width=10.0,
    segments=(
        Straight(400.0, "line to T1"),
        Arc("T1", 22.0, 90.0),
        Straight(150.0),
        Arc("T2", 25.0, 90.0),
        Straight(0.0, "T2 to T3"),
        Arc("T3", 20.0, -90.0),
        Straight(450.0),
        Arc("T4", 22.0, -90.0),
        Straight(150.0),
        Arc("T5", 25.0, 90.0),
        Straight(300.0),
        Arc("T6", 25.0, 90.0),
        Straight(120.0, width=7.5),
        Arc("T8 Castle", 14.0, -60.0, width=7.5),
        Straight(40.0, width=7.5),
        Arc("T9 Castle", 16.0, 60.0, width=7.5),
        Straight(60.0, width=7.5),
        Arc("T10 Castle", 16.0, -50.0, width=7.5),
        Straight(60.0, width=7.5),
        Arc("T12 Castle", 20.0, 50.0, width=7.5),
        Straight(250.0),
        Arc("T15", 30.0, 90.0),
        Straight(0.0, "seafront"),
        Arc("T16 kink", 400.0, 20.0),
        Straight(500.0),
        Arc("T20", 60.0, 70.0),
        Straight(300.0, "main straight"),
    ),
    closure=("T2 to T3", "seafront"),
    entry_speed_range=(60.0, 85.0),
    braking_zone_length=180.0,
    telemetry_shadow=(("T8 Castle", "T12 Castle"),),
)

PROFILES: dict[str, TrackProfile] = {"monza": MONZA, "baku": BAKU}


# --------------------------------------------------------------------------- #
# Built track
# --------------------------------------------------------------------------- #


@dataclass(frozen=True)
class Corner:
    name: str
    index: int  # order around the lap
    s_entry: float
    s_exit: float
    curvature: float  # signed, 1/m, positive = left turn
    width: float

    @property
    def radius(self) -> float:
        return 1.0 / abs(self.curvature)

    @property
    def direction(self) -> str:
        return "left" if self.curvature > 0 else "right"

    @property
    def length(self) -> float:
        return self.s_exit - self.s_entry


@dataclass(frozen=True)
class BrakingZone:
    corner: str
    s_start: float
    s_end: float


@dataclass(frozen=True)
class TrackLocation:
    """Where a point sits relative to the track."""

    index: int
    s: float
    lateral_offset: float  # metres, positive = left of centerline
    heading: float  # centerline heading at this point (rad)
    curvature: float
    half_width: float
    boundary_distance: float  # metres to nearest edge; negative = off track

    @property
    def inside(self) -> bool:
        return self.boundary_distance >= 0.0


@dataclass
class Track:
    profile: TrackProfile
    s: np.ndarray  # (N,), s[0] = 0, spacing ds; the loop closes back to s = length
    ds: float
    length: float
    xy: np.ndarray  # (N, 2)
    heading: np.ndarray  # unwrapped
    curvature: np.ndarray
    widths: np.ndarray
    corners: list[Corner] = field(default_factory=list)
    braking_zones: list[BrakingZone] = field(default_factory=list)
    shadow_zones: list[tuple[float, float]] = field(default_factory=list)
    straight_lengths: dict[str, float] = field(default_factory=dict)

    closed: bool = True

    def __post_init__(self) -> None:
        self._entries = [c.s_entry for c in self.corners]

    @property
    def name(self) -> str:
        return self.profile.name

    @property
    def width(self) -> float:
        """Nominal width (narrower sections are in ``widths``)."""
        return self.profile.width

    @property
    def min_half_width(self) -> float:
        return float(self.widths.min() / 2.0)

    @property
    def centerline(self) -> np.ndarray:
        return self.xy

    @property
    def boundaries(self) -> tuple[np.ndarray, np.ndarray]:
        """(left, right) boundary polylines."""
        normal = np.stack([-np.sin(self.heading), np.cos(self.heading)], axis=1)
        half = (self.widths / 2.0)[:, None]
        return self.xy + normal * half, self.xy - normal * half

    def wrap(self, s: float) -> float:
        return s % self.length

    def distance_ahead(self, s_from: float, s_to: float) -> float:
        """Distance travelling forward from ``s_from`` to ``s_to`` (0..length)."""
        return (s_to - s_from) % self.length

    def _index_at(self, s: float) -> int:
        return int(round(self.wrap(s) / self.ds)) % len(self.s)

    def get_curvature(self, s: float) -> float:
        """Signed centerline curvature at arc-length position ``s``."""
        return float(self.curvature[self._index_at(s)])

    def heading_at(self, s: float) -> float:
        return float(self.heading[self._index_at(s)])

    def width_at(self, s: float) -> float:
        return float(self.widths[self._index_at(s)])

    def point_at(self, s: float) -> tuple[float, float]:
        i = self._index_at(s)
        return float(self.xy[i, 0]), float(self.xy[i, 1])

    def locate(self, x: float, y: float, hint: int | None = None, window: int = 60) -> TrackLocation:
        """Project a world point onto the centerline.

        With ``hint`` (the previous index) only a local window is searched
        (wrapping around the lap), which keeps the per-tick cost constant.
        """
        n = len(self.s)
        if hint is None:
            idx = np.arange(n)
        else:
            idx = np.arange(hint - window, hint + window + 1) % n
        seg = self.xy[idx]
        d2 = (seg[:, 0] - x) ** 2 + (seg[:, 1] - y) ** 2
        i = int(idx[int(np.argmin(d2))])
        h = float(self.heading[i])
        hx, hy = math.cos(h), math.sin(h)
        dx, dy = float(x - self.xy[i, 0]), float(y - self.xy[i, 1])
        along = dx * hx + dy * hy
        lateral = -dx * hy + dy * hx
        half = float(self.widths[i]) / 2.0
        return TrackLocation(
            index=i,
            s=self.wrap(float(self.s[i]) + along),
            lateral_offset=float(lateral),
            heading=h,
            curvature=float(self.curvature[i]),
            half_width=half,
            boundary_distance=float(half - abs(lateral)),
        )

    def is_inside_track(self, x: float, y: float) -> bool:
        return self.locate(x, y).inside

    def distance_to_boundary(self, x: float, y: float) -> float:
        """Metres to the nearest track edge; negative when off track."""
        return self.locate(x, y).boundary_distance

    def get_current_corner(self, s: float) -> Corner | None:
        """The corner containing arc-length position ``s``, if any."""
        s = self.wrap(s)
        i = bisect.bisect_right(self._entries, s) - 1
        if i >= 0 and s <= self.corners[i].s_exit:
            return self.corners[i]
        return None

    def next_corner(self, s: float) -> Corner:
        """The corner we are in, or the next one ahead (wrapping past the line)."""
        cur = self.get_current_corner(s)
        if cur is not None:
            return cur
        i = bisect.bisect_right(self._entries, self.wrap(s))
        return self.corners[i % len(self.corners)]

    def corners_ahead(self, s: float, horizon: float) -> list[tuple[Corner, float]]:
        """(corner, distance to its entry) for the current corner and those starting within ``horizon``.

        The current corner is reported with a negative distance (already inside).
        """
        s = self.wrap(s)
        out: list[tuple[Corner, float]] = []
        cur = self.get_current_corner(s)
        if cur is not None:
            out.append((cur, cur.s_entry - s))
        start = bisect.bisect_right(self._entries, s)
        for k in range(len(self.corners)):
            c = self.corners[(start + k) % len(self.corners)]
            if c is cur:
                continue
            d = self.distance_ahead(s, c.s_entry)
            if d > horizon:
                break
            out.append((c, d))
        return out

    def corner_by_name(self, name: str) -> Corner:
        for c in self.corners:
            if c.name == name:
                return c
        raise KeyError(name)

    def in_braking_zone(self, s: float) -> BrakingZone | None:
        for zone in self.braking_zones:
            if self.distance_ahead(zone.s_start, s) <= self.distance_ahead(zone.s_start, zone.s_end):
                return zone
        return None

    def in_shadow_zone(self, s: float) -> bool:
        s = self.wrap(s)
        return any(a <= s <= b for a, b in self.shadow_zones)


def _advance(x: float, y: float, h: float, seg: Segment, length: float) -> tuple[float, float, float]:
    if isinstance(seg, Straight):
        return x + length * math.cos(h), y + length * math.sin(h), h
    k = math.copysign(1.0 / seg.radius, seg.angle_deg)
    h2 = h + k * length
    return x + (math.sin(h2) - math.sin(h)) / k, y - (math.cos(h2) - math.cos(h)) / k, h2


def _seg_length(seg: Segment, lengths: dict[str, float]) -> float:
    if isinstance(seg, Straight):
        return lengths.get(seg.name, seg.length) if seg.name else seg.length
    return math.radians(abs(seg.angle_deg)) * seg.radius


def _solve_closure(p: TrackProfile) -> dict[str, float]:
    """Lengths of the two closure straights that bring the lap back to the origin."""
    total_turn = sum(s.angle_deg for s in p.segments if isinstance(s, Arc))
    if abs(abs(total_turn) - 360.0) > 1e-6:
        raise ValueError(f"{p.name}: corner angles sum to {total_turn}, must be +-360")
    a_name, b_name = p.closure
    x = y = h = 0.0
    dirs: dict[str, tuple[float, float]] = {}
    for seg in p.segments:
        if isinstance(seg, Straight) and seg.name in (a_name, b_name):
            dirs[seg.name] = (math.cos(h), math.sin(h))
            continue
        x, y, h = _advance(x, y, h, seg, _seg_length(seg, {}))
    (ax, ay), (bx, by) = dirs[a_name], dirs[b_name]
    la, lb = np.linalg.solve(np.array([[ax, bx], [ay, by]]), np.array([-x, -y]))
    if la <= 0 or lb <= 0:
        raise ValueError(f"{p.name}: closure straights would be negative ({la:.1f}, {lb:.1f}); adjust layout")
    return {a_name: float(la), b_name: float(lb)}


def _build(p: TrackProfile) -> Track:
    lengths = _solve_closure(p)
    # Segment boundaries in s.
    bounds, s0 = [], 0.0
    for seg in p.segments:
        L = _seg_length(seg, lengths)
        bounds.append((s0, s0 + L, seg))
        s0 += L
    total = s0
    n = int(round(total / SAMPLE_SPACING))
    ds = total / n
    s = np.arange(n) * ds
    xy = np.zeros((n, 2))
    heading = np.zeros(n)
    curv = np.zeros(n)
    widths = np.full(n, p.width)

    x = y = h = 0.0
    corners: list[Corner] = []
    for a, b, seg in bounds:
        mask = (s >= a) & (s < b)
        t = s[mask] - a
        w = seg.width or p.width
        widths[mask] = w
        if isinstance(seg, Straight):
            xy[mask, 0] = x + t * math.cos(h)
            xy[mask, 1] = y + t * math.sin(h)
            heading[mask] = h
        else:
            k = math.copysign(1.0 / seg.radius, seg.angle_deg)
            xy[mask, 0] = x + (np.sin(h + k * t) - math.sin(h)) / k
            xy[mask, 1] = y - (np.cos(h + k * t) - math.cos(h)) / k
            heading[mask] = h + k * t
            curv[mask] = k
            corners.append(Corner(seg.name, len(corners), a, b, k, w))
        x, y, h = _advance(x, y, h, seg, b - a)
    assert math.hypot(x, y) < 1e-6, "lap does not close"

    zones = []
    for i, c in enumerate(corners):
        prev_exit = corners[i - 1].s_exit if i > 0 else corners[-1].s_exit - total
        start = max(c.s_entry - p.braking_zone_length, prev_exit)
        zones.append(BrakingZone(c.name, start % total, c.s_entry))

    by_name = {c.name: c for c in corners}
    shadow = [(max(0.0, by_name[a].s_entry - 60.0), by_name[b].s_exit) for a, b in p.telemetry_shadow]

    return Track(
        profile=p, s=s, ds=ds, length=total, xy=xy, heading=heading, curvature=curv, widths=widths,
        corners=corners, braking_zones=zones, shadow_zones=shadow, straight_lengths=lengths,
    )


@lru_cache(maxsize=8)
def get_track(name: str) -> Track:
    """Build (or fetch from cache) a track by name."""
    if name not in PROFILES:
        raise KeyError(f"unknown track {name!r}; expected one of {sorted(PROFILES)}")
    return _build(PROFILES[name])
