"""Test-budget experiment: AI-selected testing vs. random testing.

Every method gets the same parameter bounds, the same number of FULL
simulations, the same baseline configuration, and a seed per repetition.
Results are reported per seed plus mean/std; one experiment on one simulator
is not evidence of general superiority.
"""

from __future__ import annotations

import statistics
import time

from app.ai.search_pipeline import (
    SearchOutcome,
    default_simulate,
    direct_search,
    make_strategy,
    selected_search,
    tcn_ready,
)
from app.sim.scenario_space import ScenarioSpace

METHODS = ("random", "tpe", "sac", "sac+tcn_selection", "random+tcn_selection")


def _run_method(method: str, budget: int, seed: int, space: ScenarioSpace) -> SearchOutcome:
    base = method.split("+")[0]
    strategy, note = make_strategy(base, space, seed)
    if method.endswith("+tcn_selection"):
        out = selected_search(strategy, budget, seed=seed, space=space)
    else:
        out = direct_search(strategy, budget)
    out.method = method
    if note:
        out.notes.append(note)
    return out


def _stats(values: list[float | None]) -> dict:
    vals = [v for v in values if v is not None]
    return {
        "mean": statistics.fmean(vals) if vals else None,
        "std": statistics.pstdev(vals) if len(vals) > 1 else 0.0 if vals else None,
        "min": min(vals) if vals else None,
        "max": max(vals) if vals else None,
        "runs_without_value": len(values) - len(vals),
    }


def run_budget_experiment(budget: int = 50, seeds: tuple[int, ...] = (0, 1, 2, 3, 4),
                          methods: tuple[str, ...] = METHODS, log=print) -> dict:
    space = ScenarioSpace()
    if not tcn_ready():
        methods = tuple(m for m in methods if not m.endswith("+tcn_selection"))
        log("no trained TCN found: skipping TCN-selection methods")
    per_method: dict[str, list[dict]] = {m: [] for m in methods}
    full_sim_times: list[float] = []
    t0 = time.perf_counter()
    for seed in seeds:
        for m in methods:
            o = _run_method(m, budget, seed, space)
            full_sim_times += [t.result.metrics.sim_time for t in o.tested]
            per_method[m].append({
                "seed": seed,
                "simulations": len(o.tested),
                "stress_test_failures": len(o.failures),
                "tests_until_first_failure": o.tests_until_first_failure,
                "distinct_failure_conditions": o.distinct_failure_conditions,
                "screening_sim_seconds": o.screening_sim_seconds,
                "candidates_screened": o.candidates_screened,
                "notes": o.notes,
            })
            log(f"seed {seed}  {m:22s} failures {len(o.failures):3d}/{len(o.tested)}  "
                f"distinct {o.distinct_failure_conditions:3d}  first@{o.tests_until_first_failure}")
    mean_full = statistics.fmean(full_sim_times)
    summary = {}
    for m, runs in per_method.items():
        screening = statistics.fmean(r["screening_sim_seconds"] for r in runs)
        summary[m] = {
            "stress_test_failures": _stats([r["stress_test_failures"] for r in runs]),
            "distinct_failure_conditions": _stats([r["distinct_failure_conditions"] for r in runs]),
            "tests_until_first_failure": _stats([r["tests_until_first_failure"] for r in runs]),
            "screening_full_sim_equivalents": screening / mean_full,
        }
    return {
        "setup": {
            "budget_full_simulations": budget,
            "seeds": list(seeds),
            "configuration": "baseline",
            "bounds": "app/sim/scenario_space.py DEFAULT_BOUNDS + track entry-speed/curvature ranges",
            "mean_full_run_sim_seconds": mean_full,
            "note": ("Offline training cost is not included in the budget: the TCN used "
                     "its training-set simulations and SAC its training simulations "
                     "(see models/*/training_metadata.json). Screening cost is the "
                     "simulated prefix time for every TCN-screened candidate."),
            "wall_seconds": round(time.perf_counter() - t0, 1),
        },
        "summary": summary,
        "runs": per_method,
    }
