"""Shared Pydantic schemas. Mirrors frontend/src/types/schemas.ts — keep both in sync by hand."""

from typing import Literal

from pydantic import BaseModel

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
    track_profile: TrackProfile


class SessionJoinRequest(BaseModel):
    role: SessionRole = "engineer"


class SessionJoinResponse(BaseModel):
    session_id: str
    role: SessionRole
    track_profile: TrackProfile


class ControlInputMessage(BaseModel):
    type: Literal["control_input"] = "control_input"
    seq: int
    session_id: str
    track: TrackId
    seed: int
    t_client: float
    steering: float
    throttle: float
    brake: float


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
    warning_reason: str | None
    track_exit: bool
    lap_complete: bool
