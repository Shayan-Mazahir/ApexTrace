from __future__ import annotations

import asyncio

from fastapi import APIRouter, HTTPException

from app import placeholder_eval
from app.budget import catalog
from app.schemas import (
    EvaluationResponse,
    ReplayRequest,
    ReplayResponse,
    SuiteInfo,
    UpgradeCatalog,
)

router = APIRouter()


@router.get("/upgrades", response_model=UpgradeCatalog)
def get_upgrades() -> UpgradeCatalog:
    return catalog()


@router.get("/evaluation/suite", response_model=SuiteInfo)
def get_suite() -> SuiteInfo:
    return placeholder_eval.suite_info()


@router.post("/evaluation/run", response_model=EvaluationResponse)
async def run_evaluation() -> EvaluationResponse:
    """Runs every upgrade combination on the same fixed suite (cached)."""
    return await asyncio.to_thread(placeholder_eval.evaluate_all)


@router.post("/evaluation/replay", response_model=ReplayResponse)
async def run_replay(body: ReplayRequest) -> ReplayResponse:
    if body.test_id not in placeholder_eval.TESTS_BY_ID:
        raise HTTPException(status_code=404, detail="unknown test id")
    test, baseline, upgraded = await asyncio.to_thread(
        placeholder_eval.replay, body.test_id, body.baseline, body.upgraded
    )
    return ReplayResponse(test=test, baseline=baseline, upgraded=upgraded)
