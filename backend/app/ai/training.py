"""TCN training loop and artifact saving."""

from __future__ import annotations

import json
import time
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn

from app.ai.dataset import LoadedDataset
from app.ai.features import CHANNELS, FEATURE_HZ, PREFIX_SECONDS, SEQ_LEN
from app.ai.metrics import best_f1_threshold, classification_metrics
from app.ai.tcn import TCN, TCNConfig


@dataclass
class TrainConfig:
    epochs: int = 40
    batch_size: int = 128
    lr: float = 1e-3
    weight_decay: float = 1e-4
    val_fraction: float = 0.15
    patience: int = 12
    seed: int = 0


@dataclass
class Normalizer:
    mean: np.ndarray
    std: np.ndarray

    @classmethod
    def fit(cls, x: np.ndarray) -> "Normalizer":
        flat = x.reshape(-1, x.shape[-1])
        std = flat.std(axis=0)
        return cls(mean=flat.mean(axis=0), std=np.where(std < 1e-6, 1.0, std))

    def __call__(self, x: np.ndarray) -> np.ndarray:
        return ((x - self.mean) / self.std).astype(np.float32)


def _predict(model: TCN, x: np.ndarray, batch: int = 1024) -> np.ndarray:
    model.eval()
    out = []
    with torch.no_grad():
        for i in range(0, len(x), batch):
            out.append(torch.sigmoid(model(torch.from_numpy(x[i : i + batch]))).numpy())
    return np.concatenate(out) if out else np.zeros(0)


def train_tcn(ds: LoadedDataset, model_cfg: TCNConfig | None = None, cfg: TrainConfig | None = None,
              log=print) -> tuple[TCN, Normalizer, dict]:
    cfg = cfg or TrainConfig()
    torch.manual_seed(cfg.seed)
    rng = np.random.default_rng(cfg.seed)
    idx = rng.permutation(len(ds.y))
    n_val = max(1, int(len(idx) * cfg.val_fraction))
    val_idx, tr_idx = idx[:n_val], idx[n_val:]

    norm = Normalizer.fit(ds.x[tr_idx])
    xtr, ytr = norm(ds.x[tr_idx]), ds.y[tr_idx]
    xva, yva = norm(ds.x[val_idx]), ds.y[val_idx]

    model = TCN(model_cfg or TCNConfig(in_channels=ds.x.shape[-1]))
    pos = max(1.0, float(ytr.sum()))
    loss_fn = nn.BCEWithLogitsLoss(pos_weight=torch.tensor((len(ytr) - pos) / pos))
    opt = torch.optim.AdamW(model.parameters(), lr=cfg.lr, weight_decay=cfg.weight_decay)
    sched = torch.optim.lr_scheduler.CosineAnnealingLR(opt, T_max=cfg.epochs)

    best = (float("inf"), None, 0)
    history = []
    t0 = time.perf_counter()
    for epoch in range(cfg.epochs):
        model.train()
        perm = rng.permutation(len(ytr))
        total = 0.0
        for i in range(0, len(perm), cfg.batch_size):
            b = perm[i : i + cfg.batch_size]
            opt.zero_grad()
            loss = loss_fn(model(torch.from_numpy(xtr[b])), torch.from_numpy(ytr[b]))
            loss.backward()
            opt.step()
            total += float(loss) * len(b)
        sched.step()
        model.eval()
        with torch.no_grad():
            val_loss = float(loss_fn(model(torch.from_numpy(xva)), torch.from_numpy(yva)))
        history.append({"epoch": epoch + 1, "train_loss": total / len(ytr), "val_loss": val_loss})
        log(f"epoch {epoch + 1:3d}  train {total / len(ytr):.4f}  val {val_loss:.4f}")
        if val_loss < best[0] - 1e-4:
            best = (val_loss, {k: v.clone() for k, v in model.state_dict().items()}, epoch + 1)
        elif epoch + 1 - best[2] >= cfg.patience:
            log(f"early stop (best epoch {best[2]})")
            break
    model.load_state_dict(best[1])

    p_val = _predict(model, xva)
    threshold = best_f1_threshold(yva, p_val)
    meta = {
        "trained_at": time.strftime("%Y-%m-%dT%H:%M:%S"),
        "train_seconds": round(time.perf_counter() - t0, 1),
        "dataset": ds.meta | {"records": int(len(ds.y))},
        "train_size": int(len(tr_idx)),
        "val_size": int(len(val_idx)),
        "best_epoch": best[2],
        "train_config": cfg.__dict__,
        "threshold": threshold,
        "threshold_rule": "max F1 on validation split",
        "validation_metrics": classification_metrics(yva, p_val, threshold),
        "history": history,
    }
    return model, norm, meta


def save_artifacts(model: TCN, norm: Normalizer, meta: dict, out_dir: str | Path) -> Path:
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    torch.save(model.state_dict(), out / "model.pt")
    (out / "config.json").write_text(json.dumps({
        "model": model.cfg.to_dict(),
        "channels": list(CHANNELS),
        "seq_len": SEQ_LEN,
        "prefix_seconds": PREFIX_SECONDS,
        "feature_hz": FEATURE_HZ,
        "normalization": {"mean": norm.mean.tolist(), "std": norm.std.tolist()},
        "threshold": meta["threshold"],
        "output": "estimated probability that the SIMULATOR run ends in a failure (model prediction, not ground truth)",
    }, indent=2))
    (out / "training_metadata.json").write_text(json.dumps(meta, indent=2, default=float))
    return out
