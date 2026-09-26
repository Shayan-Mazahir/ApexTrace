"""Search objective shared by every adversarial strategy.

Rewards come from ground-truth simulator results:

* a failure scores 1.0; a near miss scores up to 0.5 depending on how close
  the car came to the track edge (challenging but survived);
* minus a small penalty for how extreme the fault settings are, so the search
  prefers failures that happen under moderate conditions instead of simply
  pushing every fault to its limit;
* diversity is handled separately (novelty bonus in SAC training, duplicate
  removal in selection).

Scenarios are always inside bounds by construction (actions are squashed into
the ScenarioSpace), so no reward is ever given for impossible values.
"""

from __future__ import annotations

from app.schemas import Scenario, SimulationResult
from app.sim.scenario_space import ScenarioSpace
from app.sim.track import PROFILES

SEVERITY_WEIGHT = 0.3
NEAR_MISS_WEIGHT = 0.5

_SPACE = ScenarioSpace()


def fault_severity(s: Scenario) -> float:
    """0 (benign) .. 1 (every fault at its bound), from normalised parameters."""
    u = dict(zip([b.name for b in _SPACE.track_bounds(s.track)], _SPACE.to_unit(s)))
    parts = [
        u["grip_error"],
        u["telemetry_delay_ms"],
        u["sensor_noise"],
        u["packet_loss"],
        u["driver_reaction_delay"],
        1.0 - u["warning_margin"],
        1.0 - u["brake_effectiveness"],
    ]
    return float(sum(parts) / len(parts))


def closeness(result: SimulationResult) -> float:
    half = PROFILES[result.scenario.track].width / 2
    return float(min(1.0, max(0.0, 1.0 - result.minimum_boundary_distance / half)))


def scenario_reward(result: SimulationResult) -> float:
    base = 1.0 if result.failed else NEAR_MISS_WEIGHT * closeness(result)
    return base - SEVERITY_WEIGHT * fault_severity(result.scenario)
