from __future__ import annotations

import asyncio
import time
import uuid
from dataclasses import dataclass, field

from fastapi import APIRouter, HTTPException, WebSocket
from starlette.websockets import WebSocketDisconnect

from app.placeholder_sim import (
    TRACK_PRESETS,
    DemoVehicleState,
    distance_to_hazard,
    next_hazard_zone,
    sector_at,
    signed_clearance,
    step,
    warning_reason,
)
from app.schemas import (
    SessionCreateRequest,
    SessionCreateResponse,
    SessionJoinRequest,
    SessionJoinResponse,
    TrackId,
    TrackProfile,
    TrackProfileSummary,
)

TICK_HZ = 20
TICK_DT = 1 / TICK_HZ


@dataclass
class Session:
    session_id: str
    track_profile: TrackProfile
    vehicle: DemoVehicleState = field(default_factory=DemoVehicleState)
    control: dict[str, float] = field(
        default_factory=lambda: {"steering": 0.0, "throttle": 0.0, "brake": 0.0}
    )
    running: bool = True
    last_control_received_at: float | None = None


SESSIONS: dict[str, Session] = {}

router = APIRouter()


def apply_client_message(session: Session, message: dict) -> None:
    """Mutates session state from one decoded client WS message. Pulled out
    of the socket handler so it's testable without asyncio/timing."""
    msg_type = message.get("type")
    if msg_type == "control_input":
        session.control["steering"] = max(-1.0, min(1.0, float(message.get("steering", 0.0))))
        session.control["throttle"] = max(0.0, min(1.0, float(message.get("throttle", 0.0))))
        session.control["brake"] = max(0.0, min(1.0, float(message.get("brake", 0.0))))
        session.last_control_received_at = time.monotonic()
    elif msg_type == "pause":
        session.running = False
    elif msg_type == "resume":
        session.running = True
    elif msg_type == "reset":
        session.vehicle = DemoVehicleState()
        session.running = True


@router.get("/tracks", response_model=list[TrackProfileSummary])
def list_tracks() -> list[TrackProfileSummary]:
    return [
        TrackProfileSummary(
            id=profile.id,
            name=profile.name,
            total_length=profile.total_length,
            track_width=profile.track_width,
            sector_count=len(profile.sectors),
            hazard_zone_count=len(profile.hazard_zones),
        )
        for profile in TRACK_PRESETS.values()
    ]


@router.get("/tracks/{track_id}", response_model=TrackProfile)
def get_track(track_id: TrackId) -> TrackProfile:
    return TRACK_PRESETS[track_id]


@router.post("/sessions", response_model=SessionCreateResponse)
def create_session(body: SessionCreateRequest) -> SessionCreateResponse:
    track_profile = TRACK_PRESETS[body.track]
    session_id = uuid.uuid4().hex[:8]
    SESSIONS[session_id] = Session(session_id=session_id, track_profile=track_profile)
    return SessionCreateResponse(session_id=session_id, role=body.role, track_profile=track_profile)


@router.post("/sessions/{session_id}/join", response_model=SessionJoinResponse)
def join_session(session_id: str, body: SessionJoinRequest) -> SessionJoinResponse:
    session = SESSIONS.get(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="session not found")
    return SessionJoinResponse(
        session_id=session_id, role=body.role, track_profile=session.track_profile
    )


def _build_vehicle_state_message(session: Session, start_time: float) -> dict:
    vehicle = session.vehicle
    profile = session.track_profile
    sector = sector_at(vehicle.distance_along_lap, profile)
    hazard = next_hazard_zone(vehicle.distance_along_lap, profile)

    packet_age_ms = 0.0
    if session.last_control_received_at is not None:
        packet_age_ms = max(0.0, (time.monotonic() - session.last_control_received_at) * 1000)

    return {
        "type": "vehicle_state",
        "seq": vehicle.seq,
        "t": time.monotonic() - start_time,
        "x": vehicle.x,
        "y": vehicle.y,
        "heading": vehicle.heading,
        "speed": vehicle.speed,
        "lap_progress": (vehicle.distance_along_lap % profile.total_length) / profile.total_length,
        "sector_index": sector.index,
        "sector_name": sector.name,
        "distance_along_lap": vehicle.distance_along_lap,
        "next_hazard_zone": hazard.label if hazard else None,
        "next_hazard_distance": distance_to_hazard(vehicle.distance_along_lap, hazard, profile)
        if hazard
        else None,
        "signed_clearance": signed_clearance(vehicle.x, vehicle.y, profile),
        "packet_age_ms": packet_age_ms,
        "warning_reason": warning_reason(vehicle.distance_along_lap, profile),
        "track_exit": vehicle.track_exit,
        "lap_complete": vehicle.lap_complete,
    }


@router.websocket("/ws/driver/{session_id}")
async def driver_ws(websocket: WebSocket, session_id: str) -> None:
    session = SESSIONS.get(session_id)
    if session is None:
        await websocket.close(code=4404)
        return

    await websocket.accept()
    start_time = time.monotonic()

    async def broadcast_loop() -> None:
        try:
            while True:
                await asyncio.sleep(TICK_DT)
                if session.running:
                    session.vehicle = step(
                        session.vehicle,
                        session.control["steering"],
                        session.control["throttle"],
                        session.control["brake"],
                        TICK_DT,
                        session.track_profile,
                    )
                await websocket.send_json(_build_vehicle_state_message(session, start_time))
        except (WebSocketDisconnect, RuntimeError):
            pass

    loop_task = asyncio.create_task(broadcast_loop())
    try:
        while True:
            message = await websocket.receive_json()
            apply_client_message(session, message)
    except WebSocketDisconnect:
        pass
    finally:
        loop_task.cancel()
        try:
            await loop_task
        except asyncio.CancelledError:
            pass
