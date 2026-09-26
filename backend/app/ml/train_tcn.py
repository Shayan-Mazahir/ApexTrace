"""
Train the TCN risk observer (ensemble of seeds) and evaluate it honestly.

  python -m app.ml.train_tcn            # uses data/tcn_dataset.npz
  python -m app.ml.dataset              # (re)build the dataset first

Negatives vastly outnumber positives and consecutive windows are nearly
identical, so each epoch uses every positive plus a fresh random sample of
negatives (rate r). That inflates the learned odds by 1/r, so the saved
model applies logit + log(r) to report probabilities on the true base rate.

Reported on the TEST split (runs never seen in training) and on the SUITE
split (the held-out stress-suite runs: different scenario distribution):
PR-AUC, Brier score, a reliability table, clearance MAE — next to simple
baselines. Ensemble spread is reported as disagreement, not confidence.
"""

from __future__ import annotations

import json
import math
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import torch
from torch import nn

from app.ml.dataset import DATA_DIR
from app.ml.features import CHANNELS, HORIZON, WINDOW
from app.ml.tcn import RiskTCN, receptive_field

MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "tcn"
NEG_PER_EPOCH = 30_000
VAL_NEGATIVES = 30_000  # fixed subset, used only for early stopping
BATCH = 1024
HUBER_WEIGHT = 0.5


def average_precision(y: np.ndarray, score: np.ndarray) -> float:
    order = np.argsort(-score, kind="stable")
    y = y[order]
    positives = y.sum()
    if positives == 0:
        return float("nan")
    hits = np.cumsum(y)
    precision = hits / np.arange(1, len(y) + 1)
    return float((precision * y).sum() / positives)


def reliability(y: np.ndarray, p: np.ndarray, bins: int = 10) -> list[dict]:
    edges = np.linspace(0, 1, bins + 1)
    rows = []
    for lo, hi in zip(edges[:-1], edges[1:]):
        mask = (p >= lo) & (p < hi if hi < 1 else p <= hi)
        if mask.sum():
            rows.append({"bin": f"{lo:.1f}-{hi:.1f}", "n": int(mask.sum()),
                         "mean_predicted": round(float(p[mask].mean()), 4),
                         "observed_rate": round(float(y[mask].mean()), 4)})
    return rows


def load() -> dict[str, np.ndarray]:
    data = np.load(DATA_DIR / "tcn_dataset.npz")
    return {k: data[k] for k in data.files}


def train_one(d: dict[str, np.ndarray], seed: int, mean: np.ndarray, std: np.ndarray, c_mean: float, c_std: float,
              epochs: int = 15, patience: int = 3) -> tuple[RiskTCN, float, dict]:
    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = RiskTCN(len(CHANNELS))
    opt = torch.optim.Adam(model.parameters(), lr=1e-3)
    bce = nn.BCEWithLogitsLoss()
    huber = nn.HuberLoss(delta=1.0)

    x_tr, y_tr, c_tr = d["train_x"], d["train_y"], d["train_c"]
    pos_idx = np.flatnonzero(y_tr == 1)
    neg_idx = np.flatnonzero(y_tr == 0)
    n_neg = min(NEG_PER_EPOCH, len(neg_idx))
    rate = n_neg / len(neg_idx)

    vy = d["val_y"]
    vsel = np.concatenate([np.flatnonzero(vy == 1),
                           np.random.default_rng(0).choice(np.flatnonzero(vy == 0), VAL_NEGATIVES, replace=False)])
    val_rate = VAL_NEGATIVES / max(1, int((vy == 0).sum()))
    xv = torch.from_numpy((d["val_x"][vsel] - mean) / std)
    yv = torch.from_numpy(vy[vsel])
    cv = torch.from_numpy((d["val_c"][vsel] - c_mean) / c_std)
    best, best_state, bad, history = math.inf, None, 0, []
    for epoch in range(epochs):
        model.train()
        idx = np.concatenate([pos_idx, rng.choice(neg_idx, n_neg, replace=False)])
        rng.shuffle(idx)
        total = 0.0
        t_epoch = time.time()
        for start in range(0, len(idx), BATCH):
            b = idx[start:start + BATCH]
            xb = torch.from_numpy((x_tr[b] - mean) / std)
            logit, clr = model(xb)
            loss = bce(logit, torch.from_numpy(y_tr[b])) + HUBER_WEIGHT * huber(
                clr, torch.from_numpy((c_tr[b] - c_mean) / c_std))
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += loss.item() * len(b)
        model.eval()
        with torch.no_grad():
            vl, vc = [], []
            for s in range(0, len(xv), 8192):
                lg, cl = model(xv[s:s + 8192])
                vl.append(lg + math.log(rate) - math.log(val_rate))  # same sampling on both sides
                vc.append(cl)
            lg, cl = torch.cat(vl), torch.cat(vc)
            val_loss = (bce(lg, yv) + HUBER_WEIGHT * huber(cl, cv)).item()
        history.append({"epoch": epoch + 1, "train_loss": round(total / len(idx), 4), "val_loss": round(val_loss, 4)})
        print(f"  seed {seed} epoch {epoch + 1}: train {history[-1]['train_loss']} val {history[-1]['val_loss']} "
              f"({time.time() - t_epoch:.0f}s)", flush=True)
        if val_loss < best - 1e-4:
            best, best_state, bad = val_loss, {k: v.clone() for k, v in model.state_dict().items()}, 0
        else:
            bad += 1
            if bad >= patience:
                break
    model.load_state_dict(best_state)
    return model, rate, {"seed": seed, "best_val_loss": round(best, 4), "negative_sample_rate": rate,
                         "epochs_run": len(history), "history": history}


def predict(models: list[tuple[RiskTCN, float]], x: np.ndarray, mean, std, c_mean, c_std):
    probs, clears = [], []
    xt = torch.from_numpy((x - mean) / std)
    with torch.no_grad():
        for m, rate in models:
            m.eval()
            ps, cs = [], []
            for s in range(0, len(xt), 8192):
                lg, cl = m(xt[s:s + 8192])
                ps.append(torch.sigmoid(lg + math.log(rate)))
                cs.append(cl * c_std + c_mean)
            probs.append(torch.cat(ps).numpy())
            clears.append(torch.cat(cs).numpy())
    P, C = np.stack(probs), np.stack(clears)
    return P.mean(0), P.std(0), C.mean(0)


def evaluate(split: str, d, models, mean, std, c_mean, c_std) -> dict:
    x, y, c, k = d[f"{split}_x"], d[f"{split}_y"], d[f"{split}_c"], d[f"{split}_k"]
    p, spread, clear = predict(models, x, mean, std, c_mean, c_std)
    speed, dist = x[:, -1, 0], x[:, -1, 6]
    stop_margin = dist - speed**2 / (2 * 40.0)
    base_rate = float(y.mean())
    return {
        "windows": int(len(y)),
        "positives": int(y.sum()),
        "base_rate": round(base_rate, 5),
        "tcn": {
            "pr_auc": round(average_precision(y, p), 4),
            "brier": round(float(np.mean((p - y) ** 2)), 5),
            "clearance_mae_m": round(float(np.mean(np.abs(clear - c))), 3),
            "mean_ensemble_spread": round(float(spread.mean()), 5),
        },
        "baselines": {
            "constant_base_rate": {"pr_auc": round(base_rate, 4),
                                   "brier": round(float(np.mean((base_rate - y) ** 2)), 5)},
            "current_true_clearance (not available to the TCN)": {
                "pr_auc": round(average_precision(y, -k), 4),
                "clearance_mae_m": round(float(np.mean(np.abs(k - c))), 3),
            },
            "naive_stopping_margin (observed speed & corner distance)": {
                "pr_auc": round(average_precision(y, -stop_margin), 4),
            },
        },
        "reliability": reliability(y, p),
    }


def main(seeds: tuple[int, ...] = (1, 2, 3)) -> dict:
    started = time.time()
    torch.set_num_threads(4)
    d = load()
    x_tr = d["train_x"]
    mean = x_tr.reshape(-1, x_tr.shape[-1]).mean(0).astype(np.float32)  # training data only
    std = x_tr.reshape(-1, x_tr.shape[-1]).std(0).astype(np.float32) + 1e-6
    c_mean, c_std = float(d["train_c"].mean()), float(d["train_c"].std() + 1e-6)

    models, runs = [], []
    MODEL_DIR.mkdir(parents=True, exist_ok=True)
    for seed in seeds:
        t0 = time.time()
        model, rate, info = train_one(d, seed, mean, std, c_mean, c_std)
        info["train_seconds"] = round(time.time() - t0, 1)
        torch.save(model.state_dict(), MODEL_DIR / f"tcn_seed{seed}.pt")
        models.append((model, rate))
        runs.append(info)
        print(f"seed {seed}: best val {info['best_val_loss']} after {info['epochs_run']} epochs ({info['train_seconds']}s)", flush=True)

    dataset_meta = json.loads((DATA_DIR / "tcn_dataset.json").read_text())
    meta = {
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "architecture": {"type": "causal residual TCN", "blocks": 4, "channels": 32, "kernel": 3,
                         "dilations": [1, 2, 4, 8], "receptive_field": receptive_field(),
                         "heads": ["exit_logit (next 1 s)", "min signed clearance (next 1 s)"]},
        "inputs": CHANNELS,
        "window": WINDOW,
        "horizon": HORIZON,
        "hz": 20,
        "normalisation": {"mean": mean.tolist(), "std": std.tolist(), "clearance_mean": c_mean,
                          "clearance_std": c_std, "fitted_on": "train split only"},
        "loss": f"BCE-with-logits + {HUBER_WEIGHT} x Huber(delta=1) on standardised clearance",
        "ensemble": [{"file": f"tcn_seed{r['seed']}.pt", "logit_offset": math.log(r["negative_sample_rate"]), **r}
                     for r in runs],
        "dataset": dataset_meta,
        "metrics": {
            "test": evaluate("test", d, models, mean, std, c_mean, c_std),
            "suite_out_of_distribution": evaluate("suite", d, models, mean, std, c_mean, c_std),
        },
        "caveats": [
            "Trained on a toy simulator with a scripted driver; human inputs are outside the training distribution.",
            "Probabilities are prior-corrected for negative subsampling; check the reliability table before trusting them.",
            "Ensemble spread is disagreement between seeds, not a calibrated confidence.",
            "An observer only: it does not drive warnings.",
        ],
        "total_seconds": round(time.time() - started, 1),
    }
    (MODEL_DIR / "meta.json").write_text(json.dumps(meta, indent=2))
    return meta


if __name__ == "__main__":
    m = main()
    for split, r in m["metrics"].items():
        print(f"\n== {split}: {r['windows']} windows, {r['positives']} positive (base rate {r['base_rate']})")
        print("  TCN:", r["tcn"])
        for name, b in r["baselines"].items():
            print(f"  baseline {name}: {b}")
    print("\nreliability (test):")
    for row in m["metrics"]["test"]["reliability"]:
        print("  ", row)
