"""
Build the TCN dataset from headless runs on the shared StressRun engine.

Runs (random segment runs around a corner + some full laps + the held-out
stress suite's scenarios as an out-of-distribution test) are split into
train / val / test BY RUN before any window is cut, so no run contributes to
two splits. Labels are true future outcomes from the simulator:
  exit_1s      : the car leaves the track within the next 1.0 s
  min_clear_1s : the minimum true signed clearance over the next 1.0 s
Windows whose 1 s horizon runs past a non-exit run end are dropped; a run
that ends in an exit keeps windows up to the exit (terminal failure).
"""

from __future__ import annotations

import json
import random
import time
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

import numpy as np

from app.ml.features import CHANNELS, HORIZON, WINDOW, vector
from app.placeholder_sim import signed_clearance
from app.stress.evaluation import SUITES, run_scenario
from app.stress.random_search import random_scenario

DATA_DIR = Path(__file__).resolve().parents[2] / "data"


def _observe(run, v):
    obs = run.observation()
    return {
        "x": vector(obs),
        "clearance": signed_clearance(v.x, v.y, run.config.profile, hint=v.nearest_point_index),
        "exit": v.off_track,
    }


def simulate(job: tuple[str, dict]) -> dict:
    run_id, scenario_dict = job
    from app.stress.spec import StressScenario

    scenario = StressScenario.model_validate(scenario_dict)
    out = run_scenario(scenario, observe=_observe)
    obs = out.observations
    return {
        "run_id": run_id,
        "track": scenario.track,
        "n_faults": len(scenario.faults),
        "fault_types": sorted({f.type for f in scenario.faults}),
        "x": np.array([o["x"] for o in obs], dtype=np.float32),
        "clearance": np.array([o["clearance"] for o in obs], dtype=np.float32),
        "exited": bool(out.result["track_exit"]),
    }


def windows(run: dict) -> tuple[np.ndarray, np.ndarray, np.ndarray, np.ndarray]:
    x, c = run["x"], run["clearance"]
    n = len(x)
    exited = run["exited"]
    exit_idx = n - 1 if exited else None
    xs, ys, cs, ks = [], [], [], []
    for end in range(WINDOW - 1, n):
        horizon_end = end + HORIZON
        if horizon_end >= n and not exited:
            break  # unfinished horizon at an ordinary run end
        future = c[end + 1: min(horizon_end, n - 1) + 1]
        if len(future) == 0:
            break
        label = 1.0 if exited and exit_idx is not None and exit_idx <= horizon_end else 0.0
        xs.append(x[end - WINDOW + 1: end + 1])
        ys.append(label)
        cs.append(float(future.min()))
        ks.append(float(c[end]))  # current TRUE clearance (baseline only; not a model input)
    if not xs:
        z = np.zeros(0, np.float32)
        return np.zeros((0, WINDOW, len(CHANNELS)), np.float32), z, z, z
    return np.stack(xs), np.array(ys, np.float32), np.array(cs, np.float32), np.array(ks, np.float32)


def build(n_segment: int = 2400, n_laps: int = 160, seed: int = 20260926, out: Path | None = None) -> dict:
    rng = random.Random(seed)
    jobs = []
    for i in range(n_segment):
        jobs.append((f"seg{i}", random_scenario(rng, segment=True).model_dump()))
    for i in range(n_laps):
        jobs.append((f"lap{i}", random_scenario(rng, segment=False).model_dump()))
    ood = [(f"suite_{tid}", s.model_dump()) for tid, s in SUITES["heldout"]]

    started = time.time()
    with ProcessPoolExecutor() as pool:
        runs = list(pool.map(simulate, jobs + ood, chunksize=16))
    sim_s = time.time() - started

    main_runs = [r for r in runs if not r["run_id"].startswith("suite_")]
    ood_runs = [r for r in runs if r["run_id"].startswith("suite_")]
    order = list(range(len(main_runs)))
    random.Random(seed + 1).shuffle(order)
    n_train, n_val = int(0.7 * len(order)), int(0.15 * len(order))
    split_of = {}
    for rank, idx in enumerate(order):
        split_of[main_runs[idx]["run_id"]] = "train" if rank < n_train else "val" if rank < n_train + n_val else "test"
    for r in ood_runs:
        split_of[r["run_id"]] = "suite"

    arrays = {}
    stats = {}
    for split in ("train", "val", "test", "suite"):
        parts = [windows(r) for r in runs if split_of[r["run_id"]] == split]
        X = np.concatenate([p[0] for p in parts]) if parts else np.zeros((0, WINDOW, len(CHANNELS)), np.float32)
        Y = np.concatenate([p[1] for p in parts]) if parts else np.zeros(0, np.float32)
        C = np.concatenate([p[2] for p in parts]) if parts else np.zeros(0, np.float32)
        K = np.concatenate([p[3] for p in parts]) if parts else np.zeros(0, np.float32)
        arrays[f"{split}_x"], arrays[f"{split}_y"], arrays[f"{split}_c"], arrays[f"{split}_k"] = X, Y, C, K
        split_runs = [r for r in runs if split_of[r["run_id"]] == split]
        stats[split] = {
            "runs": len(split_runs),
            "exit_runs": sum(r["exited"] for r in split_runs),
            "windows": int(len(Y)),
            "positive_windows": int(Y.sum()),
        }
    out = out or DATA_DIR / "tcn_dataset.npz"
    out.parent.mkdir(parents=True, exist_ok=True)
    np.savez_compressed(out, **arrays)
    meta = {
        "channels": CHANNELS,
        "window": WINDOW,
        "horizon": HORIZON,
        "hz": 20,
        "seed": seed,
        "segment_runs": n_segment,
        "lap_runs": n_laps,
        "suite_runs": len(ood_runs),
        "simulation_seconds": round(sim_s, 1),
        "splits": stats,
        "split_rule": "by run, before windowing (70/15/15); 'suite' = held-out stress suite runs (out of distribution)",
    }
    out.with_suffix(".json").write_text(json.dumps(meta, indent=2))
    return meta


if __name__ == "__main__":
    print(json.dumps(build(), indent=2))
