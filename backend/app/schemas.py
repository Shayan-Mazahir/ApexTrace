"""Shared Pydantic schemas. Mirrors frontend/src/types/schemas.ts — keep both in sync by hand."""

from typing import Annotated, Literal, Union

from pydantic import BaseModel, Field, TypeAdapter

TrackId = Literal["monza", "baku"]
SessionRole = Literal["driver", "engineer"]
HazardKind = Literal["braking_zone", "chicane", "sweeper", "narrow"]


class HealthStatus(BaseModel):
    status: str
    service: str


class Sector(BaseModel):
    index: int
    name: str
    start_distance: float
    end_distance: float
    start_position: tuple[float, float]


class HazardZone(BaseModel):
    id: str
    kind: HazardKind
    label: str
    start_distance: float
    end_distance: float
    position: tuple[float, float]


class TrackProfile(BaseModel):
    id: TrackId
    name: str
    seed: int
    track_width: float
    total_length: float
    start_finish: tuple[float, float]
    centerline: list[tuple[float, float]]
    left_edge: list[tuple[float, float]]
    right_edge: list[tuple[float, float]]
    sectors: list[Sector]
    hazard_zones: list[HazardZone]


class TrackProfileSummary(BaseModel):
    id: TrackId
    name: str
    total_length: float
    track_width: float
    sector_count: int
    hazard_zone_count: int


class SessionCreateRequest(BaseModel):
    track: TrackId = "monza"
    role: SessionRole = "driver"
    seed: int | None = None


class SessionCreateResponse(BaseModel):
    session_id: str
    role: SessionRole
    run_id: str
    seed: int
    track_profile: TrackProfile


class SessionJoinRequest(BaseModel):
    role: SessionRole = "engineer"


class SessionJoinResponse(BaseModel):
    session_id: str
    role: SessionRole
    run_id: str
    seed: int
    track_profile: TrackProfile


class ControlInputMessage(BaseModel):
    type: Literal["control_input"] = "control_input"
    seq: int
    session_id: str
    track: TrackId
    seed: int
    t_client: float = Field(allow_inf_nan=False)
    steering: float = Field(allow_inf_nan=False)
    throttle: float = Field(allow_inf_nan=False)
    brake: float = Field(allow_inf_nan=False)


class VehicleStateMessage(BaseModel):
    type: Literal["vehicle_state"] = "vehicle_state"
    seq: int
    t: float
    x: float
    y: float
    heading: float
    speed: float
    lap_progress: float
    sector_index: int
    sector_name: str
    distance_along_lap: float
    next_hazard_zone: str | None
    next_hazard_distance: float | None
    signed_clearance: float
    packet_age_ms: float
    injected_delay_ms: float
    warning_reason: str | None
    track_exit: bool
    lap_complete: bool


class FaultState(BaseModel):
    """Bounded fault levels; the ranges are the hard limits for engineer input."""

    grip_multiplier: float = Field(1.0, ge=0.65, le=1.0, allow_inf_nan=False)
    telemetry_delay_ms: float = Field(0.0, ge=0.0, le=400.0, allow_inf_nan=False)
    brake_wear: float = Field(1.0, ge=0.75, le=1.0, allow_inf_nan=False)


class ScenarioConfig(BaseModel):
    id: str
    name: str
    description: str
    track: TrackId
    seed: int
    faults: FaultState
    onset_distance: float = Field(ge=0)
    end_distance: float = Field(gt=0)


class PauseMessage(BaseModel):
    type: Literal["pause"] = "pause"


class ResumeMessage(BaseModel):
    type: Literal["resume"] = "resume"


class ResetMessage(BaseModel):
    type: Literal["reset"] = "reset"


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"


class SetFaultsMessage(BaseModel):
    type: Literal["set_faults"] = "set_faults"
    faults: FaultState


class LaunchScenarioMessage(BaseModel):
    type: Literal["launch_scenario"] = "launch_scenario"
    scenario_id: str


class ClearScenarioMessage(BaseModel):
    type: Literal["clear_scenario"] = "clear_scenario"


ClientMessage = Annotated[
    Union[
        ControlInputMessage,
        PauseMessage,
        ResumeMessage,
        ResetMessage,
        PongMessage,
        SetFaultsMessage,
        LaunchScenarioMessage,
        ClearScenarioMessage,
    ],
    Field(discriminator="type"),
]
CLIENT_MESSAGE_ADAPTER: TypeAdapter = TypeAdapter(ClientMessage)

DRIVER_MESSAGE_TYPES = {"control_input", "pause", "resume", "reset", "pong"}
ENGINEER_MESSAGE_TYPES = {
    "pause",
    "resume",
    "reset",
    "pong",
    "set_faults",
    "launch_scenario",
    "clear_scenario",
}
