"""Deterministic scripted driver used for automated tests and data generation.

Behaviour (a test fixture, not a model of a human driver):

1. Holds the scenario entry speed on the approach.
2. Treats CAUTION as advisory only (no action), so the braking point is
   set purely by BRAKE_NOW.
3. When it perceives BRAKE_NOW, commits to braking down to the system's
   advised corner speed, then holds that speed through the corner.
4. Perception lags the displayed warning by ``reaction_delay``.
5. Steers along the centerline with a gain-scheduled path-following law.
6. Accelerates out of the corner.

It relies on the warning system for its braking point on purpose: that way a
wrong or late warning shows up as a simulator failure.
"""

from __future__ import annotations

import math
from collections import deque
from dataclasses import dataclass

from app.schemas import WarningLevel
from app.sim import constants as C
from app.sim.safety import SAFE_OUTPUT, WarningOutput
from app.sim.track import Track, TrackLocation
from app.sim.vehicle import ControlInput, VehicleKinematics


@dataclass(frozen=True)
class DriverParams:
    reaction_delay: float = 0.3
    # Lateral loop: natural frequency (rad/s) and damping ratio of the path-error dynamics.
    steering_bandwidth: float = 2.0
    steering_damping: float = 0.8
    max_brake: float = 1.0
    speed_gain: float = 0.5  # throttle per m/s of speed error


def _wrap(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


class ScriptedDriver:
    def __init__(self, entry_speed: float, params: DriverParams):
        self.params = params
        self.target_speed = entry_speed
        self.committed = False
        self._seen: deque[tuple[float, WarningOutput]] = deque()
        self._perceived: WarningOutput = SAFE_OUTPUT

    def observe(self, t: float, warning: WarningOutput) -> None:
        self._seen.append((t, warning))
        cutoff = t - self.params.reaction_delay + 1e-9
        while self._seen and self._seen[0][0] <= cutoff:
            self._perceived = self._seen.popleft()[1]

    @property
    def perceived(self) -> WarningOutput:
        return self._perceived

    def steering(self, kin: VehicleKinematics, loc: TrackLocation) -> float:
        """Path following: k = k_track - (w^2/v^2) d - (2*zeta*w/v) psi.

        With d' = v*psi and psi' = v*(k - k_track) this gives lateral error
        dynamics d'' + 2*zeta*w*d' + w^2*d = 0 at every speed.
        """
        v = max(kin.speed, 5.0)
        w, z = self.params.steering_bandwidth, self.params.steering_damping
        psi = _wrap(kin.heading - loc.heading)
        k = loc.curvature - (w * w / (v * v)) * loc.lateral_offset - (2 * z * w / v) * psi
        return max(-1.0, min(1.0, k / C.MAX_STEER_CURVATURE))

    def _hold(self, v: float, target: float) -> tuple[float, float]:
        drive_cap = min(C.MAX_TRACTION_ACCEL, C.POWER_COEFF / max(v, 1.0))
        ff = C.DRAG_COEFF * v * v / drive_cap
        u = ff + self.params.speed_gain * (target - v)
        if u >= 0:
            return min(1.0, u), 0.0
        return 0.0, min(self.params.max_brake, -u * 0.2)

    def control(self, kin: VehicleKinematics, loc: TrackLocation, track: Track) -> ControlInput:
        steer = self.steering(kin, loc)
        p = self._perceived
        if p.level is WarningLevel.BRAKE_NOW and p.advised_speed is not None:
            self.committed = True
            self.target_speed = min(self.target_speed, p.advised_speed)

        if track.next_corner(loc.s) is None:  # past the last corner: accelerate away
            return ControlInput(steer, 1.0, 0.0)
        v = kin.speed
        if self.committed and v > self.target_speed + 0.3:
            return ControlInput(steer, 0.0, self.params.max_brake)
        throttle, brake = self._hold(v, self.target_speed)
        return ControlInput(steer, throttle, brake)
