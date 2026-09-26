from __future__ import annotations

import numpy as np

from app.ai.search.base import ScenarioSearchStrategy
from app.schemas import Scenario
from app.sim.scenario_space import DIM


class RandomSearch(ScenarioSearchStrategy):
    """Uniform sampling over the scenario space. The reference point for every comparison."""

    name = "random"

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        self.rng = np.random.default_rng(self.seed)

    def propose(self, n: int) -> list[Scenario]:
        out = []
        for _ in range(n):
            track = self.space.tracks[int(self.rng.integers(len(self.space.tracks)))]
            out.append(self.space.to_scenario(track, self.rng.random(DIM), self._next_id(),
                                              int(self.rng.integers(0, 2**31 - 1))))
        return out
