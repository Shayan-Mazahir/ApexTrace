"""
TEMPORARY stand-in for backend/sim/* (Person A's ownership: track geometry
and vehicle physics — project task list sections B and C). Exists only so
sessions, WebSockets, and frontend rendering can be wired up and tested
before the real simulator lands. Nothing here is meant to survive that:
once backend/sim/track.py and backend/sim/core.py exist, replace the
imports in sessions.py and delete this file.

Tracks are closed loops built from a sequence of straight/arc segments,
closed by a final straight back to the start point (exact position
closure; the seam can have a heading kink — fine for a low-poly demo).
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field

from app.schemas import HazardKind, HazardZone, Sector, TrackId, TrackProfile

SAMPLE_STEP = 4.0  # meters between sampled centerline points, demo only


@dataclass
class HazardSpec:
    id: str
    kind: HazardKind
    label: str


@dataclass
class StraightSeg:
    length: float
    hazard: HazardSpec | None = None


@dataclass
class ArcSeg:
    radius: float
    degrees: float  # positive = left turn
    hazard: HazardSpec | None = None


Segment = StraightSeg | ArcSeg


def _walk_segments(
    segments: list[Segment], sample_step: float = SAMPLE_STEP
) -> tuple[list[tuple[float, float]], list[float], list[tuple[float, float, HazardSpec]]]:
    points: list[tuple[float, float]] = [(0.0, 0.0)]
    distances: list[float] = [0.0]
    x = y = heading = 0.0
    distance = 0.0
    hazard_ranges: list[tuple[float, float, HazardSpec]] = []

    for seg in segments:
        seg_start = distance
        if isinstance(seg, StraightSeg):
            n = max(1, round(seg.length / sample_step))
            step = seg.length / n
            for _ in range(n):
                x += math.cos(heading) * step
                y += math.sin(heading) * step
                distance += step
                points.append((x, y))
                distances.append(distance)
        else:
            arc_radians = math.radians(seg.degrees)
            arc_length = abs(arc_radians) * seg.radius
            n = max(1, round(arc_length / sample_step))
            dtheta = arc_radians / n
            step = arc_length / n
            for _ in range(n):
                heading += dtheta
                x += math.cos(heading) * step
                y += math.sin(heading) * step
                distance += step
                points.append((x, y))
                distances.append(distance)
        if seg.hazard:
            hazard_ranges.append((seg_start, distance, seg.hazard))

    # Close the loop with a straight back to the start point, regardless of
    # final heading — guarantees exact position closure for a low-poly demo.
    dx, dy = -x, -y
    closing_length = math.hypot(dx, dy)
    if closing_length > 0.01:
        close_heading = math.atan2(dy, dx)
        n = max(1, round(closing_length / sample_step))
        step = closing_length / n
        for _ in range(n):
            x += math.cos(close_heading) * step
            y += math.sin(close_heading) * step
            distance += step
            points.append((x, y))
            distances.append(distance)

    points[-1] = (0.0, 0.0)
    distances[-1] = distance
    return points, distances, hazard_ranges


def _build_edges(
    centerline: list[tuple[float, float]],
    distances: list[float],
    base_width: float,
    narrow_ranges: list[tuple[float, float]],
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    left_edge: list[tuple[float, float]] = []
    right_edge: list[tuple[float, float]] = []
    n = len(centerline)
    for i, (px, py) in enumerate(centerline):
        nxt = centerline[(i + 1) % n]
        prev = centerline[i - 1]
        dx, dy = nxt[0] - prev[0], nxt[1] - prev[1]
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length

        half_width = base_width / 2
        for start, end in narrow_ranges:
            if start <= distances[i] <= end:
                half_width *= 0.6
                break

        left_edge.append((px + nx * half_width, py + ny * half_width))
        right_edge.append((px - nx * half_width, py - ny * half_width))
    return left_edge, right_edge


def _build_profile(
    track_id: TrackId,
    name: str,
    seed: int,
    track_width: float,
    segments: list[Segment],
    sector_count: int = 3,
) -> tuple[TrackProfile, list[float]]:
    centerline, distances, hazard_ranges = _walk_segments(segments)
    total_length = distances[-1]

    narrow_ranges = [(s, e) for s, e, h in hazard_ranges if h.kind == "narrow"]
    left_edge, right_edge = _build_edges(centerline, distances, track_width, narrow_ranges)

    def position_at(dist: float) -> tuple[float, float]:
        idx = min(range(len(distances)), key=lambda i: abs(distances[i] - dist))
        return centerline[idx]

    hazard_zones = [
        HazardZone(
            id=h.id,
            kind=h.kind,
            label=h.label,
            start_distance=start,
            end_distance=end,
            position=position_at(start),
        )
        for start, end, h in hazard_ranges
    ]

    sector_length = total_length / sector_count
    sectors = [
        Sector(
            index=i,
            name=f"Sector {i + 1}",
            start_distance=i * sector_length,
            end_distance=(i + 1) * sector_length,
            start_position=position_at(i * sector_length),
        )
        for i in range(sector_count)
    ]

    profile = TrackProfile(
        id=track_id,
        name=name,
        seed=seed,
        track_width=track_width,
        total_length=total_length,
        start_finish=(0.0, 0.0),
        centerline=centerline,
        left_edge=left_edge,
        right_edge=right_edge,
        sectors=sectors,
        hazard_zones=hazard_zones,
    )
    return profile, distances


def _monza_segments() -> list[Segment]:
    return [
        StraightSeg(300),
        ArcSeg(18, -35, HazardSpec("t1_chicane", "chicane", "Turn 1-2 chicane")),
        ArcSeg(18, 35),
        StraightSeg(150),
        ArcSeg(60, 40, HazardSpec("lesmo", "sweeper", "Lesmo sweeper")),
        StraightSeg(200),
        ArcSeg(16, -45, HazardSpec("roggia_chicane", "chicane", "Variante della Roggia")),
        ArcSeg(16, 45),
        StraightSeg(350),
        ArcSeg(20, 100, HazardSpec("ascari", "braking_zone", "Ascari chicane braking zone")),
        StraightSeg(180),
        ArcSeg(70, 130, HazardSpec("parabolica", "sweeper", "Parabolica")),
    ]


def _baku_segments() -> list[Segment]:
    return [
        StraightSeg(250),
        ArcSeg(12, 90, HazardSpec("turn1", "braking_zone", "Turn 1 heavy braking")),
        StraightSeg(80),
        ArcSeg(10, -90, HazardSpec("turn2", "braking_zone", "Turn 2")),
        StraightSeg(40, HazardSpec("narrow_section", "narrow", "Castle section narrows")),
        ArcSeg(8, 80, HazardSpec("narrow_corner", "narrow", "Narrow street corner")),
        StraightSeg(500),
        ArcSeg(14, 100, HazardSpec("turn16", "braking_zone", "Turn 16 heavy braking")),
        StraightSeg(150),
        ArcSeg(20, 80, HazardSpec("final_sweep", "sweeper", "Final sweeper")),
    ]


def _build_presets() -> dict[TrackId, tuple[TrackProfile, list[float]]]:
    return {
        "monza": _build_profile("monza", "Monza (simplified)", seed=1, track_width=14, segments=_monza_segments()),
        "baku": _build_profile("baku", "Azerbaijan/Baku (simplified)", seed=1, track_width=9, segments=_baku_segments()),
    }


_PRESETS = _build_presets()
TRACK_PRESETS: dict[TrackId, TrackProfile] = {tid: profile for tid, (profile, _) in _PRESETS.items()}
TRACK_DISTANCES: dict[TrackId, list[float]] = {tid: dists for tid, (_, dists) in _PRESETS.items()}


def nearest_index(x: float, y: float, centerline: list[tuple[float, float]]) -> int:
    return min(range(len(centerline)), key=lambda i: math.hypot(x - centerline[i][0], y - centerline[i][1]))


def signed_clearance(x: float, y: float, profile: TrackProfile) -> float:
    """Distance from (x, y) to the track edge, via the nearest sampled
    centerline point: positive means still within the corridor, negative
    means off track. A crude linear scan — not the real nearest-centerline
    projection Person A's module will do."""
    idx = nearest_index(x, y, profile.centerline)
    px, py = profile.centerline[idx]
    nearest_distance = math.hypot(x - px, y - py)
    return profile.track_width / 2 - nearest_distance


def sector_at(distance_along_lap: float, profile: TrackProfile) -> Sector:
    d = distance_along_lap % profile.total_length
    for sector in profile.sectors:
        if sector.start_distance <= d < sector.end_distance:
            return sector
    return profile.sectors[-1]


def next_hazard_zone(distance_along_lap: float, profile: TrackProfile) -> HazardZone | None:
    if not profile.hazard_zones:
        return None
    d = distance_along_lap % profile.total_length

    def ahead(hz: HazardZone) -> float:
        return (hz.start_distance - d) % profile.total_length

    return min(profile.hazard_zones, key=ahead)


def distance_to_hazard(distance_along_lap: float, hazard: HazardZone, profile: TrackProfile) -> float:
    d = distance_along_lap % profile.total_length
    return (hazard.start_distance - d) % profile.total_length


WARNING_DISTANCE = 40.0  # meters, demo-only threshold


def warning_reason(distance_along_lap: float, profile: TrackProfile) -> str | None:
    hazard = next_hazard_zone(distance_along_lap, profile)
    if hazard is None:
        return None
    ahead = distance_to_hazard(distance_along_lap, hazard, profile)
    if ahead < WARNING_DISTANCE:
        return f"Approaching {hazard.label} in {ahead:.0f}m"
    return None


MAX_SPEED = 40.0
ACCEL = 8.0
BRAKE_DECEL = 14.0
DRAG = 2.0
# Bicycle-model-ish: yaw rate = steering * curvature * speed, so the turn
# radius at full steering (1 / MAX_CURVATURE) is speed-independent — a
# tight corner stays achievable at any speed, not just low speed.
MAX_CURVATURE = 0.1  # 1 / min turn radius (10m), tighter than either preset's tightest corner


@dataclass
class DemoVehicleState:
    x: float = 0.0
    y: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    seq: int = 0
    nearest_point_index: int = 0
    distance_along_lap: float = 0.0
    track_exit: bool = False
    lap_complete: bool = False


def step(
    state: DemoVehicleState,
    steering: float,
    throttle: float,
    brake: float,
    dt: float,
    profile: TrackProfile,
) -> DemoVehicleState:
    if state.lap_complete or state.track_exit:
        return state

    accel = throttle * ACCEL - brake * BRAKE_DECEL - DRAG * (state.speed / MAX_SPEED)
    speed = max(0.0, min(MAX_SPEED, state.speed + accel * dt))
    yaw_rate = steering * MAX_CURVATURE * speed
    heading = state.heading + yaw_rate * dt
    x = state.x + math.cos(heading) * speed * dt
    y = state.y + math.sin(heading) * speed * dt

    clearance = signed_clearance(x, y, profile)
    track_exit = clearance < 0

    idx = nearest_index(x, y, profile.centerline)
    n = len(profile.centerline)
    delta_idx = idx - state.nearest_point_index
    if delta_idx < -n // 2:
        delta_idx += n
    elif delta_idx > n // 2:
        delta_idx -= n
    distance_along_lap = state.distance_along_lap + delta_idx * SAMPLE_STEP

    lap_complete = not track_exit and distance_along_lap >= profile.total_length

    return DemoVehicleState(
        x=x,
        y=y,
        heading=heading,
        speed=speed,
        seq=state.seq + 1,
        nearest_point_index=idx,
        distance_along_lap=distance_along_lap,
        track_exit=track_exit,
        lap_complete=lap_complete,
    )
