"""Bounded scenario parameter space shared by data generation and scenario search.

Every search strategy (random, TPE, SAC) samples from these same bounds so
comparisons between them are fair. A point in the space is a vector in
[0, 1]^d plus a track name; ``to_scenario`` maps it to a validated Scenario.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.schemas import Scenario, TrackName
from app.sim.track import PROFILES

TRACKS: tuple[TrackName, ...] = ("monza", "baku")


@dataclass(frozen=True)
class ParamBound:
    name: str
    low: float
    high: float


# Track-independent bounds. entry_speed comes from the track profile.
DEFAULT_BOUNDS: tuple[ParamBound, ...] = (
    ParamBound("actual_grip", 0.6, 1.1),
    ParamBound("grip_error", -0.1, 0.12),  # estimated_grip - actual_grip
    ParamBound("telemetry_delay_ms", 0.0, 250.0),
    ParamBound("sensor_noise", 0.0, 1.0),
    ParamBound("packet_loss", 0.0, 0.25),
    ParamBound("driver_reaction_delay", 0.1, 0.5),
    ParamBound("warning_margin", 0.0, 0.5),
    ParamBound("brake_effectiveness", 0.65, 1.0),
)

PARAM_NAMES: tuple[str, ...] = ("entry_speed",) + tuple(b.name for b in DEFAULT_BOUNDS)
DIM = len(PARAM_NAMES)


@dataclass(frozen=True)
class ScenarioSpace:
    bounds: tuple[ParamBound, ...] = DEFAULT_BOUNDS
    tracks: tuple[TrackName, ...] = TRACKS

    def track_bounds(self, track: TrackName) -> list[ParamBound]:
        p = PROFILES[track]
        return [ParamBound("entry_speed", *p.entry_speed_range), *self.bounds]

    def to_scenario(self, track: TrackName, unit: np.ndarray, scenario_id: str, seed: int) -> Scenario:
        """Map a point in [0,1]^DIM to a Scenario. Values are clipped into bounds."""
        u = np.clip(np.asarray(unit, dtype=float), 0.0, 1.0)
        vals = {b.name: b.low + float(x) * (b.high - b.low) for b, x in zip(self.track_bounds(track), u)}
        grip_error = vals.pop("grip_error")
        vals["estimated_grip"] = float(np.clip(vals["actual_grip"] + grip_error, 0.3, 1.3))
        return Scenario(scenario_id=scenario_id, seed=seed, track=track, **vals)

    def to_unit(self, scenario: Scenario) -> np.ndarray:
        """Inverse of ``to_scenario`` (used for diversity distances)."""
        vals = scenario.model_dump()
        vals["grip_error"] = scenario.estimated_grip - scenario.actual_grip
        out = []
        for b in self.track_bounds(scenario.track):
            span = b.high - b.low
            out.append(0.0 if span == 0 else (vals[b.name] - b.low) / span)
        return np.clip(np.array(out), 0.0, 1.0)

    def sample(self, rng: np.random.Generator, n: int, prefix: str = "rand") -> list[Scenario]:
        out = []
        for i in range(n):
            track = self.tracks[int(rng.integers(len(self.tracks)))]
            seed = int(rng.integers(0, 2**31 - 1))
            out.append(self.to_scenario(track, rng.random(DIM), f"{prefix}-{i:05d}", seed))
        return out


def failure_signature(s: Scenario, failure_corner: str | None = None) -> tuple:
    """Coarse description of where the car failed and which stress factors were active.

    Used to count *distinct* failure conditions: two failures at the same
    corner with the same active factors are treated as the same weakness.
    """
    return (
        s.track,
        failure_corner,
        s.estimated_grip - s.actual_grip > 0.1,
        s.telemetry_delay_ms >= 150,
        s.packet_loss >= 0.2,
        s.sensor_noise >= 0.5,
        s.driver_reaction_delay >= 0.6,
        s.brake_effectiveness < 0.7,
    )
