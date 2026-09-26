"""
TEMPORARY stand-in for backend/sim/* (Person A's ownership: track geometry
and vehicle physics — project task list sections B and C). Exists only so
sessions, WebSockets, and frontend rendering can be wired up and tested
before the real simulator lands. Nothing here is meant to survive that:
once backend/sim/track.py and backend/sim/core.py exist, replace the
imports in sessions.py and delete this file.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from app.schemas import TrackId, TrackProfile

SAMPLE_STEP = 4.0  # meters between sampled centerline points, demo only


def _build_profile(
    track_id: TrackId,
    name: str,
    approach_length: float,
    corner_radius: float,
    corner_arc_degrees: float,
    exit_length: float,
    track_width: float,
) -> TrackProfile:
    centerline: list[tuple[float, float]] = [(0.0, 0.0)]

    n_approach = max(1, round(approach_length / SAMPLE_STEP))
    for i in range(1, n_approach + 1):
        centerline.append((i * approach_length / n_approach, 0.0))

    arc_radians = math.radians(corner_arc_degrees)
    arc_length = arc_radians * corner_radius
    n_arc = max(1, round(arc_length / SAMPLE_STEP))
    turn_center_x, turn_center_y = centerline[-1][0], corner_radius
    for i in range(1, n_arc + 1):
        theta = (i / n_arc) * arc_radians
        centerline.append(
            (
                turn_center_x + math.sin(theta) * corner_radius,
                turn_center_y - math.cos(theta) * corner_radius,
            )
        )

    exit_heading = arc_radians
    exit_start_x, exit_start_y = centerline[-1]
    n_exit = max(1, round(exit_length / SAMPLE_STEP))
    for i in range(1, n_exit + 1):
        d = i * exit_length / n_exit
        centerline.append(
            (
                exit_start_x + math.cos(exit_heading) * d,
                exit_start_y + math.sin(exit_heading) * d,
            )
        )

    half_width = track_width / 2
    left_edge: list[tuple[float, float]] = []
    right_edge: list[tuple[float, float]] = []
    for i, (px, py) in enumerate(centerline):
        if i == 0 and len(centerline) > 1:
            nxt = centerline[1]
            dx, dy = nxt[0] - px, nxt[1] - py
        else:
            prev = centerline[i - 1]
            dx, dy = px - prev[0], py - prev[1]
        length = math.hypot(dx, dy) or 1.0
        nx, ny = -dy / length, dx / length
        left_edge.append((px + nx * half_width, py + ny * half_width))
        right_edge.append((px - nx * half_width, py - ny * half_width))

    return TrackProfile(
        id=track_id,
        name=name,
        approach_length=approach_length,
        corner_radius=corner_radius,
        corner_arc_degrees=corner_arc_degrees,
        exit_length=exit_length,
        track_width=track_width,
        centerline=centerline,
        left_edge=left_edge,
        right_edge=right_edge,
    )


TRACK_PRESETS: dict[TrackId, TrackProfile] = {
    "monza": _build_profile(
        "monza",
        "Monza/T1 (simplified)",
        approach_length=180,
        corner_radius=30,
        corner_arc_degrees=80,
        exit_length=80,
        track_width=12,
    ),
    "baku": _build_profile(
        "baku",
        "Azerbaijan/Baku (simplified)",
        approach_length=90,
        corner_radius=14,
        corner_arc_degrees=100,
        exit_length=60,
        track_width=9,
    ),
}


def nearest_clearance(x: float, y: float, profile: TrackProfile) -> float:
    """Distance from (x, y) to the track edge, via the nearest sampled
    centerline point: positive means still within the corridor, negative
    means off track. A crude linear scan — not the real nearest-centerline
    projection Person A's module will do."""
    nearest_distance = min(math.hypot(x - px, y - py) for px, py in profile.centerline)
    return profile.track_width / 2 - nearest_distance


MAX_SPEED = 40.0
ACCEL = 8.0
BRAKE_DECEL = 14.0
DRAG = 2.0
# Bicycle-model-ish: yaw rate = steering * curvature * speed, so the turn
# radius at full steering (1 / MAX_CURVATURE) is speed-independent — a
# tight corner stays achievable at any speed, not just low speed.
MAX_CURVATURE = 0.1  # 1 / min turn radius (10m), tighter than either preset's corner
FINISH_RADIUS = 6.0


@dataclass
class DemoVehicleState:
    x: float = 0.0
    y: float = 0.0
    heading: float = 0.0
    speed: float = 0.0
    seq: int = 0
    completed: bool = False
    track_exit: bool = False


def step(
    state: DemoVehicleState,
    steering: float,
    throttle: float,
    brake: float,
    dt: float,
    profile: TrackProfile,
) -> DemoVehicleState:
    if state.completed or state.track_exit:
        return state

    accel = throttle * ACCEL - brake * BRAKE_DECEL - DRAG * (state.speed / MAX_SPEED)
    speed = max(0.0, min(MAX_SPEED, state.speed + accel * dt))
    yaw_rate = steering * MAX_CURVATURE * speed
    heading = state.heading + yaw_rate * dt
    x = state.x + math.cos(heading) * speed * dt
    y = state.y + math.sin(heading) * speed * dt

    track_exit = nearest_clearance(x, y, profile) < 0
    finish_x, finish_y = profile.centerline[-1]
    completed = not track_exit and math.hypot(x - finish_x, y - finish_y) < FINISH_RADIUS

    return DemoVehicleState(
        x=x,
        y=y,
        heading=heading,
        speed=speed,
        seq=state.seq + 1,
        completed=completed,
        track_exit=track_exit,
    )
