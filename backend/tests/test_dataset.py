import numpy as np

from app.ai.dataset import generate_dataset, load_dataset, save_dataset, simulate_record
from app.ai.features import CHANNELS, SEQ_LEN, prefix_features
from app.schemas import Scenario
from app.sim.runner import run_scenario


def test_record_label_matches_simulator():
    sc = Scenario(scenario_id="w", track="monza", entry_speed=85, warning_margin=0.0,
                  driver_reaction_delay=0.5, brake_effectiveness=0.5)
    rec = simulate_record(sc)
    assert rec["failed"] == run_scenario(sc).failed is True
    x = np.asarray(rec["telemetry"])
    assert x.shape == (SEQ_LEN, len(CHANNELS))


def test_prefix_features_match_record():
    sc = Scenario(track="baku", entry_speed=50, sensor_noise=0.4, packet_loss=0.2, seed=3)
    np.testing.assert_allclose(prefix_features(sc), np.asarray(simulate_record(sc)["telemetry"]), atol=1e-4)


def test_dataset_generates_and_loads(tmp_path):
    data = generate_dataset(12, seed=1, workers=4)
    assert data["meta"]["num_runs"] == 12
    p = save_dataset(data, tmp_path / "d.json")
    ds = load_dataset(p)
    assert ds.x.shape == (12, SEQ_LEN, len(CHANNELS))
    assert ds.y.shape == (12,) and set(np.unique(ds.y)) <= {0.0, 1.0}
    assert len(ds.scenarios) == 12
    # deterministic
    assert generate_dataset(12, seed=1, workers=4) == data
