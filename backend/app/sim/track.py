"""Simplified track geometry.

A track is a sampled 2D centerline built from straight and arc segments. It is
a test environment, not a reproduction of a real circuit. Geometry is fully
deterministic: the same profile and corner curvature always give the same track.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from functools import lru_cache

import numpy as np

SAMPLE_SPACING = 0.5  # metres between centerline samples


@dataclass(frozen=True)
class Corner:
    name: str
    s_entry: float
    s_exit: float
    curvature: float  # signed, 1/m, positive = left turn

    @property
    def radius(self) -> float:
        return 1.0 / abs(self.curvature)

    @property
    def direction(self) -> str:
        return "left" if self.curvature > 0 else "right"


@dataclass(frozen=True)
class BrakingZone:
    corner: str
    s_start: float
    s_end: float


@dataclass(frozen=True)
class TrackProfile:
    """Parameters for one simplified test track.

    The layout is: approach straight -> single constant-radius corner -> exit straight.
    """

    name: str
    display_name: str
    purpose: str
    width: float
    approach_length: float
    corner_angle_deg: float
    corner_direction: int  # +1 left, -1 right
    exit_length: float
    default_curvature: float
    curvature_range: tuple[float, float]
    entry_speed_range: tuple[float, float]  # m/s, used by scenario search bounds
    braking_zone_length: float
    # (s_start, s_end) ranges along the track where radio coverage is poor and
    # simulated packet loss is amplified. Empty = no shadow zones.
    telemetry_shadow_zones: tuple[tuple[float, float], ...] = ()


PROFILES: dict[str, TrackProfile] = {
    "monza": TrackProfile(
        name="monza",
        display_name="Monza (simplified)",
        purpose="High-speed approach, heavy braking, corner-entry warning",
        width=12.0,
        approach_length=450.0,
        corner_angle_deg=90.0,
        corner_direction=-1,
        exit_length=150.0,
        default_curvature=1 / 60,
        curvature_range=(1 / 90, 1 / 40),
        entry_speed_range=(60.0, 90.0),
        braking_zone_length=250.0,
    ),
    "baku": TrackProfile(
        name="baku",
        display_name="Baku (simplified)",
        purpose="Narrow lower-speed corner, telemetry-staleness testing",
        width=8.0,
        approach_length=250.0,
        corner_angle_deg=90.0,
        corner_direction=1,
        exit_length=100.0,
        default_curvature=1 / 25,
        curvature_range=(1 / 40, 1 / 18),
        entry_speed_range=(35.0, 65.0),
        braking_zone_length=150.0,
        telemetry_shadow_zones=((120.0, 250.0),),
    ),
}


@dataclass(frozen=True)
class TrackLocation:
    """Where a point sits relative to the track."""

    index: int
    s: float
    lateral_offset: float  # metres, positive = left of centerline
    heading: float  # centerline heading at this point (rad)
    curvature: float
    boundary_distance: float  # metres to nearest edge; negative = off track

    @property
    def inside(self) -> bool:
        return self.boundary_distance >= 0.0


@dataclass
class Track:
    profile: TrackProfile
    corner_curvature: float  # magnitude, 1/m
    s: np.ndarray
    xy: np.ndarray  # (N, 2)
    heading: np.ndarray
    curvature: np.ndarray
    corners: list[Corner] = field(default_factory=list)
    braking_zones: list[BrakingZone] = field(default_factory=list)

    @property
    def name(self) -> str:
        return self.profile.name

    @property
    def width(self) -> float:
        return self.profile.width

    @property
    def half_width(self) -> float:
        return self.profile.width / 2.0

    @property
    def length(self) -> float:
        return float(self.s[-1])

    @property
    def centerline(self) -> np.ndarray:
        return self.xy

    @property
    def boundaries(self) -> tuple[np.ndarray, np.ndarray]:
        """(left, right) boundary polylines."""
        normal = np.stack([-np.sin(self.heading), np.cos(self.heading)], axis=1)
        return self.xy + normal * self.half_width, self.xy - normal * self.half_width

    def _index_at(self, s: float) -> int:
        return int(np.clip(round(s / SAMPLE_SPACING), 0, len(self.s) - 1))

    def get_curvature(self, s: float) -> float:
        """Signed centerline curvature at arc-length position ``s``."""
        return float(self.curvature[self._index_at(s)])

    def heading_at(self, s: float) -> float:
        return float(self.heading[self._index_at(s)])

    def point_at(self, s: float) -> tuple[float, float]:
        i = self._index_at(s)
        return float(self.xy[i, 0]), float(self.xy[i, 1])

    def locate(self, x: float, y: float, hint: int | None = None, window: int = 60) -> TrackLocation:
        """Project a world point onto the centerline.

        With ``hint`` (the previous index) only a local window is searched, which
        keeps the per-tick cost constant; the simulator always passes one.
        """
        if hint is None:
            lo, hi = 0, len(self.s)
        else:
            lo, hi = max(0, hint - window), min(len(self.s), hint + window + 1)
        seg = self.xy[lo:hi]
        d2 = (seg[:, 0] - x) ** 2 + (seg[:, 1] - y) ** 2
        i = lo + int(np.argmin(d2))
        hx, hy = math.cos(self.heading[i]), math.sin(self.heading[i])
        dx, dy = x - self.xy[i, 0], y - self.xy[i, 1]
        along = dx * hx + dy * hy
        lateral = -dx * hy + dy * hx
        s = float(np.clip(self.s[i] + along, 0.0, self.length))
        return TrackLocation(
            index=i,
            s=s,
            lateral_offset=lateral,
            heading=float(self.heading[i]),
            curvature=float(self.curvature[i]),
            boundary_distance=self.half_width - abs(lateral),
        )

    def is_inside_track(self, x: float, y: float) -> bool:
        return self.locate(x, y).inside

    def distance_to_boundary(self, x: float, y: float) -> float:
        """Metres to the nearest track edge; negative when off track."""
        return self.locate(x, y).boundary_distance

    def get_current_corner(self, s: float) -> Corner | None:
        """The corner containing arc-length position ``s``, if any."""
        for corner in self.corners:
            if corner.s_entry <= s <= corner.s_exit:
                return corner
        return None

    def next_corner(self, s: float) -> Corner | None:
        """The corner we are in, or the next one ahead of ``s``."""
        for corner in self.corners:
            if s <= corner.s_exit:
                return corner
        return None

    def in_braking_zone(self, s: float) -> BrakingZone | None:
        for zone in self.braking_zones:
            if zone.s_start <= s <= zone.s_end:
                return zone
        return None

    def in_shadow_zone(self, s: float) -> bool:
        return any(a <= s <= b for a, b in self.profile.telemetry_shadow_zones)


def _build(profile: TrackProfile, curvature: float) -> Track:
    angle = math.radians(profile.corner_angle_deg)
    arc_length = angle / curvature
    signed_k = profile.corner_direction * curvature
    s_entry = profile.approach_length
    s_exit = s_entry + arc_length
    total = s_exit + profile.exit_length

    s = np.arange(0.0, total + 1e-9, SAMPLE_SPACING)
    k = np.where((s >= s_entry) & (s <= s_exit), signed_k, 0.0)
    # Integrate heading and position analytically per sample (exact for piecewise-constant curvature).
    heading = np.zeros_like(s)
    heading[s > s_entry] = signed_k * (np.minimum(s[s > s_entry], s_exit) - s_entry)
    xy = np.zeros((len(s), 2))
    for i in range(1, len(s)):
        ds = s[i] - s[i - 1]
        mid = 0.5 * (heading[i] + heading[i - 1])
        xy[i, 0] = xy[i - 1, 0] + ds * math.cos(mid)
        xy[i, 1] = xy[i - 1, 1] + ds * math.sin(mid)

    corner = Corner(name="T1", s_entry=s_entry, s_exit=s_exit, curvature=signed_k)
    zone = BrakingZone(corner="T1", s_start=max(0.0, s_entry - profile.braking_zone_length), s_end=s_entry)
    return Track(
        profile=profile,
        corner_curvature=curvature,
        s=s,
        xy=xy,
        heading=heading,
        curvature=k,
        corners=[corner],
        braking_zones=[zone],
    )


@lru_cache(maxsize=64)
def _cached(name: str, curvature: float) -> Track:
    return _build(PROFILES[name], curvature)


def get_track(name: str, corner_curvature: float | None = None) -> Track:
    """Build (or fetch from cache) a track. ``corner_curvature`` defaults to the profile's."""
    if name not in PROFILES:
        raise KeyError(f"unknown track {name!r}; expected one of {sorted(PROFILES)}")
    profile = PROFILES[name]
    k = profile.default_curvature if corner_curvature is None else float(corner_curvature)
    lo, hi = profile.curvature_range
    if not (lo - 1e-9 <= k <= hi + 1e-9):
        raise ValueError(f"corner_curvature {k:.4f} outside {name} range [{lo:.4f}, {hi:.4f}]")
    return _cached(name, round(k, 6))
