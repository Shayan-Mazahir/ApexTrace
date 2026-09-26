from __future__ import annotations

import json
from pathlib import Path

from fastapi import APIRouter, HTTPException

from app.schemas import ScenarioConfig

SCENARIO_DIR = Path(__file__).resolve().parents[2] / "scenarios"


def load_scenarios(directory: Path = SCENARIO_DIR) -> dict[str, ScenarioConfig]:
    scenarios: dict[str, ScenarioConfig] = {}
    for path in sorted(directory.glob("*.json")):
        scenario = ScenarioConfig.model_validate(json.loads(path.read_text()))
        if scenario.id in scenarios:
            raise ValueError(f"duplicate scenario id {scenario.id!r} in {path.name}")
        scenarios[scenario.id] = scenario
    return scenarios


SCENARIOS: dict[str, ScenarioConfig] = load_scenarios()

router = APIRouter()


@router.get("/scenarios", response_model=list[ScenarioConfig])
def list_scenarios() -> list[ScenarioConfig]:
    return list(SCENARIOS.values())


@router.get("/scenarios/{scenario_id}", response_model=ScenarioConfig)
def get_scenario(scenario_id: str) -> ScenarioConfig:
    scenario = SCENARIOS.get(scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="scenario not found")
    return scenario
