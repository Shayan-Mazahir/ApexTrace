"""TCN observer and SAC environment: honest availability, causality, the
declared inputs, and hard adversary bounds. Skips cleanly without torch."""

import json

import pytest

from app.ml import risk
from app.ml.features import CHANNELS, WINDOW, vector
from app.placeholder_sim import TRACK_PRESETS
from app.stress.run import RunConfig, StressRun

torch = pytest.importorskip("torch")


def test_observer_uses_only_declared_observed_channels():
    run = StressRun(RunConfig(profile=TRACK_PRESETS["monza"]))
    obs = run.observation()
    assert [k for k in obs if not k.startswith("_")] == CHANNELS  # "_" keys are for labelling only
    # ground truth the driver/system can't see must never be an input
    assert not {"true_grip", "track_exit", "clearance", "min_clearance"} & set(CHANNELS)
    assert vector({k: obs[k] for k in CHANNELS}) == vector(obs)  # the model reads nothing else
    assert len(vector(obs)) == len(CHANNELS)


def test_status_is_unavailable_without_a_checkpoint(tmp_path, monkeypatch):
    monkeypatch.setattr(risk, "MODEL_DIR", tmp_path)
    risk.reset_cache()
    try:
        s = risk.status()
        assert s["available"] is False and "no trained TCN" in s["reason"]
        assert risk.new_observer() is None
    finally:
        risk.reset_cache()


def test_status_rejects_a_checkpoint_with_different_inputs(tmp_path, monkeypatch):
    (tmp_path / "meta.json").write_text(json.dumps({"inputs": ["speed"], "ensemble": []}))
    monkeypatch.setattr(risk, "MODEL_DIR", tmp_path)
    risk.reset_cache()
    try:
        assert risk.status() == {"available": False, "reason": "checkpoint inputs do not match the declared channels"}
    finally:
        risk.reset_cache()


def test_tcn_is_causal():
    from app.ml.tcn import RiskTCN, receptive_field

    assert receptive_field() >= WINDOW
    m = RiskTCN(len(CHANNELS)).eval()
    x = torch.randn(1, WINDOW, len(CHANNELS))
    h1 = m.tcn(x.transpose(1, 2))
    y = x.clone()
    y[:, 30:] += 5.0  # change only the future of step 29
    h2 = m.tcn(y.transpose(1, 2))
    assert torch.allclose(h1[:, :, :30], h2[:, :, :30])
    assert not torch.allclose(h1[:, :, 30:], h2[:, :, 30:])


@pytest.mark.skipif(not (risk.MODEL_DIR / "meta.json").exists(), reason="no trained TCN in models/tcn")
def test_trained_ensemble_loads_and_predicts():
    risk.reset_cache()
    s = risk.status()
    assert s["available"] and s["ensemble_size"] >= 1
    meta = json.loads((risk.MODEL_DIR / "meta.json").read_text())
    for split in ("test", "suite_out_of_distribution"):
        assert 0 <= meta["metrics"][split]["tcn"]["pr_auc"] <= 1
    run = StressRun(RunConfig(profile=TRACK_PRESETS["monza"]))
    obs = risk.new_observer()
    preds = []
    for _ in range(WINDOW + 5):
        run.tick(0.0, 1.0, 0.0)
        preds.append(obs.update(vector(run.observation())))
    assert all(p is None for p in preds[: WINDOW - 1])  # warming up, no fake number
    last = preds[-1]
    assert 0.0 <= last["risk"] <= 1.0 and last["spread"] >= 0.0
    assert last["risk"] < 0.5  # full throttle on the main straight is not an exit


@pytest.mark.skipif(not (risk.MODEL_DIR / "meta.json").exists(), reason="no trained TCN")
def test_replay_predictions_match_live_observer_without_future_input():
    risk.reset_cache()
    observer = risk.new_observer()
    run = StressRun(RunConfig(profile=TRACK_PRESETS["monza"]))
    observations, expected, frames = [], {}, []
    for tick in range(1, 65):
        run.tick(0.0, 1.0, 0.0)
        sample = vector(run.observation())
        observations.append(sample)
        prediction = observer.update(sample)
        if tick % 2 == 0:
            frames.append({"t": tick / 20})
            expected[tick / 20] = prediction
    risk.annotate_frames(frames, observations)
    for frame in frames:
        prediction = expected[frame["t"]]
        if prediction is None:
            assert "tcn_risk" not in frame
        else:
            assert frame["tcn_risk"] == pytest.approx(prediction["risk"], abs=1e-6)
            assert frame["tcn_clearance"] == pytest.approx(prediction["clearance"], abs=1e-5)


def test_sac_env_bounds_are_hard():
    pytest.importorskip("gymnasium")
    import numpy as np

    from app.ml.sac_env import BUDGET, MAX_STEP, FaultAdversaryEnv

    env = FaultAdversaryEnv(track="monza", seed=3)
    env.reset(seed=3)
    prev = env.levels.copy()
    forced_off = False
    for _ in range(60):
        exhausted = env.budget_left <= 0
        _, _, term, trunc, _ = env.step(np.ones(3, dtype=np.float32))  # always ask for maximum
        if exhausted:
            assert np.all(env.levels == 0)  # budget spent: faults forced off
            forced_off = True
        else:
            assert np.all(np.abs(env.levels - prev) <= MAX_STEP + 1e-6)  # rate limit
        assert np.all((env.levels >= 0) & (env.levels <= 1))
        prev = env.levels.copy()
        if term or trunc:
            break
    assert forced_off, "a maximal adversary should exhaust the budget within an episode"
    p = env.grip.spec.parameters["grip_multiplier"]
    assert 0.6 - 1e-9 <= p <= 1.0
    assert BUDGET > 0
