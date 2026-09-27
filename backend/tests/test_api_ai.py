"""Lap-simulator AI endpoints (/ai/status, /scenario/predict, /scenario/search)."""

import pytest

# Needs the optional ML stack (requirements-ml.txt); skipped on a core-only install.
pytest.importorskip("torch")
pytest.importorskip("optuna")

from fastapi.testclient import TestClient  # noqa: E402

from app.ai.inference import model_available  # noqa: E402
from app.main import app  # noqa: E402
from app.schemas import AIStatus, ModelPrediction, ScenarioSearchResponse  # noqa: E402

client = TestClient(app)

WORN = {"scenario_id": "worn", "track": "monza", "entry_speed": 85, "warning_margin": 0.0,
        "driver_reaction_delay": 0.5, "brake_effectiveness": 0.5}

needs_tcn = pytest.mark.skipif(not model_available(), reason="no trained TCN")


def test_ai_status():
    s = AIStatus.model_validate(client.get("/ai/status").json())
    assert s.default_strategy in ("sac", "tpe")
    if s.tcn.available:
        assert s.tcn_heldout_evaluation is None or 0 <= s.tcn_heldout_evaluation["roc_auc"] <= 1


@needs_tcn
def test_predict_is_labelled_as_prediction():
    r = client.post("/scenario/predict", json={"scenarios": [WORN]})
    p = ModelPrediction.model_validate(r.json()[0])
    assert p.kind == "model_prediction" and p.scenario_id == "worn"


@needs_tcn
def test_search_with_tcn_selection():
    r = client.post("/scenario/search", json={"strategy": "sac", "budget": 8, "per_round": 4,
                                              "candidates_per_round": 8, "track": "baku"})
    res = ScenarioSearchResponse.model_validate(r.json())
    assert res.simulations_run == 8 and res.used_tcn_selection
    assert all(t.scenario.track == "baku" for t in res.tested)
    assert all(t.prediction is not None for t in res.tested)
    assert res.stress_test_failures == sum(t.result.failed for t in res.tested)


def test_search_fallbacks_without_tcn():
    r = client.post("/scenario/search", json={"strategy": "random", "budget": 5, "use_tcn_selection": False})
    res = ScenarioSearchResponse.model_validate(r.json())
    assert res.strategy_used == "random" and res.simulations_run == 5
    assert all(t.prediction is None for t in res.tested)


def test_search_budget_bounds():
    assert client.post("/scenario/search", json={"budget": 0}).status_code == 422
    assert client.post("/scenario/search", json={"budget": 10_000}).status_code == 422
    assert client.post("/scenario/search", json={"strategy": "genetic"}).status_code == 422
