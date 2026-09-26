"""Simulator-facing service layer used by the API routes."""

from __future__ import annotations

import json
from pathlib import Path

import numpy as np

from app.schemas import (
    BatchResult,
    ConfigurationComparison,
    ConfigurationEvaluation,
    ConfigurationInfo,
    ConfigurationName,
    Replay,
    Scenario,
    ScenarioPreset,
    SimulationResult,
    TrackGeometry,
    TrackName,
)
from app.sim.evaluation import compare_configurations, evaluate_configuration
from app.sim.replay import build_replay, get_track_geometry
from app.sim.runner import run_batch, run_scenario
from app.sim.scenario_space import ScenarioSpace
from app.sim.track import PROFILES
from app.sim.upgrades import UPGRADE_DESCRIPTIONS

REPO_ROOT = Path(__file__).resolve().parents[3]
# Lap-simulator presets live in their own folder: scenarios/*.json are the
# stress-framework scenarios (a different schema, loaded by app/scenarios.py).
PRESET_DIR = REPO_ROOT / "scenarios" / "presets"
# Process pools only pay off for larger batches.
PARALLEL_THRESHOLD = 64


def _workers(n: int) -> int | None:
    return None if n >= PARALLEL_THRESHOLD else 1


def list_tracks() -> list[TrackGeometry]:
    return [get_track_geometry(name) for name in PROFILES]


def track(name: TrackName) -> TrackGeometry:
    return get_track_geometry(name)


def list_configurations() -> list[ConfigurationInfo]:
    return [ConfigurationInfo(name=c, description=UPGRADE_DESCRIPTIONS[c]) for c in ConfigurationName]


def list_presets() -> list[ScenarioPreset]:
    return [ScenarioPreset.model_validate(json.loads(p.read_text())) for p in sorted(PRESET_DIR.glob("*.json"))]


def run(scenario: Scenario, configuration: ConfigurationName, include_telemetry: bool) -> SimulationResult:
    return run_scenario(scenario, configuration, include_telemetry)


def batch(scenarios: list[Scenario], configuration: ConfigurationName) -> BatchResult:
    results = run_batch(scenarios, configuration, workers=_workers(len(scenarios)))
    return BatchResult(
        configuration=configuration,
        scenario_count=len(results),
        stress_test_failures=sum(r.failed for r in results),
        results=results,
    )


def replay(scenario: Scenario, configuration: ConfigurationName, sample_hz: float) -> Replay:
    return build_replay(scenario, configuration, sample_hz)


def generate(count: int, seed: int, track: TrackName | None) -> list[Scenario]:
    space = ScenarioSpace(tracks=(track,) if track else ScenarioSpace().tracks)
    return space.sample(np.random.default_rng(seed), count, prefix=f"gen{seed}")


def evaluate(scenarios: list[Scenario], configuration: ConfigurationName) -> ConfigurationEvaluation:
    return evaluate_configuration(configuration, scenarios, workers=_workers(len(scenarios)))


def compare(scenarios: list[Scenario], configurations: list[ConfigurationName]) -> ConfigurationComparison:
    return compare_configurations(scenarios, configurations, workers=_workers(len(scenarios)))
