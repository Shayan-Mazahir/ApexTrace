"""The prototype corner-entry warning system under test.

It warns the driver when the car approaches a corner faster than the
*estimated* grip allows. It only sees what a real system would: measured
(possibly delayed, noisy) speed and position, the estimated grip, and the
track map. It never sees actual grip or actual brake condition, and it does
not compensate for telemetry age. Those blind spots are deliberate: they are
what the stress tests are meant to expose.
"""

from __future__ import annotations

from dataclasses import dataclass

from app.schemas import WarningLevel
from app.sim import constants as C
from app.sim.track import Corner, Track
from app.sim.vehicle import braking_distance, max_corner_speed


@dataclass(frozen=True)
class Measurement:
    """What the safety system knows about the car at one instant."""

    speed: float
    s: float
    sent_at: float  # simulator time the measurement was taken


@dataclass(frozen=True)
class WarningOutput:
    level: WarningLevel
    advised_speed: float | None
    distance_to_corner: float | None
    required_distance: float | None
    corner: str | None = None  # corner the warning refers to


SAFE_OUTPUT = WarningOutput(WarningLevel.SAFE, None, None, None)
_RANK = {WarningLevel.SAFE: 0, WarningLevel.CAUTION: 1, WarningLevel.BRAKE_NOW: 2}


@dataclass(frozen=True)
class WarningSystem:
    estimated_grip: float
    warning_margin: float
    assumed_brake_effectiveness: float = C.WARNING_ASSUMED_BRAKE_EFFECTIVENESS
    assumed_reaction: float = C.WARNING_ASSUMED_REACTION

    def advised_speed(self, curvature: float) -> float:
        return max_corner_speed(self.estimated_grip, curvature, C.WARNING_LATERAL_FACTOR)

    def assumed_decel(self) -> float:
        return self.estimated_grip * C.GRIP_ACCEL * C.WARNING_BRAKE_FACTOR * self.assumed_brake_effectiveness

    def required_distance(self, speed: float, v_target: float) -> float:
        """Distance the system believes is needed: reaction travel + braking, scaled by the margin."""
        d = speed * self.assumed_reaction + braking_distance(speed, v_target, self.assumed_decel())
        return d * (1.0 + self.warning_margin)

    def evaluate_corner(self, speed: float, corner: Corner, dist: float) -> WarningOutput:
        v_adv = self.advised_speed(corner.curvature)
        if speed <= v_adv + C.SAFE_SPEED_TOLERANCE:
            return WarningOutput(WarningLevel.SAFE, v_adv, dist, 0.0, corner.name)
        need = self.required_distance(speed, v_adv)
        if dist <= need:  # includes being inside the corner (dist < 0) while too fast
            level = WarningLevel.BRAKE_NOW
        elif dist <= need * C.CAUTION_DISTANCE_FACTOR + C.CAUTION_DISTANCE_EXTRA:
            level = WarningLevel.CAUTION
        else:
            level = WarningLevel.SAFE
        return WarningOutput(level, v_adv, dist, need, corner.name)

    def evaluate(self, m: Measurement | None, track: Track) -> WarningOutput:
        """Check the current corner and every corner starting within the lookahead; report the most urgent.

        Ties go to the corner with the lower advised speed (e.g. the tighter
        half of a chicane), so the driver brakes for both at once.
        """
        if m is None:  # nothing received yet
            return SAFE_OUTPUT
        best: WarningOutput | None = None
        for corner, dist in track.corners_ahead(m.s, C.WARNING_LOOKAHEAD):
            out = self.evaluate_corner(m.speed, corner, dist)
            if best is None or _RANK[out.level] > _RANK[best.level] or (
                _RANK[out.level] == _RANK[best.level] and out.level is not WarningLevel.SAFE
                and out.advised_speed < best.advised_speed
            ):
                best = out
        return best or SAFE_OUTPUT
