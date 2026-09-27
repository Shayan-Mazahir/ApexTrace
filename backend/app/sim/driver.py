"""Deterministic scripted driver used for automated tests and data generation.

Behaviour over a lap (a test fixture, not a model of a human driver):

1. Full throttle on straights.
2. Treats CAUTION as advisory only (no action), so braking points are set
   purely by BRAKE_NOW.
3. When it perceives BRAKE_NOW for a corner, it commits to braking down to
   the system's advised speed for that corner and holds it through the corner.
4. In a corner it got no warning for, it holds its entry speed. Corners that
   start within ``LINK_DISTANCE`` of the previous exit (chicanes) are taken as
   one complex: the speed carries over instead of accelerating in between.
5. Perception lags the displayed warning by ``reaction_delay``.
   While cornering it only brakes as hard as the tyres allow on top of the
   cornering load (trail braking by feel), using the car's actual grip and
   brake response, which a driver senses through the car.
6. Steers along the centerline with a gain-scheduled path-following law.

It relies on the warning system for its braking points on purpose: that way a
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
from app.sim.vehicle import ControlInput, VehicleKinematics, VehicleParams


@dataclass(frozen=True)
class DriverParams:
    reaction_delay: float = 0.3
    # Lateral loop: natural frequency (rad/s) and damping ratio of the path-error dynamics.
    steering_bandwidth: float = 2.0
    steering_damping: float = 0.8
    max_brake: float = 1.0
    speed_gain: float = 0.5  # throttle per m/s of speed error
    corner_grip_budget: float = 0.95  # fraction of felt grip the driver uses when braking in a corner


LINK_DISTANCE = 60.0  # metres


def _wrap(a: float) -> float:
    return (a + math.pi) % (2 * math.pi) - math.pi


class ScriptedDriver:
    def __init__(self, entry_speed: float, params: DriverParams, feel: VehicleParams | None = None):
        self.params = params
        self.feel = feel or VehicleParams(grip=1.0)
        self.entry_speed = entry_speed
        self.targets: dict[str, float] = {}  # corner name -> speed to hold until it is exited
        self.exited: set[str] = set()
        self._in_corner: str | None = None
        self._seen: deque[tuple[float, WarningOutput]] = deque()
        self._perceived: WarningOutput = SAFE_OUTPUT

    @property
    def committed(self) -> bool:
        return bool(self.targets)

    @property
    def target_speed(self) -> float | None:
        return min(self.targets.values()) if self.targets else None

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

    def _brake_limit(self, v: float, loc: TrackLocation) -> float:
        """Brake pedal that keeps braking + cornering load inside the felt friction circle."""
        a_max = self.feel.grip * C.GRIP_ACCEL
        if loc.curvature == 0.0:
            return self.params.max_brake
        lat = v * v * abs(loc.curvature)
        room = math.sqrt(max(0.0, (self.params.corner_grip_budget * a_max) ** 2 - lat * lat))
        return min(self.params.max_brake, room / max(1e-6, self.feel.brake_effectiveness * a_max))

    def _update_corner(self, v: float, loc: TrackLocation, track: Track) -> None:
        corner = track.get_current_corner(loc.s)
        name = corner.name if corner else None
        if name != self._in_corner:
            if self._in_corner is not None:  # just left a corner
                self.exited.add(self._in_corner)
                held = self.targets.pop(self._in_corner, None)
                nxt = track.next_corner(loc.s)
                if (held is not None and nxt.name not in self.exited
                        and track.distance_ahead(loc.s, nxt.s_entry) <= LINK_DISTANCE):
                    self.targets[nxt.name] = min(self.targets.get(nxt.name, math.inf), held)
            if name is not None and name not in self.targets:
                self.targets[name] = v  # no warning for this corner: hold entry speed
            self._in_corner = name

    def control(self, kin: VehicleKinematics, loc: TrackLocation, track: Track) -> ControlInput:
        steer = self.steering(kin, loc)
        v = kin.speed
        self._update_corner(v, loc, track)
        p = self._perceived
        if (p.level is WarningLevel.BRAKE_NOW and p.advised_speed is not None
                and p.corner is not None and p.corner not in self.exited):
            self.targets[p.corner] = min(self.targets.get(p.corner, math.inf), p.advised_speed)

        target = self.target_speed
        if target is None:
            return ControlInput(steer, 1.0, 0.0)
        if v > target + 0.3:
            return ControlInput(steer, 0.0, self._brake_limit(v, loc))
        throttle, brake = self._hold(v, target)
        return ControlInput(steer, throttle, brake)
