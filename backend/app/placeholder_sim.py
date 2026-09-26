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

MAX_SPEED = 40.0
ACCEL = 8.0
BRAKE_DECEL = 14.0
DRAG = 2.0
# Bicycle-model-ish: yaw rate = steering * curvature * speed. Curvature is
# capped by the steering lock (MAX_CURVATURE) and by grip: lateral accel
# v^2 * curvature can't exceed grip * G_LAT. So a corner has a real speed
# limit, and braking (or not) before it decides whether the car stays on.
MAX_CURVATURE = 0.1  # 1 / min turn radius (10m)
G_LAT = 30.0  # m/s^2 at grip 1.0 — toy value, includes "downforce"
NARROW_STRAIGHT_SPEED = 25.0  # advisory limit through narrow sections
FINISH_RADIUS = 6.0


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


CLOSING_RADIUS = 40.0


def _arc_end(
    x: float, y: float, heading: float, radius: float, degrees: float, sample_step: float
) -> tuple[float, float, float]:
    """Where the walker below ends up after an arc (same integration)."""
    arc_radians = math.radians(degrees)
    arc_length = abs(arc_radians) * radius
    n = max(1, round(arc_length / sample_step))
    step = arc_length / n
    for _ in range(n):
        heading += arc_radians / n
        x += math.cos(heading) * step
        y += math.sin(heading) * step
    return x, y, heading


def _closing_turn_degrees(x: float, y: float, heading: float, sample_step: float) -> float:
    """Turn (at CLOSING_RADIUS) that leaves the car pointing at the start
    point, so the closing straight begins without a heading kink."""
    theta = 0.0
    for _ in range(40):
        ex, ey, eh = _arc_end(x, y, heading, CLOSING_RADIUS, math.degrees(theta), sample_step)
        wanted = math.atan2(-ey, -ex)
        new_theta = (wanted - heading + math.pi) % (2 * math.pi) - math.pi
        if abs(new_theta - theta) < 1e-6:
            break
        theta = new_theta
    return math.degrees(theta)


def _walk_segments(
    segments: list[Segment], sample_step: float = SAMPLE_STEP
) -> tuple[list[tuple[float, float]], list[float], list[tuple[float, float, HazardSpec, float]]]:
    points: list[tuple[float, float]] = [(0.0, 0.0)]
    distances: list[float] = [0.0]
    x = y = heading = 0.0
    distance = 0.0
    hazard_ranges: list[tuple[float, float, HazardSpec, float]] = []

    def emit(seg: Segment) -> None:
        nonlocal x, y, heading, distance
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
            if isinstance(seg, ArcSeg):
                corner_speed = min(MAX_SPEED, math.sqrt(G_LAT * seg.radius))
            else:
                corner_speed = NARROW_STRAIGHT_SPEED
            hazard_ranges.append((seg_start, distance, seg.hazard, corner_speed))

    for seg in segments:
        emit(seg)

    # Close the loop: a solved turn that points the car at the start point
    # (tagged as a hazard, since it is a real corner), then a straight home.
    closing_degrees = _closing_turn_degrees(x, y, heading, sample_step)
    if abs(closing_degrees) > 1.0:
        emit(
            ArcSeg(
                CLOSING_RADIUS,
                closing_degrees,
                HazardSpec("final_corner", "sweeper", "Final corner"),
            )
        )

    closing_length = math.hypot(x, y)
    if closing_length > 0.01:
        close_heading = math.atan2(-y, -x)
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

    narrow_ranges = [(s, e) for s, e, h, _ in hazard_ranges if h.kind == "narrow"]
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
            corner_speed=corner_speed,
        )
        for start, end, h, corner_speed in hazard_ranges
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


def nearest_index(
    x: float,
    y: float,
    centerline: list[tuple[float, float]],
    hint: int | None = None,
    window: int = 30,
) -> int:
    """Nearest sampled centerline point. With a hint (last tick's index) only
    a window around it is searched — the car moves a few meters per tick — and
    ties prefer the hint so the duplicated start/finish point can't flip the
    index across the seam. Falls back to a full scan if the car is far away."""
    n = len(centerline)
    if hint is not None:
        best_i, best_key = hint % n, None
        for offset in range(-window, window + 1):
            i = (hint + offset) % n
            d = math.hypot(x - centerline[i][0], y - centerline[i][1])
            key = (d, abs(offset))
            if best_key is None or key < best_key:
                best_i, best_key = i, key
        if best_key is not None and best_key[0] < 40.0:
            return best_i
    return min(range(n), key=lambda i: math.hypot(x - centerline[i][0], y - centerline[i][1]))


def _distance_to_segment(px: float, py: float, a: tuple[float, float], b: tuple[float, float]) -> float:
    abx, aby = b[0] - a[0], b[1] - a[1]
    length_sq = abx * abx + aby * aby
    if length_sq == 0:
        return math.hypot(px - a[0], py - a[1])
    t = max(0.0, min(1.0, ((px - a[0]) * abx + (py - a[1]) * aby) / length_sq))
    return math.hypot(px - (a[0] + t * abx), py - (a[1] + t * aby))


def _clearance_at_index(x: float, y: float, idx: int, profile: TrackProfile) -> float:
    """Half the track width minus the distance to the centerline *polyline*
    (the two segments touching the nearest sample), not just the nearest
    sample point — sample spacing is as large as the clearances we report."""
    line = profile.centerline
    n = len(line)
    here = line[idx]
    distance = min(
        _distance_to_segment(x, y, line[(idx - 1) % n], here),
        _distance_to_segment(x, y, here, line[(idx + 1) % n]),
    )
    return profile.track_width / 2 - distance


def signed_clearance(x: float, y: float, profile: TrackProfile, hint: int | None = None) -> float:
    """Distance from (x, y) to the track edge, via the nearest sampled
    centerline point: positive means still within the corridor, negative
    means off track. Crude — not the real projection Person A's module will do."""
    return _clearance_at_index(x, y, nearest_index(x, y, profile.centerline, hint), profile)


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


NOMINAL_BRAKE_DECEL = BRAKE_DECEL  # the warning assumes healthy brakes
# Baseline warning padding. Calibrated once on the *unupgraded* baseline only:
# the most generous padding at which the baseline still fails some suite test
# (with padding 8 m it passed everything, so the suite couldn't discriminate).
# It is a model assumption, not a measured figure.
REACTION_ALLOWANCE_S = 0.35
WARNING_MARGIN_M = 10.0
NEEDS_BRAKING_FACTOR = 1.0
GRIP_ESTIMATE_LAG_S = 1.0  # the grip estimate trails the true grip by this much


def advised_corner_speed(hazard: HazardZone, grip_estimate: float) -> float:
    """Corner speed the warning advises: sqrt(mu * g * r) from the *estimated*
    grip, which trails reality (see GRIP_ESTIMATE_LAG_S)."""
    return hazard.corner_speed * math.sqrt(max(grip_estimate, 0.05))


def required_warning_distance(speed: float, hazard: HazardZone, grip_estimate: float = 1.0) -> float:
    """Baseline warning rule: estimated braking distance to the corner speed,
    plus a reaction allowance and a margin. Uses nominal (not actual) brake
    performance — it cannot see wear."""
    target = advised_corner_speed(hazard, grip_estimate)
    braking = max(0.0, speed * speed - target**2) / (2 * NOMINAL_BRAKE_DECEL)
    return braking + speed * REACTION_ALLOWANCE_S + WARNING_MARGIN_M


def warning_hazard(
    distance_along_lap: float, profile: TrackProfile, speed: float, grip_estimate: float = 1.0
) -> HazardZone | None:
    """The hazard the BRAKE warning is about: the next one ahead, if the
    reported speed needs shedding and it is inside the required distance."""
    hazard = next_hazard_zone(distance_along_lap, profile)
    if hazard is None:
        return None
    if speed <= advised_corner_speed(hazard, grip_estimate) * NEEDS_BRAKING_FACTOR:
        return None
    if distance_to_hazard(distance_along_lap, hazard, profile) < required_warning_distance(
        speed, hazard, grip_estimate
    ):
        return hazard
    return None


def warning_reason(
    distance_along_lap: float, profile: TrackProfile, speed: float, grip_estimate: float = 1.0
) -> str | None:
    hazard = warning_hazard(distance_along_lap, profile, speed, grip_estimate)
    if hazard is None:
        return None
    ahead = distance_to_hazard(distance_along_lap, hazard, profile)
    return f"Approaching {hazard.label} in {ahead:.0f}m"


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
    grip: float = 1.0,
    brake_wear: float = 1.0,
) -> DemoVehicleState:
    if state.lap_complete or state.track_exit:
        return state

    accel = throttle * ACCEL - brake * BRAKE_DECEL * brake_wear - DRAG * (state.speed / MAX_SPEED)
    speed = max(0.0, min(MAX_SPEED, state.speed + accel * dt))
    curvature = min(MAX_CURVATURE, grip * G_LAT / max(speed * speed, 1.0))
    yaw_rate = steering * curvature * speed
    heading = state.heading + yaw_rate * dt
    x = state.x + math.cos(heading) * speed * dt
    y = state.y + math.sin(heading) * speed * dt

    idx = nearest_index(x, y, profile.centerline, hint=state.nearest_point_index)
    track_exit = _clearance_at_index(x, y, idx, profile) < 0

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
