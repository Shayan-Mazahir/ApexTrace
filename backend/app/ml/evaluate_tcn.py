"""Re-evaluate the saved TCN on the current simulator without retraining.

Run: python -m app.ml.evaluate_tcn
The original training/test metrics remain intact. The held-out suite metric
is refreshed from new runs, with a hash of the simulator used for evaluation.
"""

import hashlib
import json
import math
from pathlib import Path

import numpy as np

from app.ml import risk
from app.ml.dataset import simulate, windows
from app.ml.train_tcn import evaluate
from app.stress.evaluation import SUITES


def main():
    bundle = risk._load()
    if bundle is None:
        raise RuntimeError(risk.status()["reason"])
    parts = []
    suite = SUITES["heldout"]
    for i, (test_id, scenario) in enumerate(suite, 1):
        parts.append(windows(simulate((test_id, scenario.model_dump()))))
        print(f"Simulated held-out run {i}/{len(suite)}: {test_id}", flush=True)
    data = {f"suite_{name}": np.concatenate([part[i] for part in parts])
            for i, name in enumerate(("x", "y", "c", "k"))}
    print("Evaluating saved ensemble on current simulator observations…", flush=True)
    metrics = evaluate("suite", data, [(model, math.exp(offset)) for model, offset in bundle["models"]],
                       bundle["mean"], bundle["std"], bundle["c_mean"], bundle["c_std"])
    path = risk.MODEL_DIR / "meta.json"
    meta = json.loads(path.read_text())
    meta["metrics"].setdefault("suite_at_training", meta["metrics"]["suite_out_of_distribution"])
    meta["metrics"]["suite_out_of_distribution"] = metrics
    app = Path(__file__).resolve().parents[1]
    meta["suite_simulator_sha256"] = {
        name: hashlib.sha256((app / name).read_bytes()).hexdigest()
        for name in ("placeholder_sim.py", "barriers.py", "stress/run.py", "stress/evaluation.py")
    }
    note = "Training/test data predates the solid-footprint barrier fix; the held-out stress suite was rerun with the current simulator."
    if note not in meta["caveats"]:
        meta["caveats"].append(note)
    temporary = path.with_suffix(".tmp")
    temporary.write_text(json.dumps(meta, indent=2))
    temporary.replace(path)
    print(json.dumps(metrics, indent=2), flush=True)


if __name__ == "__main__":
    main()
