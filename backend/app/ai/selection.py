"""Pick which candidate scenarios are worth a full simulation.

    candidates -> prefix rollout -> TCN prediction + MC-dropout uncertainty
               -> novelty vs. already-tested scenarios
               -> score, drop near-duplicates, take top k
               -> (caller) run the real simulator for the ground-truth result

The model only ranks. A scenario counts as a failure only after the
simulator has run it and reported one.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Sequence

import numpy as np

from app.ai.features import PREFIX_SECONDS
from app.ai.inference import FailurePredictor
from app.schemas import Scenario
from app.sim.scenario_space import ScenarioSpace


@dataclass(frozen=True)
class ScoredCandidate:
    scenario: Scenario
    predicted_failure_probability: float
    uncertainty: float
    novelty: float
    score: float


@dataclass
class SelectorConfig:
    uncertainty_weight: float = 0.5
    novelty_weight: float = 0.2
    min_distance: float = 0.12  # normalised parameter-space distance below which two scenarios are duplicates
    mc_samples: int = 16


def distance(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.linalg.norm(a - b) / np.sqrt(len(a)))


class ScenarioSelector:
    def __init__(self, predictor: FailurePredictor, space: ScenarioSpace | None = None,
                 cfg: SelectorConfig | None = None):
        self.predictor = predictor
        self.space = space or ScenarioSpace()
        self.cfg = cfg or SelectorConfig()
        self.screening_sim_seconds = 0.0

    def _nearest(self, u: np.ndarray, track: str, pool: Sequence[tuple[str, np.ndarray]]) -> float:
        d = [distance(u, v) for t, v in pool if t == track]
        return min(d) if d else float("inf")

    def score(self, candidates: Sequence[Scenario], tested: Sequence[Scenario] = ()) -> list[ScoredCandidate]:
        preds = self.predictor.predict_scenarios(list(candidates), samples=self.cfg.mc_samples)
        self.screening_sim_seconds += PREFIX_SECONDS * len(candidates)
        tested_units = [(s.track, self.space.to_unit(s)) for s in tested]
        out = []
        for sc, p in zip(candidates, preds):
            nearest = self._nearest(self.space.to_unit(sc), sc.track, tested_units)
            novelty = 1.0 if nearest == float("inf") else min(1.0, nearest / (3 * self.cfg.min_distance))
            score = (p.failure_probability + self.cfg.uncertainty_weight * p.uncertainty
                     + self.cfg.novelty_weight * novelty)
            out.append(ScoredCandidate(sc, p.failure_probability, p.uncertainty, novelty, score))
        return out

    def select(self, candidates: Sequence[Scenario], k: int, tested: Sequence[Scenario] = ()) -> list[ScoredCandidate]:
        scored = sorted(self.score(candidates, tested), key=lambda c: c.score, reverse=True)
        taken: list[tuple[str, np.ndarray]] = [(s.track, self.space.to_unit(s)) for s in tested]
        chosen: list[ScoredCandidate] = []
        for c in scored:
            u = self.space.to_unit(c.scenario)
            if self._nearest(u, c.scenario.track, taken) < self.cfg.min_distance:
                continue  # near-duplicate of something already tested or selected
            chosen.append(c)
            taken.append((c.scenario.track, u))
            if len(chosen) == k:
                break
        return chosen
