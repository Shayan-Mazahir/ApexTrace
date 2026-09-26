"""Shared Pydantic schemas. Mirrors frontend/src/types/schemas.ts — keep both in sync by hand."""

from typing import Literal

from pydantic import BaseModel

TrackId = Literal["monza", "baku"]


class HealthStatus(BaseModel):
    status: str
    service: str


class TrackProfile(BaseModel):
    id: TrackId
    name: str
    approach_length: float
    corner_radius: float
    corner_arc_degrees: float
    exit_length: float
    track_width: float
    centerline: list[tuple[float, float]]
    left_edge: list[tuple[float, float]]
    right_edge: list[tuple[float, float]]


class SessionCreateRequest(BaseModel):
    track: TrackId = "monza"


class SessionCreateResponse(BaseModel):
    session_id: str
    track_profile: TrackProfile


class SessionJoinRequest(BaseModel):
    role: Literal["driver", "engineer"] = "driver"


class SessionJoinResponse(BaseModel):
    session_id: str
    role: Literal["driver", "engineer"]
    track_profile: TrackProfile


class ControlInputMessage(BaseModel):
    type: Literal["control_input"] = "control_input"
    seq: int
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
    track_exit: bool
    completed: bool
