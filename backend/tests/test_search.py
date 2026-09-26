import numpy as np
import pytest

from app.ai.reward import fault_severity, scenario_reward
from app.ai.search import RandomSearch, TPESearch
from app.ai.search.sac import SACConfig, SACSearch, sac_available, train_sac
from app.schemas import Scenario
from app.sim.runner import run_batch, run_scenario
from app.sim.scenario_space import ScenarioSpace
from app.sim.track import PROFILES

SPACE = ScenarioSpace()


def assert_in_bounds(s: Scenario):
    Scenario.model_validate(s.model_dump())  # schema-valid
    for b, v in zip(SPACE.track_bounds(s.track), SPACE.to_unit(s)):
        assert 0.0 <= v <= 1.0, b.name
    lo, hi = PROFILES[s.track].entry_speed_range
    assert lo - 1e-9 <= s.entry_speed <= hi + 1e-9
    assert -0.1 - 1e-9 <= s.estimated_grip - s.actual_grip <= 0.2 + 1e-9


def test_space_roundtrip():
    rng = np.random.default_rng(0)
    for s in SPACE.sample(rng, 20):
        u = SPACE.to_unit(s)
        s2 = SPACE.to_scenario(s.track, u, s.scenario_id, s.seed)
        assert s2.model_dump() == pytest.approx(s.model_dump())


def test_out_of_range_unit_values_are_clipped():
    s = SPACE.to_scenario("monza", np.full(10, 5.0), "x", 0)
    assert_in_bounds(s)


def test_random_search_respects_bounds_and_is_seeded():
    a = RandomSearch(seed=3).propose(50)
    b = RandomSearch(seed=3).propose(50)
    assert [s.model_dump() for s in a] == [s.model_dump() for s in b]
    for s in a:
        assert_in_bounds(s)


def test_tpe_search_respects_bounds_and_observes():
    tpe = TPESearch(seed=1, n_startup_trials=5)
    for _ in range(3):
        scs = tpe.propose(4)
        for s in scs:
            assert_in_bounds(s)
        tpe.observe(scs, run_batch(scs))
    assert len(tpe.study.trials) == 12
    assert all(t.value is not None for t in tpe.study.trials)


def test_reward_prefers_failures_and_penalises_severity():
    worn = Scenario(track="monza", entry_speed=85, warning_margin=0.0, driver_reaction_delay=0.5,
                    brake_effectiveness=0.5)
    ok = Scenario(track="monza", entry_speed=85)
    assert scenario_reward(run_scenario(worn)) > scenario_reward(run_scenario(ok))
    assert fault_severity(worn) > fault_severity(ok)


def test_sac_trains_and_proposes_in_bounds():
    cfg = SACConfig(total_steps=64, warmup_steps=32, steps_per_iter=16, updates_per_iter=4, batch_size=16, hidden=32)
    agent, meta = train_sac(lambda scs: run_batch(scs), cfg, log=lambda *_: None)
    assert meta["simulations_used"] == 64
    for s in SACSearch(agent, seed=0).propose(30):
        assert_in_bounds(s)


@pytest.mark.skipif(not sac_available(), reason="no trained SAC policy in models/sac")
def test_committed_sac_policy_loads():
    scs = SACSearch.from_disk(seed=0).propose(10)
    assert len(scs) == 10
    for s in scs:
        assert_in_bounds(s)
