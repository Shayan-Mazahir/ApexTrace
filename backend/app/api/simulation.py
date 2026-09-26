"""Simulator endpoints. Routes stay thin: validation via schemas, work in the service layer.

Handlers are sync ``def`` so FastAPI runs them in its threadpool and long
simulations do not block the event loop.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException

from app.schemas import (
    BatchRequest,
    BatchResult,
    CompareRequest,
    ConfigurationComparison,
    ConfigurationEvaluation,
    ConfigurationInfo,
    EvaluateRequest,
    GenerateScenariosRequest,
    Replay,
    ReplayRequest,
    RunRequest,
    Scenario,
    ScenarioPreset,
    SimulationResult,
    TrackGeometry,
    TrackName,
)
from app.services import simulation_service as svc

router = APIRouter()


@router.get("/tracks", response_model=list[TrackGeometry], tags=["tracks"])
def list_tracks() -> list[TrackGeometry]:
    return svc.list_tracks()


@router.get("/tracks/{name}", response_model=TrackGeometry, tags=["tracks"])
def get_track(name: TrackName) -> TrackGeometry:
    return svc.track(name)


@router.get("/configurations", response_model=list[ConfigurationInfo], tags=["configuration"])
def list_configurations() -> list[ConfigurationInfo]:
    return svc.list_configurations()


@router.get("/scenario/presets", response_model=list[ScenarioPreset], tags=["scenario"])
def list_presets() -> list[ScenarioPreset]:
    return svc.list_presets()


@router.post("/scenario/generate", response_model=list[Scenario], tags=["scenario"])
def generate(req: GenerateScenariosRequest) -> list[Scenario]:
    return svc.generate(req.count, req.seed, req.track)


@router.post("/simulation/run", response_model=SimulationResult, tags=["simulation"])
def run(req: RunRequest) -> SimulationResult:
    return svc.run(req.scenario, req.configuration, req.include_telemetry)


@router.post("/simulation/batch", response_model=BatchResult, tags=["simulation"])
def batch(req: BatchRequest) -> BatchResult:
    return svc.batch(req.scenarios, req.configuration)


@router.post("/simulation/replay", response_model=Replay, tags=["simulation"])
def replay(req: ReplayRequest) -> Replay:
    return svc.replay(req.scenario, req.configuration, req.sample_hz)


@router.post("/scenario/evaluate", response_model=ConfigurationEvaluation, tags=["scenario"])
def evaluate(req: EvaluateRequest) -> ConfigurationEvaluation:
    return svc.evaluate(req.scenarios, req.configuration)


@router.post("/configuration/compare", response_model=ConfigurationComparison, tags=["configuration"])
def compare(req: CompareRequest) -> ConfigurationComparison:
    try:
        return svc.compare(req.scenarios, req.configurations)
    except ValueError as e:
        raise HTTPException(status_code=422, detail=str(e)) from e
