import pytest

from app.ai import search_pipeline
from app.ai.inference import model_available
from app.ai.search import RandomSearch, TPESearch
from app.ai.search_pipeline import direct_search, make_strategy, selected_search
from app.ai.selection import ScenarioSelector, SelectorConfig, distance
from app.sim.scenario_space import ScenarioSpace

needs_tcn = pytest.mark.skipif(not model_available(), reason="no trained TCN")
SPACE = ScenarioSpace()


@needs_tcn
def test_selector_ranks_and_removes_duplicates():
    from app.ai.inference import get_predictor

    sel = ScenarioSelector(get_predictor(), SPACE, SelectorConfig(mc_samples=4))
    cands = RandomSearch(seed=5).propose(30)
    dup = cands[0].model_copy(update={"scenario_id": "dup"})
    chosen = sel.select(cands + [dup], k=10)
    assert len(chosen) == 10
    ids = [c.scenario.scenario_id for c in chosen]
    assert not ({"dup", cands[0].scenario_id} <= set(ids))
    scores = [c.score for c in chosen]
    assert scores == sorted(scores, reverse=True)
    for i, a in enumerate(chosen):
        for b in chosen[i + 1:]:
            if a.scenario.track == b.scenario.track:
                assert distance(SPACE.to_unit(a.scenario), SPACE.to_unit(b.scenario)) >= sel.cfg.min_distance
    assert all(0 <= c.predicted_failure_probability <= 1 for c in chosen)
    assert sel.screening_sim_seconds > 0


@needs_tcn
def test_selected_search_respects_budget_and_records_ground_truth():
    out = selected_search(RandomSearch(seed=1), budget=12, per_round=6, candidates_per_round=12, seed=1)
    assert len(out.tested) == 12
    assert all(t.prediction is not None for t in out.tested)
    # Failures are exactly the simulator's verdicts, not the model's.
    assert {t.scenario.scenario_id for t in out.failures} == {t.scenario.scenario_id for t in out.tested if t.result.failed}


def test_direct_search_budget():
    out = direct_search(TPESearch(seed=0, n_startup_trials=4), budget=13, batch=5)
    assert len(out.tested) == 13


def test_sac_falls_back_to_tpe_without_policy(monkeypatch):
    monkeypatch.setattr(search_pipeline, "sac_available", lambda: False)
    strategy, note = make_strategy("sac", SPACE, 0)
    assert isinstance(strategy, TPESearch) and "fell back" in note


def test_unknown_strategy():
    with pytest.raises(ValueError):
        make_strategy("genetic", SPACE, 0)
