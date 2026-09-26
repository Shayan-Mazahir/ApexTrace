"""Budgeted search loops shared by the API and the test-budget experiment.

``budget`` always counts FULL simulator runs. Screening a candidate with the
TCN costs a short prefix rollout; that cost is reported separately
(``screening_sim_seconds``) rather than hidden.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Callable, Sequence

from app.ai.inference import FailurePredictor, get_predictor, model_available
from app.ai.search import RandomSearch, ScenarioSearchStrategy, TPESearch
from app.ai.search.sac import SACSearch, sac_available
from app.ai.selection import ScenarioSelector, ScoredCandidate
from app.schemas import Scenario, SimulationResult
from app.sim.runner import run_batch
from app.sim.scenario_space import ScenarioSpace, failure_signature

Simulate = Callable[[list[Scenario]], list[SimulationResult]]


@dataclass
class TestedScenario:
    scenario: Scenario
    result: SimulationResult
    prediction: ScoredCandidate | None = None  # present only when the TCN screened it


@dataclass
class SearchOutcome:
    method: str
    tested: list[TestedScenario] = field(default_factory=list)
    screening_sim_seconds: float = 0.0
    candidates_screened: int = 0
    notes: list[str] = field(default_factory=list)

    @property
    def failures(self) -> list[TestedScenario]:
        return [t for t in self.tested if t.result.failed]

    @property
    def tests_until_first_failure(self) -> int | None:
        for i, t in enumerate(self.tested, 1):
            if t.result.failed:
                return i
        return None

    @property
    def distinct_failure_conditions(self) -> int:
        return len({failure_signature(t.scenario, t.result.failure_corner) for t in self.failures})


def default_simulate(scs: list[Scenario]) -> list[SimulationResult]:
    return run_batch(scs, workers=None if len(scs) >= 4 else 1)


def make_strategy(name: str, space: ScenarioSpace, seed: int) -> tuple[ScenarioSearchStrategy, str | None]:
    """Build a strategy; 'sac' falls back to TPE if no trained policy exists. Returns (strategy, fallback note)."""
    if name == "sac":
        if sac_available():
            try:
                return SACSearch.from_disk(space=space, seed=seed), None
            except Exception as e:  # corrupt or incompatible checkpoint
                return TPESearch(space=space, seed=seed), f"SAC policy failed to load ({e}); fell back to TPE"
        return TPESearch(space=space, seed=seed), "no trained SAC policy found; fell back to TPE"
    if name == "tpe":
        return TPESearch(space=space, seed=seed), None
    if name == "random":
        return RandomSearch(space=space, seed=seed), None
    raise ValueError(f"unknown strategy {name!r}")


def direct_search(strategy: ScenarioSearchStrategy, budget: int, batch: int = 10,
                  simulate: Simulate = default_simulate) -> SearchOutcome:
    """Propose -> simulate -> observe, until the budget of full simulations is spent."""
    out = SearchOutcome(method=strategy.name)
    while len(out.tested) < budget:
        scs = strategy.propose(min(batch, budget - len(out.tested)))
        results = simulate(scs)
        strategy.observe(scs, results)
        out.tested += [TestedScenario(s, r) for s, r in zip(scs, results)]
    return out


def selected_search(
    strategy: ScenarioSearchStrategy,
    budget: int,
    predictor: FailurePredictor | None = None,
    per_round: int = 10,
    candidates_per_round: int = 40,
    random_share: float = 0.5,
    seed: int = 0,
    simulate: Simulate = default_simulate,
    space: ScenarioSpace | None = None,
) -> SearchOutcome:
    """AI-selected testing: pool adversarial + random candidates, screen with the TCN, simulate the best."""
    space = space or strategy.space
    predictor = predictor or get_predictor()
    selector = ScenarioSelector(predictor, space)
    explorer = RandomSearch(space=space, seed=seed + 10_000)
    out = SearchOutcome(method=f"{strategy.name}+tcn_selection")
    while len(out.tested) < budget:
        k = min(per_round, budget - len(out.tested))
        n_rand = int(candidates_per_round * random_share)
        pool = strategy.propose(candidates_per_round - n_rand) + explorer.propose(n_rand)
        chosen = selector.select(pool, k, tested=[t.scenario for t in out.tested])
        if not chosen:
            out.notes.append("all candidates were near-duplicates; stopping early")
            break
        scs = [c.scenario for c in chosen]
        results = simulate(scs)
        strategy.observe(scs, results)
        out.tested += [TestedScenario(s, r, c) for s, r, c in zip(scs, results, chosen)]
        out.candidates_screened += len(pool)
    out.screening_sim_seconds = selector.screening_sim_seconds
    return out


def tcn_ready() -> bool:
    return model_available()


def summarize(outcomes: Sequence[SearchOutcome]) -> dict:
    return {o.method: {"failures": len(o.failures), "distinct": o.distinct_failure_conditions,
                       "first_failure_at": o.tests_until_first_failure, "tests": len(o.tested)} for o in outcomes}
