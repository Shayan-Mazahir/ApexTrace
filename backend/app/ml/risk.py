"""
TCN risk observer (deployment side).

Loads the trained ensemble from models/tcn/ if it exists; otherwise reports
itself unavailable (as does a missing torch install). It only OBSERVES:
it predicts near-term simulated exit risk and clearance from the declared
observed channels and never drives the warning.
"""

from __future__ import annotations

import json
from collections import deque
from pathlib import Path
from typing import Any

from app.ml.features import CHANNELS, WINDOW

MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "tcn"
_bundle: dict[str, Any] | None = None
_reason: str | None = None


def reset_cache() -> None:
    global _bundle, _reason
    _bundle, _reason = None, None


def _load() -> dict[str, Any] | None:
    global _bundle, _reason
    if _bundle is not None or _reason is not None:
        return _bundle
    meta_path = Path(MODEL_DIR) / "meta.json"
    if not meta_path.exists():
        _reason = "no trained TCN checkpoint found (run python -m app.ml.train_tcn)"
        return None
    try:
        import numpy as np
        import torch

        from app.ml.tcn import RiskTCN
    except ImportError as exc:
        _reason = f"ML dependencies not installed ({exc.name}); pip install -r requirements-ml.txt"
        return None
    meta = json.loads(meta_path.read_text())
    if meta.get("inputs") != CHANNELS:
        _reason = "checkpoint inputs do not match the declared channels"
        return None
    torch.set_num_threads(1)
    models = []
    for entry in meta["ensemble"]:
        path = Path(MODEL_DIR) / entry["file"]
        if not path.exists():
            continue
        m = RiskTCN(len(CHANNELS))
        m.load_state_dict(torch.load(path, map_location="cpu", weights_only=True))
        m.eval()
        models.append((m, float(entry["logit_offset"])))
    if not models:
        _reason = "checkpoint files missing"
        return None
    norm = meta["normalisation"]
    _bundle = {
        "meta": meta,
        "models": models,
        "mean": np.array(norm["mean"], dtype=np.float32),
        "std": np.array(norm["std"], dtype=np.float32),
        "c_mean": float(norm["clearance_mean"]),
        "c_std": float(norm["clearance_std"]),
        "torch": torch,
        "np": np,
    }
    return _bundle


def status() -> dict[str, Any]:
    b = _load()
    if b is None:
        return {"available": False, "reason": _reason}
    meta = b["meta"]
    test = meta["metrics"]["test"]
    return {
        "available": True,
        "created": meta["created"],
        "ensemble_size": len(b["models"]),
        "window_s": meta["window"] / meta["hz"],
        "horizon_s": meta["horizon"] / meta["hz"],
        "test_pr_auc": test["tcn"]["pr_auc"],
        "test_brier": test["tcn"]["brier"],
        "test_clearance_mae_m": test["tcn"]["clearance_mae_m"],
        "role": "observer only — does not drive warnings",
    }


class RiskObserver:
    """Rolling window of observed telemetry -> ensemble prediction."""

    def __init__(self, bundle: dict[str, Any]) -> None:
        self.b = bundle
        self.buf: deque[list[float]] = deque(maxlen=WINDOW)

    def update(self, x: list[float]) -> dict[str, float] | None:
        self.buf.append(x)
        if len(self.buf) < WINDOW:
            return None  # warming up: not enough history yet
        np, torch = self.b["np"], self.b["torch"]
        arr = (np.asarray(self.buf, dtype=np.float32) - self.b["mean"]) / self.b["std"]
        xt = torch.from_numpy(arr[None])
        probs, clears = [], []
        with torch.no_grad():
            for m, offset in self.b["models"]:
                lg, cl = m(xt)
                probs.append(float(torch.sigmoid(lg + offset)))
                clears.append(float(cl) * self.b["c_std"] + self.b["c_mean"])
        mean_p = sum(probs) / len(probs)
        spread = (sum((p - mean_p) ** 2 for p in probs) / len(probs)) ** 0.5
        return {"risk": mean_p, "clearance": sum(clears) / len(clears), "spread": spread}


def new_observer() -> RiskObserver | None:
    b = _load()
    return RiskObserver(b) if b is not None else None


def annotate_replay(replay: dict[str, Any]) -> None:
    replay["tcn"] = status()


def annotate_frames(frames: list[dict], observations: list[list[float]]) -> None:
    """Batch replay inference from 20 Hz observations, before 10 Hz display.

    A window ends at its frame's sample: future telemetry never enters it.
    """
    b = _load()
    if b is None or len(observations) < WINDOW:
        return
    np, torch = b["np"], b["torch"]
    samples = (np.asarray(observations, dtype=np.float32) - b["mean"]) / b["std"]
    eligible = [(f, round(f["t"] * 20) - 1) for f in frames if round(f["t"] * 20) >= WINDOW]
    with torch.inference_mode():
        for start in range(0, len(eligible), 256):
            batch = eligible[start:start + 256]
            x = torch.from_numpy(np.stack([samples[end - WINDOW + 1:end + 1] for _, end in batch]))
            probs, clears = [], []
            for model, offset in b["models"]:
                logit, clearance = model(x)
                probs.append(torch.sigmoid(logit + offset))
                clears.append(clearance * b["c_std"] + b["c_mean"])
            p = torch.stack(probs)
            risk, spread = p.mean(0).tolist(), p.std(0, correction=0).tolist()
            clearance = torch.stack(clears).mean(0).tolist()
            for i, (frame, _) in enumerate(batch):
                frame.update(tcn_risk=risk[i], tcn_spread=spread[i], tcn_clearance=clearance[i])
