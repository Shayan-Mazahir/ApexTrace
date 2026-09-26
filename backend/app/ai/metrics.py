"""Binary classification metrics (no sklearn dependency)."""

from __future__ import annotations

import numpy as np


def roc_auc(y: np.ndarray, p: np.ndarray) -> float | None:
    """Mann-Whitney U formulation with average ranks for ties."""
    y = np.asarray(y).astype(bool)
    n_pos, n_neg = int(y.sum()), int((~y).sum())
    if n_pos == 0 or n_neg == 0:
        return None
    order = np.argsort(p, kind="mergesort")
    ranks = np.empty(len(p), dtype=float)
    sp = np.asarray(p)[order]
    i = 0
    while i < len(sp):
        j = i
        while j + 1 < len(sp) and sp[j + 1] == sp[i]:
            j += 1
        ranks[order[i : j + 1]] = 0.5 * (i + j) + 1
        i = j + 1
    return float((ranks[y].sum() - n_pos * (n_pos + 1) / 2) / (n_pos * n_neg))


def classification_metrics(y: np.ndarray, p: np.ndarray, threshold: float = 0.5) -> dict:
    y = np.asarray(y).astype(bool)
    pred = np.asarray(p) >= threshold
    tp = int((pred & y).sum())
    fp = int((pred & ~y).sum())
    fn = int((~pred & y).sum())
    tn = int((~pred & ~y).sum())
    precision = tp / (tp + fp) if tp + fp else 0.0
    recall = tp / (tp + fn) if tp + fn else 0.0
    f1 = 2 * precision * recall / (precision + recall) if precision + recall else 0.0
    return {
        "n": int(len(y)),
        "positives": int(y.sum()),
        "threshold": float(threshold),
        "accuracy": (tp + tn) / max(1, len(y)),
        "precision": precision,
        "recall": recall,
        "f1": f1,
        "roc_auc": roc_auc(y, p),
        "confusion_matrix": {"tp": tp, "fp": fp, "fn": fn, "tn": tn},
    }


def best_f1_threshold(y: np.ndarray, p: np.ndarray) -> float:
    grid = np.linspace(0.05, 0.95, 91)
    scores = [classification_metrics(y, p, t)["f1"] for t in grid]
    return float(grid[int(np.argmax(scores))])
