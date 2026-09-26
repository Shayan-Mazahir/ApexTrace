from __future__ import annotations

from typing import Sequence

import optuna

from app.ai.reward import scenario_reward
from app.ai.search.base import ScenarioSearchStrategy
from app.schemas import Scenario, SimulationResult
from app.sim.scenario_space import PARAM_NAMES

optuna.logging.set_verbosity(optuna.logging.WARNING)


class TPESearch(ScenarioSearchStrategy):
    """Tree-structured Parzen Estimator (Optuna) maximising the shared reward.

    Fallback when SAC is unavailable: no training phase, adapts from the
    results it observes. Uses optuna's ask/tell interface so the simulator
    stays outside the optimiser.
    """

    name = "tpe"

    def __init__(self, *args, n_startup_trials: int = 15, **kwargs):
        super().__init__(*args, **kwargs)
        sampler = optuna.samplers.TPESampler(seed=self.seed, n_startup_trials=n_startup_trials, multivariate=True)
        self.study = optuna.create_study(direction="maximize", sampler=sampler)
        self._pending: dict[str, optuna.trial.Trial] = {}

    def propose(self, n: int) -> list[Scenario]:
        out = []
        for _ in range(n):
            trial = self.study.ask()
            track = trial.suggest_categorical("track", list(self.space.tracks))
            unit = [trial.suggest_float(p, 0.0, 1.0) for p in PARAM_NAMES]
            seed = trial.suggest_int("seed", 0, 2**31 - 1)
            sc = self.space.to_scenario(track, unit, self._next_id(), seed)
            self._pending[sc.scenario_id] = trial
            out.append(sc)
        return out

    def observe(self, scenarios: Sequence[Scenario], results: Sequence[SimulationResult]) -> None:
        for sc, r in zip(scenarios, results):
            trial = self._pending.pop(sc.scenario_id, None)
            if trial is not None:
                self.study.tell(trial, scenario_reward(r))
