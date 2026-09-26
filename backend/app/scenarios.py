"""Saved stress scenarios (scenarios/*.json) and engineer overrides."""

from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.stress.spec import CATALOG, FaultType, StressScenario

SCENARIO_DIR = Path(__file__).resolve().parents[2] / "scenarios"


def load_scenarios(directory: Path = SCENARIO_DIR) -> dict[str, StressScenario]:
    scenarios: dict[str, StressScenario] = {}
    for path in sorted(directory.glob("*.json")):
        scenario = StressScenario.model_validate(json.loads(path.read_text()))
        if scenario.id in scenarios:
            raise ValueError(f"duplicate scenario id {scenario.id!r} in {path.name}")
        scenarios[scenario.id] = scenario
    return scenarios


SCENARIOS: dict[str, StressScenario] = load_scenarios()


class ScenarioOverrides(BaseModel):
    seed: int | None = None
    severity: float = Field(1.0, ge=0.25, le=1.5)  # scales each fault's departure from normal
    zone_id: str | None = None  # re-target zone-triggered faults
    duration_s: float | None = Field(None, gt=0, le=600)


def apply_overrides(scenario: StressScenario, o: ScenarioOverrides) -> StressScenario:
    """Scale severity away from 'no fault' (multipliers towards/away from 1,
    delays/probabilities/offsets proportionally), clamped to catalogue bounds."""
    faults = []
    for f in scenario.faults:
        ft = CATALOG[f.type]
        params = {}
        for spec in ft.params:
            value = f.parameters[spec.name]
            neutral = 1.0 if spec.name in ("grip_multiplier", "effectiveness", "multiplier", "scale", "max_brake", "max_steer") else 0.0
            if spec.name in ("channel", "release_buffer", "rate_hz", "count"):
                scaled = value  # categorical / discrete: not scaled
            else:
                scaled = neutral + (value - neutral) * o.severity
            params[spec.name] = min(spec.max, max(spec.min, scaled))
        trigger = f.trigger
        if o.zone_id and trigger.kind == "zone":
            trigger = trigger.model_copy(update={"zone_id": o.zone_id})
        faults.append(f.model_copy(update={
            "parameters": params,
            "trigger": trigger,
            "duration_s": o.duration_s if o.duration_s is not None else f.duration_s,
        }))
    return StressScenario.model_validate({
        **scenario.model_dump(),
        "faults": [x.model_dump() for x in faults],
        "seed": o.seed if o.seed is not None else scenario.seed,
    })


router = APIRouter()


@router.get("/scenarios", response_model=list[StressScenario])
def list_scenarios() -> list[StressScenario]:
    return list(SCENARIOS.values())


@router.get("/scenarios/{scenario_id}", response_model=StressScenario)
def get_scenario(scenario_id: str) -> StressScenario:
    scenario = SCENARIOS.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="scenario not found")
    return scenario


@router.get("/faults/catalog", response_model=list[FaultType])
def fault_catalog() -> list[FaultType]:
    return list(CATALOG.values())
