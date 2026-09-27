"""Baseline vs upgraded testing on an identical scenario set."""

from __future__ import annotations

from typing import Sequence

from app.schemas import (
    ConfigurationComparison,
    ConfigurationEvaluation,
    ConfigurationName,
    Scenario,
    ScenarioOutcome,
)
from app.sim.runner import run_batch
from app.sim.upgrades import UPGRADE_DESCRIPTIONS


def evaluate_configuration(
    configuration: ConfigurationName, scenarios: Sequence[Scenario], workers: int | None = 1
) -> ConfigurationEvaluation:
    """Re-run every scenario under ``configuration`` and count simulator failures."""
    results = run_batch(scenarios, configuration, workers=workers)
    outcomes = [
        ScenarioOutcome(
            scenario_id=r.scenario_id,
            failed=r.failed,
            minimum_boundary_distance=r.minimum_boundary_distance,
            warning_too_late=r.metrics.warning_too_late,
            failure_corner=r.failure_corner,
            lap_time=r.metrics.lap_time,
        )
        for r in results
    ]
    failed = [o.scenario_id for o in outcomes if o.failed]
    return ConfigurationEvaluation(
        configuration=configuration,
        description=UPGRADE_DESCRIPTIONS[configuration],
        scenario_count=len(outcomes),
        stress_test_failures=len(failed),
        failed_scenario_ids=failed,
        outcomes=outcomes,
    )


def compare_configurations(
    scenarios: Sequence[Scenario],
    configurations: Sequence[ConfigurationName] = tuple(ConfigurationName),
    workers: int | None = 1,
) -> ConfigurationComparison:
    ids = [s.scenario_id for s in scenarios]
    if len(set(ids)) != len(ids):
        raise ValueError("scenario_id values must be unique within a comparison")
    configs = list(dict.fromkeys([ConfigurationName.BASELINE, *configurations]))
    evals = [evaluate_configuration(c, scenarios, workers) for c in configs]
    base_failed = set(evals[0].failed_scenario_ids)
    fixed, new = {}, {}
    for e in evals[1:]:
        failed = set(e.failed_scenario_ids)
        fixed[e.configuration.value] = [i for i in ids if i in base_failed and i not in failed]
        new[e.configuration.value] = [i for i in ids if i in failed and i not in base_failed]
    return ConfigurationComparison(
        scenario_count=len(scenarios),
        scenario_ids=ids,
        evaluations=evals,
        fixed_vs_baseline=fixed,
        new_failures_vs_baseline=new,
    )
