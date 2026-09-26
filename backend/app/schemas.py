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
    corner_speed: float


class TrackProfile(BaseModel):
    id: TrackId
    name: str
    seed: int
    track_width: float
    total_length: float
    barrier_offset: float  # barrier distance outside the track edge (m); walls stop the car
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


class UpgradeConfig(BaseModel):
    brake_servicing: bool = False
    comms_improvement: bool = False
    local_fallback: bool = False


class SessionCreateRequest(BaseModel):
    track: TrackId = "monza"
    role: SessionRole = "driver"
    seed: int | None = None
    upgrades: UpgradeConfig = Field(default_factory=UpgradeConfig)


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
    warning_path_delay_ms: float
    local_fallback_active: bool
    warning_reason: str | None
    track_exit: bool
    lap_complete: bool
    off_track: bool
    track_exits: int
    lap: int
    laps_completed: int
    lap_time_s: float
    last_lap_s: float | None
    best_lap_s: float | None


class PauseMessage(BaseModel):
    type: Literal["pause"] = "pause"


class ResumeMessage(BaseModel):
    type: Literal["resume"] = "resume"


class ResetMessage(BaseModel):
    type: Literal["reset"] = "reset"


class PongMessage(BaseModel):
    type: Literal["pong"] = "pong"


class ArmScenarioMessage(BaseModel):
    """Arm a saved scenario: resets the run to the scenario's start with its
    seed; faults then wait for their own triggers (arming != activating)."""

    type: Literal["arm_scenario"] = "arm_scenario"
    scenario_id: str
    overrides: dict = Field(default_factory=dict)


class CancelScenarioMessage(BaseModel):
    type: Literal["cancel_scenario"] = "cancel_scenario"


class AddFaultMessage(BaseModel):
    type: Literal["add_fault"] = "add_fault"
    fault: dict


class CancelFaultMessage(BaseModel):
    type: Literal["cancel_fault"] = "cancel_fault"
    fault_id: str


ClientMessage = Annotated[
    Union[
        ControlInputMessage,
        PauseMessage,
        ResumeMessage,
        ResetMessage,
        PongMessage,
        ArmScenarioMessage,
        CancelScenarioMessage,
        AddFaultMessage,
        CancelFaultMessage,
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
    "arm_scenario",
    "cancel_scenario",
    "add_fault",
    "cancel_fault",
}


class UpgradeSpec(BaseModel):
    id: Literal["brake_servicing", "comms_improvement", "local_fallback"]
    name: str
    price_cad: int
    parameter: str
    change: str
    params: dict[str, float]


class BudgetDefaults(BaseModel):
    cash_on_hand: float
    remaining_commitments: float
    reserve: float


class UpgradeOption(BaseModel):
    key: str
    label: str
    upgrades: UpgradeConfig
    cost_cad: int


class UpgradeCatalog(BaseModel):
    budget_defaults: BudgetDefaults
    upgrades: list[UpgradeSpec]
    configs: list[UpgradeOption]
