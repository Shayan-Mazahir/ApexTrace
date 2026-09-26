import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.schemas import (
    BatchResult,
    ConfigurationComparison,
    ConfigurationEvaluation,
    Replay,
    Scenario,
    ScenarioPreset,
    SimulationResult,
    TrackGeometry,
)

client = TestClient(app)

WORN = {"scenario_id": "worn", "track": "monza", "entry_speed": 85, "warning_margin": 0.0,
        "driver_reaction_delay": 0.5, "brake_effectiveness": 0.5}


def test_health():
    assert client.get("/health").json() == {"status": "ok", "service": "limitlab-backend"}


def test_tracks():
    r = client.get("/simulation/tracks")
    assert r.status_code == 200
    tracks = [TrackGeometry.model_validate(t) for t in r.json()]
    assert {t.name for t in tracks} == {"monza", "baku"}
    baku = TrackGeometry.model_validate(client.get("/simulation/tracks/baku").json())
    assert baku.closed and len(baku.corners) >= 10
    assert client.get("/simulation/tracks/spa").status_code == 422


def test_presets_and_configurations():
    presets = [ScenarioPreset.model_validate(p) for p in client.get("/scenario/presets").json()]
    assert len(presets) >= 5
    assert {c["name"] for c in client.get("/configurations").json()} == {
        "baseline", "brake_service", "reliable_telemetry", "local_warning_fallback"}


def test_run_valid_scenario():
    r = client.post("/simulation/run", json={"scenario": WORN, "include_telemetry": True})
    assert r.status_code == 200
    res = SimulationResult.model_validate(r.json())
    assert res.failed and res.telemetry and res.configuration == "baseline"


@pytest.mark.parametrize("bad", [
    {"entry_speed": -5},
    {"actual_grip": 5},
    {"track": "spa"},
    {"driver_reaction_delay": 5},
    {"telemetry_delay_ms": -1},
])
def test_invalid_scenario_rejected(bad):
    assert client.post("/simulation/run", json={"scenario": {**WORN, **bad}}).status_code == 422


def test_batch():
    scs = [{**WORN, "scenario_id": f"w{i}", "seed": i} for i in range(3)]
    r = client.post("/simulation/batch", json={"scenarios": scs})
    b = BatchResult.model_validate(r.json())
    assert b.scenario_count == 3 and b.stress_test_failures == 3
    assert all(x.telemetry is None for x in b.results)
    assert client.post("/simulation/batch", json={"scenarios": []}).status_code == 422


def test_replay_baseline_vs_upgraded():
    base = Replay.model_validate(client.post("/simulation/replay", json={"scenario": WORN}).json())
    up = Replay.model_validate(client.post("/simulation/replay",
                                           json={"scenario": WORN, "configuration": "brake_service"}).json())
    assert base.result.failed and up.result.success
    assert base.track.name == "monza" and base.frames


def test_generate_evaluate_compare():
    scs = client.post("/scenario/generate", json={"count": 8, "seed": 3}).json()
    assert len(scs) == 8
    [Scenario.model_validate(s) for s in scs]
    ev = ConfigurationEvaluation.model_validate(client.post("/scenario/evaluate", json={"scenarios": scs}).json())
    assert ev.scenario_count == 8
    cmp = ConfigurationComparison.model_validate(
        client.post("/configuration/compare", json={"scenarios": scs + [WORN]}).json())
    assert len(cmp.evaluations) == 4
    assert "worn" in cmp.fixed_vs_baseline["brake_service"]


def test_compare_rejects_duplicate_ids():
    r = client.post("/configuration/compare", json={"scenarios": [WORN, WORN]})
    assert r.status_code == 422


def test_websocket_scripted_stream():
    start = {"type": "start", "scenario": {"track": "baku", "entry_speed": 75},
             "rate_hz": 5, "speedup": 100}
    with client.websocket_connect("/ws/simulation") as ws:
        ws.send_json(start)
        assert ws.receive_json()["type"] == "track"
        msgs = []
        while True:
            m = ws.receive_json()
            msgs.append(m)
            if m["type"] == "result":
                break
    states = [m["state"] for m in msgs if m["type"] == "state"]
    assert len(states) > 400  # a ~100 s lap at 5 Hz
    assert {"x", "y", "speed", "heading", "warning", "brake", "lap_progress", "next_corner"} <= set(states[0])
    assert SimulationResult.model_validate(msgs[-1]["result"]).success


def test_websocket_manual_control():
    start = {"type": "start", "scenario": {"track": "baku", "entry_speed": 30}, "mode": "manual",
             "rate_hz": 50, "speedup": 20}
    with client.websocket_connect("/ws/simulation") as ws:
        ws.send_json(start)
        ws.receive_json()
        ws.send_json({"type": "control", "steering": 0.0, "throttle": 0.0, "brake": 1.0})
        speeds = []
        for _ in range(30):
            m = ws.receive_json()
            speeds.append(m["state"]["speed"])
    assert speeds[-1] < speeds[0]


def test_websocket_bad_start():
    with client.websocket_connect("/ws/simulation") as ws:
        ws.send_json({"type": "start", "scenario": {"entry_speed": -1}})
        assert ws.receive_json()["type"] == "error"


# ------------------------------------------------------------------ AI ---- #

from app.ai.inference import model_available  # noqa: E402
from app.schemas import AIStatus, ModelPrediction, ScenarioSearchResponse  # noqa: E402

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
