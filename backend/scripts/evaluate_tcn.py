"""Evaluate a trained TCN on held-out simulator data (generate it with a different seed).

    python scripts/generate_data.py --num-runs 1500 --seed 7 --output data/test.json
    python scripts/evaluate_tcn.py --model models/tcn --data data/test.json

Every number printed comes from running the model on that file. Labels are
simulator outcomes; metrics describe how well the model forecasts the simulator.
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import _path  # noqa: F401

from app.ai.dataset import load_dataset
from app.ai.inference import FailurePredictor
from app.ai.metrics import classification_metrics


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--model", default="models/tcn")
    ap.add_argument("--data", default="data/test.json")
    args = ap.parse_args()

    pred = FailurePredictor.load(args.model)
    ds = load_dataset(args.data)
    train_meta = json.loads((Path(args.model) / "training_metadata.json").read_text())
    if ds.meta["seed"] == train_meta["dataset"]["seed"]:
        raise SystemExit("evaluation data uses the training seed; generate held-out data with another seed")
    p = pred.predict_proba(ds.x)
    m = classification_metrics(ds.y, p, pred.threshold)
    m["dataset"] = {"path": args.data, "seed": ds.meta["seed"], "num_runs": ds.meta["num_runs"]}
    m["simulator_failure_rate"] = float(ds.y.mean())
    (Path(args.model) / "evaluation.json").write_text(json.dumps(m, indent=2))

    cm = m["confusion_matrix"]
    print(f"held-out runs: {m['n']}  simulator failures: {m['positives']}  (threshold {m['threshold']:.2f})")
    print(f"accuracy  {m['accuracy']:.3f}\nprecision {m['precision']:.3f}\nrecall    {m['recall']:.3f}")
    print(f"F1        {m['f1']:.3f}\nROC-AUC   {m['roc_auc']:.3f}")
    print(f"confusion  TP {cm['tp']}  FP {cm['fp']}  FN {cm['fn']}  TN {cm['tn']}")


if __name__ == "__main__":
    main()
