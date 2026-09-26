"""Generate a simulator-labelled training set.

    python scripts/generate_data.py --num-runs 5000 --seed 42 --output data/training.json

Parameter bounds come from app/sim/scenario_space.py; override any of them
with --bounds path/to/bounds.json containing {"name": [low, high], ...}.
"""

from __future__ import annotations

import argparse
import json
import time

import _path  # noqa: F401

from app.ai.dataset import generate_dataset, save_dataset
from app.sim.scenario_space import DEFAULT_BOUNDS, TRACKS, ParamBound, ScenarioSpace


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--num-runs", type=int, default=5000)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--output", default="data/training.json")
    ap.add_argument("--tracks", nargs="+", choices=TRACKS, default=list(TRACKS))
    ap.add_argument("--bounds", help="JSON file overriding parameter bounds")
    ap.add_argument("--workers", type=int, default=None, help="default: all CPU cores")
    args = ap.parse_args()

    bounds = list(DEFAULT_BOUNDS)
    if args.bounds:
        override = json.load(open(args.bounds))
        unknown = set(override) - {b.name for b in bounds}
        if unknown:
            raise SystemExit(f"unknown bound names: {sorted(unknown)}")
        bounds = [ParamBound(b.name, *override[b.name]) if b.name in override else b for b in bounds]
    space = ScenarioSpace(bounds=tuple(bounds), tracks=tuple(args.tracks))

    t0 = time.perf_counter()
    data = generate_dataset(args.num_runs, args.seed, space, args.workers)
    path = save_dataset(data, args.output)
    m = data["meta"]
    print(
        f"wrote {path} : {m['num_runs']} runs, {m['failures']} simulator failures "
        f"({m['failures'] / m['num_runs']:.1%}), {time.perf_counter() - t0:.1f}s"
    )


if __name__ == "__main__":
    main()
