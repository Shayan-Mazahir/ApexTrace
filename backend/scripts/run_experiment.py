"""AI-selected vs. random testing under an identical simulation budget.

    python scripts/run_experiment.py --budget 50 --seeds 0 1 2 3 4 --output models/experiment.json
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import _path  # noqa: F401
import torch

from app.ai.experiment import METHODS, run_budget_experiment


def fmt(s: dict) -> str:
    return "n/a" if s["mean"] is None else f"{s['mean']:.1f} ± {s['std']:.1f}"


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--budget", type=int, default=50)
    ap.add_argument("--seeds", type=int, nargs="+", default=[0, 1, 2, 3, 4])
    ap.add_argument("--methods", nargs="+", default=list(METHODS), choices=METHODS)
    ap.add_argument("--output", default="models/experiment.json")
    args = ap.parse_args()

    torch.set_num_threads(2)
    res = run_budget_experiment(args.budget, tuple(args.seeds), tuple(args.methods))
    Path(args.output).parent.mkdir(parents=True, exist_ok=True)
    Path(args.output).write_text(json.dumps(res, indent=2))

    print(f"\nbudget {args.budget} full simulations x {len(args.seeds)} seeds (mean ± std across seeds)")
    print(f"{'method':22s} {'failures':>14s} {'distinct':>14s} {'first failure @':>16s} {'screening cost':>16s}")
    for m, s in res["summary"].items():
        print(f"{m:22s} {fmt(s['stress_test_failures']):>14s} {fmt(s['distinct_failure_conditions']):>14s} "
              f"{fmt(s['tests_until_first_failure']):>16s} {s['screening_full_sim_equivalents']:>10.1f} sims")
    print(f"\nwrote {args.output}")


if __name__ == "__main__":
    main()
