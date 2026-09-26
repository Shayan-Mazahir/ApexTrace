"""Lightweight deterministic vehicle model.

A kinematic point mass with a friction-circle grip limit:

* longitudinal: drive force (traction/power limited), brakes scaled by
  brake_effectiveness, aero drag;
* lateral: steering commands a path curvature; the achieved curvature is
  capped by whatever friction remains after longitudinal demand. Asking for
  more than the tyres can give makes the car run wide (understeer), which is
  how a too-fast corner entry turns into leaving the track.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, replace

from app.sim import constants as C


@dataclass(frozen=True)
class ControlInput:
    steering: float = 0.0  # -1..1, + = left
    throttle: float = 0.0  # 0..1
    brake: float = 0.0  # 0..1

    def clipped(self) -> "ControlInput":
        return ControlInput(
            steering=max(-1.0, min(1.0, self.steering)),
            throttle=max(0.0, min(1.0, self.throttle)),
            brake=max(0.0, min(1.0, self.brake)),
        )


@dataclass(frozen=True)
class VehicleKinematics:
    x: float
    y: float
    heading: float
    speed: float
    acceleration: float = 0.0
    lateral_acceleration: float = 0.0
    grip_usage: float = 0.0


@dataclass(frozen=True)
class VehicleParams:
    grip: float  # actual grip (ground truth)
    brake_effectiveness: float = 1.0


def step(state: VehicleKinematics, control: ControlInput, params: VehicleParams, dt: float) -> VehicleKinematics:
    """Advance the vehicle by ``dt`` seconds. Pure function: same inputs -> same output."""
    u = control.clipped()
    v = state.speed
    a_max = params.grip * C.GRIP_ACCEL

    # Longitudinal tyre demand (drag is aero, not tyre force).
    drive = u.throttle * min(C.MAX_TRACTION_ACCEL, C.POWER_COEFF / max(v, 1.0))
    braking = u.brake * params.brake_effectiveness * a_max
    tyre_long = min(drive - braking, a_max) if drive >= braking else max(drive - braking, -a_max)

    # Lateral: whatever friction is left after longitudinal demand.
    lat_available = math.sqrt(max(0.0, a_max**2 - tyre_long**2))
    k_cmd = u.steering * C.MAX_STEER_CURVATURE
    v_eff = max(v, C.MIN_SPEED_FOR_CURVATURE)
    lat_demand = v_eff**2 * k_cmd
    if abs(lat_demand) > lat_available:
        k_actual = math.copysign(lat_available / v_eff**2, k_cmd)
    else:
        k_actual = k_cmd
    lat_actual = v_eff**2 * k_actual

    total_demand = math.hypot(tyre_long, lat_demand)
    grip_usage = total_demand / a_max if a_max > 0 else 0.0

    accel = tyre_long - C.DRAG_COEFF * v * v
    new_v = max(0.0, v + accel * dt)
    mean_v = 0.5 * (v + new_v)
    new_heading = state.heading + mean_v * k_actual * dt
    mid_heading = 0.5 * (state.heading + new_heading)
    return replace(
        state,
        x=state.x + mean_v * math.cos(mid_heading) * dt,
        y=state.y + mean_v * math.sin(mid_heading) * dt,
        heading=new_heading,
        speed=new_v,
        acceleration=accel if new_v > 0 or accel > 0 else 0.0,
        lateral_acceleration=lat_actual,
        grip_usage=grip_usage,
    )


def max_corner_speed(grip: float, curvature: float, factor: float = 1.0) -> float:
    """Highest steady speed on a constant-curvature path with the given grip."""
    return math.sqrt(factor * grip * C.GRIP_ACCEL / abs(curvature))


def braking_distance(v_from: float, v_to: float, decel: float) -> float:
    if v_from <= v_to:
        return 0.0
    return (v_from**2 - v_to**2) / (2.0 * decel)
