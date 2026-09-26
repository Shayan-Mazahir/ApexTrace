"""AI-facing service layer: predictions, scenario search, model status."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import HTTPException

from app.ai.inference import DEFAULT_MODEL_DIR, get_predictor, model_available
from app.ai.search.sac import DEFAULT_SAC_DIR, sac_available
from app.ai.search_pipeline import direct_search, make_strategy, selected_search
from app.schemas import (
    AIStatus,
    ConfigurationName,
    ModelPrediction,
    ModelStatus,
    Scenario,
    ScenarioSearchRequest,
    ScenarioSearchResponse,
    SearchTestRecord,
)
from app.sim.scenario_space import ScenarioSpace

EXPERIMENT_PATH = DEFAULT_MODEL_DIR.parent / "experiment.json"


def _read(path: Path) -> dict | None:
    return json.loads(path.read_text()) if path.exists() else None


def status() -> AIStatus:
    tcn_meta = _read(DEFAULT_MODEL_DIR / "training_metadata.json")
    if tcn_meta:
        tcn_meta = {k: v for k, v in tcn_meta.items() if k != "history"}
    sac_meta = _read(DEFAULT_SAC_DIR / "training_metadata.json")
    if sac_meta:
        sac_meta = {k: v for k, v in sac_meta.items() if k != "history"}
    exp = _read(EXPERIMENT_PATH)
    return AIStatus(
        tcn=ModelStatus(available=model_available(), path=str(DEFAULT_MODEL_DIR), metadata=tcn_meta),
        tcn_heldout_evaluation=_read(DEFAULT_MODEL_DIR / "evaluation.json"),
        sac=ModelStatus(available=sac_available(), path=str(DEFAULT_SAC_DIR), metadata=sac_meta),
        default_strategy="sac" if sac_available() else "tpe",
        experiment=None if exp is None else {"setup": exp["setup"], "summary": exp["summary"]},
    )


def _require_tcn():
    if not model_available():
        raise HTTPException(status_code=503, detail="no trained TCN; run scripts/train_tcn.py")
    return get_predictor()


def predict(scenarios: list[Scenario], configuration: ConfigurationName) -> list[ModelPrediction]:
    pred = _require_tcn()
    out = pred.predict_scenarios(scenarios, configuration)
    return [
        ModelPrediction(scenario_id=s.scenario_id, failure_probability=p.failure_probability,
                        uncertainty=p.uncertainty, predicted_failure=p.failure_probability >= pred.threshold)
        for s, p in zip(scenarios, out)
    ]


def search(req: ScenarioSearchRequest) -> ScenarioSearchResponse:
    space = ScenarioSpace(tracks=(req.track,)) if req.track else ScenarioSpace()
    strategy, note = make_strategy(req.strategy, space, req.seed)
    notes = [note] if note else []
    use_tcn = req.use_tcn_selection
    if use_tcn and not model_available():
        use_tcn = False
        notes.append("no trained TCN; ran the strategy without model screening")
    if use_tcn:
        predictor = get_predictor()
        out = selected_search(strategy, req.budget, predictor, per_round=req.per_round,
                              candidates_per_round=req.candidates_per_round, seed=req.seed, space=space)
    else:
        predictor = None
        out = direct_search(strategy, req.budget, batch=req.per_round)
    notes += out.notes

    records = []
    for t in out.tested:
        pred = None
        if t.prediction is not None:
            p = t.prediction
            pred = ModelPrediction(scenario_id=t.scenario.scenario_id, failure_probability=p.predicted_failure_probability,
                                   uncertainty=p.uncertainty,
                                   predicted_failure=p.predicted_failure_probability >= predictor.threshold)
        records.append(SearchTestRecord(scenario=t.scenario, prediction=pred, result=t.result))
    return ScenarioSearchResponse(
        strategy_requested=req.strategy,
        strategy_used=strategy.name,
        used_tcn_selection=use_tcn,
        notes=notes,
        budget=req.budget,
        simulations_run=len(out.tested),
        stress_test_failures=len(out.failures),
        distinct_failure_conditions=out.distinct_failure_conditions,
        tests_until_first_failure=out.tests_until_first_failure,
        candidates_screened=out.candidates_screened,
        screening_sim_seconds=out.screening_sim_seconds,
        tested=records,
    )
