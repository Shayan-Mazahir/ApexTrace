"""Scenario runner: Scenario -> SimulationResult, single or batched.

Results are fully determined by (scenario incl. seed, configuration), so a
stored scenario is all that is needed to reproduce a run exactly.
"""

from __future__ import annotations

import os
from concurrent.futures import ProcessPoolExecutor
from typing import Iterable

from app.schemas import ConfigurationName, Scenario, SimulationResult
from app.sim.simulator import Simulator


def run_scenario(
    scenario: Scenario,
    configuration: ConfigurationName = ConfigurationName.BASELINE,
    include_telemetry: bool = False,
) -> SimulationResult:
    sim = Simulator(scenario, configuration, record=include_telemetry)
    return sim.run(include_telemetry=include_telemetry)


def _run_args(args: tuple[Scenario, ConfigurationName, bool]) -> SimulationResult:
    return run_scenario(*args)


def run_batch(
    scenarios: Iterable[Scenario],
    configuration: ConfigurationName = ConfigurationName.BASELINE,
    include_telemetry: bool = False,
    workers: int | None = 1,
) -> list[SimulationResult]:
    """Run many scenarios. ``workers > 1`` uses processes; output order matches input order."""
    jobs = [(s, configuration, include_telemetry) for s in scenarios]
    if workers is None:
        workers = os.cpu_count() or 1
    if workers <= 1 or len(jobs) < 8:
        return [_run_args(j) for j in jobs]
    with ProcessPoolExecutor(max_workers=workers) as pool:
        return list(pool.map(_run_args, jobs, chunksize=max(1, len(jobs) // (workers * 4))))
