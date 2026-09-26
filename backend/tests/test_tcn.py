import numpy as np
import pytest
import torch

from app.ai.dataset import LoadedDataset
from app.ai.features import CHANNELS, SEQ_LEN
from app.ai.inference import FailurePredictor, model_available
from app.ai.metrics import classification_metrics, roc_auc
from app.ai.tcn import TCN, TCNConfig
from app.ai.training import TrainConfig, save_artifacts, train_tcn
from app.schemas import Scenario


def test_roc_auc_known_values():
    assert roc_auc(np.array([0, 0, 1, 1]), np.array([0.1, 0.2, 0.8, 0.9])) == 1.0
    assert roc_auc(np.array([0, 0, 1, 1]), np.array([0.9, 0.8, 0.2, 0.1])) == 0.0
    assert roc_auc(np.array([0, 1]), np.array([0.5, 0.5])) == 0.5
    assert roc_auc(np.array([1, 1]), np.array([0.5, 0.5])) is None


def test_classification_metrics():
    m = classification_metrics(np.array([1, 1, 0, 0]), np.array([0.9, 0.2, 0.7, 0.1]))
    assert m["confusion_matrix"] == {"tp": 1, "fp": 1, "fn": 1, "tn": 1}
    assert m["precision"] == m["recall"] == m["f1"] == m["accuracy"] == 0.5


def test_tcn_is_causal():
    torch.manual_seed(0)
    m = TCN(TCNConfig(in_channels=3, hidden=8, levels=3))
    m.eval()
    x = torch.randn(1, 20, 3)
    h1 = m.blocks(x.transpose(1, 2))
    x2 = x.clone()
    x2[:, 15:, :] += 5.0
    h2 = m.blocks(x2.transpose(1, 2))
    assert torch.allclose(h1[:, :, :15], h2[:, :, :15])
    assert m.receptive_field >= 20


def _toy_dataset(n=400, seed=0):
    rng = np.random.default_rng(seed)
    x = rng.normal(size=(n, SEQ_LEN, len(CHANNELS))).astype(np.float32)
    y = (rng.random(n) < 0.3).astype(np.float32)
    x[:, -4:, 0] += 2.0 * y[:, None]  # label is visible only late in the sequence
    return LoadedDataset(x=x, y=y, scenarios=[], meta={"seed": seed, "num_runs": n})


def test_model_trains_and_roundtrips(tmp_path):
    ds = _toy_dataset()
    model, norm, meta = train_tcn(ds, TCNConfig(in_channels=len(CHANNELS), hidden=16, levels=3),
                                  TrainConfig(epochs=25, seed=0, patience=25), log=lambda *_: None)
    assert meta["history"][-1]["train_loss"] < meta["history"][0]["train_loss"]
    assert meta["validation_metrics"]["roc_auc"] > 0.8
    save_artifacts(model, norm, meta, tmp_path)
    pred = FailurePredictor.load(tmp_path)
    p = pred.predict_proba(ds.x[:10])
    assert p.shape == (10,) and ((0 <= p) & (p <= 1)).all()
    unc = pred.predict_with_uncertainty(ds.x[:10], samples=8)
    assert all(u.uncertainty >= 0 for u in unc)


@pytest.mark.skipif(not model_available(), reason="no trained model in models/tcn")
def test_committed_model_predicts_scenarios():
    pred = FailurePredictor.load()
    preds = pred.predict_scenarios([
        Scenario(track="monza", entry_speed=85),
        Scenario(track="monza", entry_speed=85, actual_grip=0.65, estimated_grip=0.85),
    ])
    assert len(preds) == 2
    assert all(0 <= p.failure_probability <= 1 for p in preds)
    # The model should rank a large grip overestimate as riskier than the nominal case.
    assert preds[1].failure_probability > preds[0].failure_probability
