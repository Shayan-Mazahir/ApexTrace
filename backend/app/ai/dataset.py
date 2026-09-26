"""Training data generated from our own simulator (no external data).

Each record: scenario parameters, the prefix telemetry features the model
sees, and the simulator's ground-truth outcome for the full run.
"""

from __future__ import annotations

import json
import os
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Sequence

import numpy as np

from app.ai.features import CHANNELS, FEATURE_HZ, PREFIX_SECONDS, SEQ_LEN, run_prefix
from app.schemas import ConfigurationName, Scenario
from app.sim.scenario_space import ScenarioSpace
from app.sim.simulator import Simulator


def simulate_record(scenario: Scenario, configuration: ConfigurationName = ConfigurationName.BASELINE) -> dict:
    """Run one scenario fully; keep prefix features + ground-truth label."""
    sim = Simulator(scenario, configuration, record=True)
    x = run_prefix(sim)
    while not sim.done:
        sim.step()
    r = sim.result()
    return {
        "scenario": scenario.model_dump(),
        "configuration": configuration.value,
        "telemetry": np.round(x, 5).tolist(),
        "failed": r.failed,
        "minimum_boundary_distance": r.minimum_boundary_distance,
        "warning_too_late": r.metrics.warning_too_late,
        "sim_time": r.metrics.sim_time,
    }


def generate_records(scenarios: Sequence[Scenario], workers: int | None = None) -> list[dict]:
    workers = workers or os.cpu_count() or 1
    if workers <= 1:
        return [simulate_record(s) for s in scenarios]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(simulate_record, scenarios, chunksize=max(1, len(scenarios) // (workers * 8))))


def generate_dataset(num_runs: int, seed: int, space: ScenarioSpace | None = None, workers: int | None = None) -> dict:
    space = space or ScenarioSpace()
    scenarios = space.sample(np.random.default_rng(seed), num_runs, prefix=f"train{seed}")
    records = generate_records(scenarios, workers)
    return {
        "meta": {
            "source": "LimitLab simulator (synthetic, baseline configuration)",
            "num_runs": num_runs,
            "seed": seed,
            "prefix_seconds": PREFIX_SECONDS,
            "feature_hz": FEATURE_HZ,
            "seq_len": SEQ_LEN,
            "channels": list(CHANNELS),
            "tracks": list(space.tracks),
            "bounds": [b.__dict__ for b in space.bounds],
            "failures": int(sum(r["failed"] for r in records)),
        },
        "records": records,
    }


def save_dataset(data: dict, path: str | Path) -> Path:
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return path


@dataclass
class LoadedDataset:
    x: np.ndarray  # (N, SEQ_LEN, C)
    y: np.ndarray  # (N,)
    scenarios: list[Scenario]
    meta: dict


def load_dataset(path: str | Path) -> LoadedDataset:
    data = json.loads(Path(path).read_text())
    meta, recs = data["meta"], data["records"]
    if meta["channels"] != list(CHANNELS):
        raise ValueError("dataset channel layout does not match this code version; regenerate it")
    x = np.asarray([r["telemetry"] for r in recs], dtype=np.float32)
    y = np.asarray([r["failed"] for r in recs], dtype=np.float32)
    return LoadedDataset(x=x, y=y, scenarios=[Scenario.model_validate(r["scenario"]) for r in recs], meta=meta)
