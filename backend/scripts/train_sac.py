"""Train the SAC scenario adversary against the simulator.

    python scripts/train_sac.py --steps 2048 --output models/sac

Every training step is a real simulator run (baseline configuration). If the
trained policy does not beat random search in scripts/run_experiment.py, the
system falls back to TPE/random search; see docs/person-a-progress.md.
"""

from __future__ import annotations

import argparse
from concurrent.futures import ProcessPoolExecutor

import _path  # noqa: F401
import torch

from app.ai.search.sac import SACConfig, train_sac
from app.sim.runner import run_scenario


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--steps", type=int, default=2048)
    ap.add_argument("--seed", type=int, default=0)
    ap.add_argument("--output", default="models/sac")
    ap.add_argument("--workers", type=int, default=None)
    ap.add_argument("--target-entropy-per-dim", type=float, default=SACConfig.target_entropy_per_dim)
    args = ap.parse_args()

    torch.set_num_threads(2)
    with ProcessPoolExecutor(max_workers=args.workers) as pool:
        agent, meta = train_sac(lambda scs: list(pool.map(run_scenario, scs)),
                                SACConfig(total_steps=args.steps, seed=args.seed,
                                          target_entropy_per_dim=args.target_entropy_per_dim))
    out = agent.save(args.output, meta)
    print(f"saved to {out}  ({meta['simulations_used']} simulations, {meta['failures_during_training']} failures seen)")


if __name__ == "__main__":
    main()
