"""AI endpoints: model status, TCN predictions, adversarial scenario search."""

from __future__ import annotations

from fastapi import APIRouter

from app.schemas import AIStatus, ModelPrediction, PredictRequest, ScenarioSearchRequest, ScenarioSearchResponse
from app.services import ai_service as svc

router = APIRouter()


@router.get("/ai/status", response_model=AIStatus, tags=["ai"])
def ai_status() -> AIStatus:
    return svc.status()


@router.post("/scenario/predict", response_model=list[ModelPrediction], tags=["ai"])
def predict(req: PredictRequest) -> list[ModelPrediction]:
    """TCN estimate of each scenario's simulator outcome. Run /simulation/run for the actual result."""
    return svc.predict(req.scenarios, req.configuration)


@router.post("/scenario/search", response_model=ScenarioSearchResponse, tags=["ai"])
def search(req: ScenarioSearchRequest) -> ScenarioSearchResponse:
    """Search for scenarios the safety system handles badly. Every reported failure is a simulator result."""
    return svc.search(req)
