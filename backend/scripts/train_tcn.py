"""Train the failure-forecasting TCN on simulator-generated data.

    python scripts/train_tcn.py --data data/training.json --output models/tcn

Saves model.pt, config.json (feature order, normalisation, threshold) and
training_metadata.json. Evaluate on held-out data with scripts/evaluate_tcn.py.
"""

from __future__ import annotations

import argparse

import _path  # noqa: F401
import torch

from app.ai.dataset import load_dataset
from app.ai.tcn import TCNConfig
from app.ai.training import TrainConfig, save_artifacts, train_tcn


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", default="data/training.json")
    ap.add_argument("--output", default="models/tcn")
    ap.add_argument("--epochs", type=int, default=40)
    ap.add_argument("--hidden", type=int, default=32)
    ap.add_argument("--levels", type=int, default=4)
    ap.add_argument("--seed", type=int, default=0)
    args = ap.parse_args()

    torch.set_num_threads(4)
    ds = load_dataset(args.data)
    print(f"loaded {len(ds.y)} runs, {int(ds.y.sum())} simulator failures")
    model, norm, meta = train_tcn(
        ds,
        TCNConfig(in_channels=ds.x.shape[-1], hidden=args.hidden, levels=args.levels),
        TrainConfig(epochs=args.epochs, seed=args.seed),
    )
    out = save_artifacts(model, norm, meta, args.output)
    v = meta["validation_metrics"]
    print(f"saved to {out}  (validation: F1 {v['f1']:.3f}, ROC-AUC {v['roc_auc']:.3f}, threshold {meta['threshold']:.2f})")


if __name__ == "__main__":
    main()
