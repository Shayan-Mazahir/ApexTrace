"""Load a trained TCN and produce failure *predictions*.

Outputs are model estimates of whether a simulator run will fail. They never
replace running the simulator, which is the only source of ground truth.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np
import torch

from app.ai.features import CHANNELS, SEQ_LEN, prefix_features
from app.ai.tcn import TCN, TCNConfig
from app.ai.training import Normalizer
from app.schemas import ConfigurationName, Scenario

DEFAULT_MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "tcn"


@dataclass(frozen=True)
class Prediction:
    failure_probability: float
    uncertainty: float  # std over MC-dropout samples


class FailurePredictor:
    def __init__(self, model: TCN, norm: Normalizer, threshold: float, model_dir: Path):
        self.model = model
        self.norm = norm
        self.threshold = threshold
        self.model_dir = model_dir

    @classmethod
    def load(cls, model_dir: str | Path = DEFAULT_MODEL_DIR) -> "FailurePredictor":
        d = Path(model_dir)
        cfg = json.loads((d / "config.json").read_text())
        if cfg["channels"] != list(CHANNELS) or cfg["seq_len"] != SEQ_LEN:
            raise ValueError(f"model at {d} was trained on a different feature layout; retrain it")
        model = TCN(TCNConfig(**cfg["model"]))
        model.load_state_dict(torch.load(d / "model.pt", weights_only=True))
        model.eval()
        norm = Normalizer(np.asarray(cfg["normalization"]["mean"]), np.asarray(cfg["normalization"]["std"]))
        return cls(model, norm, float(cfg["threshold"]), d)

    def predict_proba(self, x: np.ndarray) -> np.ndarray:
        self.model.eval()
        with torch.no_grad():
            return torch.sigmoid(self.model(torch.from_numpy(self.norm(x)))).numpy()

    def predict_with_uncertainty(self, x: np.ndarray, samples: int = 20, seed: int = 0) -> list[Prediction]:
        """Monte-Carlo dropout: dropout stays on, spread of outputs = model uncertainty."""
        torch.manual_seed(seed)
        xt = torch.from_numpy(self.norm(x))
        self.model.train()
        try:
            with torch.no_grad():
                draws = torch.stack([torch.sigmoid(self.model(xt)) for _ in range(samples)]).numpy()
        finally:
            self.model.eval()
        mean = self.predict_proba(x)
        std = draws.std(axis=0)
        return [Prediction(float(m), float(s)) for m, s in zip(mean, std)]

    def predict_scenarios(
        self, scenarios: list[Scenario], configuration: ConfigurationName = ConfigurationName.BASELINE,
        samples: int = 20,
    ) -> list[Prediction]:
        if not scenarios:
            return []
        x = np.stack([prefix_features(s, configuration) for s in scenarios])
        return self.predict_with_uncertainty(x, samples)


@lru_cache(maxsize=4)
def get_predictor(model_dir: str | None = None) -> FailurePredictor:
    return FailurePredictor.load(model_dir or DEFAULT_MODEL_DIR)


def model_available(model_dir: str | Path = DEFAULT_MODEL_DIR) -> bool:
    """True if a trained model exists AND matches the current feature layout."""
    d = Path(model_dir)
    if not ((d / "model.pt").exists() and (d / "config.json").exists()):
        return False
    cfg = json.loads((d / "config.json").read_text())
    return cfg.get("channels") == list(CHANNELS) and cfg.get("seq_len") == SEQ_LEN
