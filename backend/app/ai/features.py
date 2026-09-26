"""Turn a (partial) simulator run into model input.

The TCN sees the first ``PREFIX_SECONDS`` of a run, sampled at ``FEATURE_HZ``,
plus the scenario parameters as constant channels. It is asked whether the
run will end in a simulator failure. The prefix is a fraction of a full run,
which is what makes screening candidates cheaper than simulating them fully.
"""

from __future__ import annotations

import numpy as np

from app.schemas import ConfigurationName, Scenario, VehicleState, WarningLevel
from app.sim import constants as C
from app.sim.scenario_space import PARAM_NAMES, TRACKS, ScenarioSpace
from app.sim.simulator import Simulator

PREFIX_SECONDS = 2.0
FEATURE_HZ = 20.0
SEQ_LEN = int(round(PREFIX_SECONDS * FEATURE_HZ))
_STRIDE = int(round(1.0 / (FEATURE_HZ * C.DT)))
PREFIX_TICKS = SEQ_LEN * _STRIDE

_WARN = {WarningLevel.SAFE: 0.0, WarningLevel.CAUTION: 1.0, WarningLevel.BRAKE_NOW: 2.0}
AGE_CAP_MS = 1000.0

SEQUENCE_CHANNELS: tuple[str, ...] = (
    "speed",
    "distance_to_corner",
    "lateral_offset",
    "acceleration",
    "throttle",
    "brake",
    "steering",
    "warning_level",
    "advised_speed_gap",  # speed - advised_speed (0 if no advice yet)
    "measured_speed_error",  # measured - true speed (0 if nothing received)
    "telemetry_age_ms",
    "packet_dropped",
)
STATIC_CHANNELS: tuple[str, ...] = tuple(f"param_{n}" for n in PARAM_NAMES) + tuple(f"track_{t}" for t in TRACKS)
CHANNELS: tuple[str, ...] = SEQUENCE_CHANNELS + STATIC_CHANNELS

_SPACE = ScenarioSpace()


def frame_features(f: VehicleState, corner_entry: float) -> list[float]:
    return [
        f.speed,
        corner_entry - f.s,
        f.lateral_offset,
        f.acceleration,
        f.throttle,
        f.brake,
        f.steering,
        _WARN[f.warning],
        0.0 if f.advised_speed is None else f.speed - f.advised_speed,
        0.0 if f.measured_speed is None else f.measured_speed - f.speed,
        AGE_CAP_MS if f.telemetry_age_ms is None else min(f.telemetry_age_ms, AGE_CAP_MS),
        float(f.packet_dropped),
    ]


def static_features(scenario: Scenario) -> list[float]:
    return list(_SPACE.to_unit(scenario)) + [float(scenario.track == t) for t in TRACKS]


def features_from_frames(frames: list[VehicleState], scenario: Scenario, corner_entry: float) -> np.ndarray:
    """(SEQ_LEN, len(CHANNELS)) array from recorded 100 Hz frames."""
    picked = frames[: PREFIX_TICKS : _STRIDE]
    rows = [frame_features(f, corner_entry) for f in picked]
    while len(rows) < SEQ_LEN:  # run ended early: hold last value
        rows.append(rows[-1])
    seq = np.asarray(rows, dtype=np.float32)
    static = np.tile(np.asarray(static_features(scenario), dtype=np.float32), (SEQ_LEN, 1))
    return np.concatenate([seq, static], axis=1)


def run_prefix(sim: Simulator) -> np.ndarray:
    """Advance ``sim`` through the prefix window and return its features."""
    while not sim.done and len(sim.frames) < PREFIX_TICKS:
        sim.step()
    return features_from_frames(sim.telemetry()[:PREFIX_TICKS], sim.scenario, sim.corner.s_entry)


def prefix_features(
    scenario: Scenario, configuration: ConfigurationName = ConfigurationName.BASELINE
) -> np.ndarray:
    """Screening input for one candidate: simulate only the prefix."""
    return run_prefix(Simulator(scenario, configuration, record=True))


def prefix_cost_fraction(sim_time_full: float) -> float:
    return PREFIX_SECONDS / max(sim_time_full, PREFIX_SECONDS)
