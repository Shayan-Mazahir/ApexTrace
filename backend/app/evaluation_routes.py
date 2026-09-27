from __future__ import annotations

import asyncio
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from app.budget import catalog
from app.schemas import UpgradeCatalog, UpgradeConfig
from app.stress import evaluation

router = APIRouter()


class ReplayRequest(BaseModel):
    test_id: str
    baseline: UpgradeConfig = Field(default_factory=UpgradeConfig)
    upgraded: UpgradeConfig


class PairedRequest(BaseModel):
    scenario_id: str
    upgrade: UpgradeConfig
    seed: int | None = None


@router.get("/upgrades", response_model=UpgradeCatalog)
def get_upgrades() -> UpgradeCatalog:
    return catalog()


@router.get("/evaluation/suite")
def get_suite(kind: str = "heldout") -> dict[str, Any]:
    if kind not in evaluation.SUITES:
        raise HTTPException(status_code=404, detail="unknown suite")
    return evaluation.suite_info(kind)


@router.post("/evaluation/run")
async def run_evaluation(kind: str = "heldout") -> dict[str, Any]:
    """Every upgrade combination on the same fixed suite (cached)."""
    if kind not in evaluation.SUITES:
        raise HTTPException(status_code=404, detail="unknown suite")
    return await asyncio.to_thread(evaluation.evaluate_all, kind)


@router.post("/evaluation/replay")
async def run_replay(body: ReplayRequest) -> dict[str, Any]:
    if evaluation.find_test(body.test_id) is None:
        raise HTTPException(status_code=404, detail="unknown test id")
    # shallow copy: the cached replay is shared between requests
    result = dict(await asyncio.to_thread(evaluation.replay, body.test_id, body.baseline, body.upgraded))
    from app.ml import risk

    risk.annotate_replay(result)
    return result


@router.post("/evaluation/paired")
async def run_paired(body: PairedRequest) -> dict[str, Any]:
    from app.scenarios import SCENARIOS

    scenario = SCENARIOS.get(body.scenario_id)
    if scenario is None:
        raise HTTPException(status_code=404, detail="unknown scenario")
    if body.seed is not None:
        scenario = scenario.model_copy(update={"seed": body.seed})
    return await asyncio.to_thread(evaluation.paired, scenario, body.upgrade)


@router.get("/ml/status")
def ml_status() -> dict[str, Any]:
    """TCN observer status + held-out metrics, and the SAC vs random report."""
    import json

    from app.ml import risk

    tcn = risk.status()
    meta_path = risk.MODEL_DIR / "meta.json"
    if meta_path.exists():
        meta = json.loads(meta_path.read_text())
        tcn["metrics"] = meta["metrics"]
        tcn["dataset"] = meta["dataset"]["splits"]
        tcn["architecture"] = meta["architecture"]
        tcn["caveats"] = meta["caveats"]
    sac_path = risk.MODEL_DIR.parent / "sac" / "report.json"
    sac = json.loads(sac_path.read_text()) if sac_path.exists() else None
    return {"tcn": tcn, "sac": sac}
