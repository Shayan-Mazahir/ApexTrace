from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Sequence

from app.schemas import Scenario, SimulationResult
from app.sim.scenario_space import ScenarioSpace


class ScenarioSearchStrategy(ABC):
    """Proposes scenarios to test; optionally learns from simulator results.

    Strategies never decide whether a scenario fails; they only choose what
    the simulator runs next.
    """

    name: str = "base"

    def __init__(self, space: ScenarioSpace | None = None, seed: int = 0):
        self.space = space or ScenarioSpace()
        self.seed = seed
        self._count = 0

    def _next_id(self) -> str:
        self._count += 1
        return f"{self.name}-{self.seed}-{self._count:05d}"

    @abstractmethod
    def propose(self, n: int) -> list[Scenario]:
        """Return ``n`` in-bounds scenarios."""

    def observe(self, scenarios: Sequence[Scenario], results: Sequence[SimulationResult]) -> None:
        """Feed back ground-truth results (no-op for non-adaptive strategies)."""
