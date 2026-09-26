from __future__ import annotations

import json
import time
import uuid
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from app.budget import local_fallback_age_ms, persistent_brake_wear, warning_delay_scale
from app.placeholder_sim import (
    DemoVehicleState,
    distance_to_hazard,
    next_hazard_zone,
    sector_at,
    signed_clearance,
    step,
    warning_hazard,
    warning_reason,
    GRIP_ESTIMATE_LAG_S,
    advised_corner_speed,
)
from app.scenarios import SCENARIOS
from app.schemas import (
    CLIENT_MESSAGE_ADAPTER,
    DRIVER_MESSAGE_TYPES,
    ENGINEER_MESSAGE_TYPES,
    FaultState,
    ScenarioConfig,
    SessionRole,
    TrackProfile,
    UpgradeConfig,
)

TICK_HZ = 20
TICK_DT = 1 / TICK_HZ
MAX_MESSAGE_CHARS = 10_000
HISTORY_SECONDS = 2.0


def new_run_id() -> str:
    return uuid.uuid4().hex[:8]


def error_message(code: str, message: str) -> dict[str, Any]:
    return {"type": "error", "code": code, "message": message}


@dataclass
class Session:
    session_id: str
    track_profile: TrackProfile
    seed: int = 1
    upgrades: UpgradeConfig = field(default_factory=UpgradeConfig)
    run_id: str = field(default_factory=new_run_id)
    vehicle: DemoVehicleState = field(default_factory=DemoVehicleState)
    control: dict[str, float] = field(
        default_factory=lambda: {"steering": 0.0, "throttle": 0.0, "brake": 0.0}
    )
    running: bool = True
    last_control_received_at: float | None = None
    manual_faults: FaultState = field(default_factory=FaultState)
    scenario: ScenarioConfig | None = None
    clients: dict[Any, SessionRole] = field(default_factory=dict)
    engineer_ever_connected: bool = False
    last_active: float = field(default_factory=time.monotonic)
    start_time: float = field(default_factory=time.monotonic)
    outbox: list[dict[str, Any]] = field(default_factory=list)
    history: deque[tuple[float, float, float, float]] = field(
        default_factory=lambda: deque(maxlen=int(HISTORY_SECONDS * TICK_HZ))
    )
    warning_seq: int = 0
    warning_active: bool = False
    warning_hazard_id: str | None = None
    fault_signature: tuple | None = None
    loop_task: Any = None

    def touch(self, now: float | None = None) -> None:
        self.last_active = time.monotonic() if now is None else now

    def scenario_active(self) -> bool:
        if self.scenario is None:
            return False
        d = self.vehicle.distance_along_lap
        return self.scenario.onset_distance <= d < self.scenario.end_distance

    def effective_faults(self) -> FaultState:
        """Manual sliders combined with the scenario window (worst of each)."""
        manual = self.manual_faults
        if not self.scenario_active():
            return manual
        scen = self.scenario.faults  # type: ignore[union-attr]
        return FaultState(
            grip_multiplier=min(manual.grip_multiplier, scen.grip_multiplier),
            telemetry_delay_ms=max(manual.telemetry_delay_ms, scen.telemetry_delay_ms),
            brake_wear=min(manual.brake_wear, scen.brake_wear),
        )

    def session_info(self) -> dict[str, Any]:
        return {
            "type": "session_info",
            "session_id": self.session_id,
            "run_id": self.run_id,
            "seed": self.seed,
            "track": self.track_profile.id,
            "scenario_id": self.scenario.id if self.scenario else None,
            "upgrades": self.upgrades.model_dump(),
            "driver_connected": "driver" in self.clients.values(),
            "engineer_connected": "engineer" in self.clients.values(),
            "engineer_ever_connected": self.engineer_ever_connected,
        }

    def fault_state_message(self) -> dict[str, Any]:
        return {
            "type": "fault_state",
            "manual": self.manual_faults.model_dump(),
            "effective": self.effective_faults().model_dump(),
            "scenario_id": self.scenario.id if self.scenario else None,
            "scenario_active": self.scenario_active(),
            "distance_along_lap": self.vehicle.distance_along_lap,
            "t": time.monotonic() - self.start_time,
        }

    def queue_session_info(self) -> None:
        self.outbox.append(self.session_info())

    def reset_run(self) -> None:
        self.vehicle = DemoVehicleState()
        self.running = True
        self.run_id = new_run_id()
        self.history.clear()
        self.queue_session_info()

    def launch_scenario(self, scenario: ScenarioConfig) -> None:
        self.scenario = scenario
        self.seed = scenario.seed
        self.reset_run()

    def _sample_at(self, target: float) -> tuple[float, float, float]:
        """(distance, speed, grip) from the newest history entry at or before
        `target`; the oldest entry if `target` predates the history."""
        if not self.history:
            return (
                self.vehicle.distance_along_lap,
                self.vehicle.speed,
                self.effective_faults().grip_multiplier,
            )
        sample = self.history[0][1:]
        for t, distance, speed, grip in self.history:
            if t > target:
                break
            sample = (distance, speed, grip)
        return sample

    def _delayed_sample(self, now: float, delay_ms: float) -> tuple[float, float, float]:
        """(distance, speed, estimated grip) as the warning path sees them:
        `delay_ms` old, with the grip estimate trailing by another lag."""
        if delay_ms <= 0:
            distance, speed, _ = self._sample_at(now)
        else:
            distance, speed, _ = self._sample_at(now - delay_ms / 1000)
        _, _, grip_estimate = self._sample_at(now - delay_ms / 1000 - GRIP_ESTIMATE_LAG_S)
        return distance, speed, grip_estimate

    def warning_path(self, faults: FaultState) -> tuple[float, bool]:
        """(delay in ms actually on the warning path, local fallback active).
        The comms upgrade scales the injected delay; the local fallback
        bypasses the remote path once its data is older than the threshold."""
        delay_ms = faults.telemetry_delay_ms * warning_delay_scale(self.upgrades)
        threshold = local_fallback_age_ms(self.upgrades)
        if threshold is not None and delay_ms > threshold:
            return 0.0, True
        return delay_ms, False

    def tick(self, now: float | None = None, dt: float = TICK_DT) -> list[dict[str, Any]]:
        """Advance one simulation step; returns messages to broadcast."""
        now = time.monotonic() if now is None else now
        faults = self.effective_faults()
        if self.running:
            self.vehicle = step(
                self.vehicle,
                self.control["steering"],
                self.control["throttle"],
                self.control["brake"],
                dt,
                self.track_profile,
                grip=faults.grip_multiplier,
                brake_wear=persistent_brake_wear(self.upgrades) * faults.brake_wear,
            )
        self.history.append((now, self.vehicle.distance_along_lap, self.vehicle.speed, faults.grip_multiplier))

        messages, self.outbox = self.outbox, []

        # Recomputed after the step so a scenario window edge is seen this tick.
        faults = self.effective_faults()
        signature = (faults, self.scenario.id if self.scenario else None, self.scenario_active())
        if signature != self.fault_signature:
            self.fault_signature = signature
            messages.append(self.fault_state_message())

        path_delay_ms, fallback_active = self.warning_path(faults)
        delayed_distance, delayed_speed, grip_estimate = self._delayed_sample(now, path_delay_ms)
        hazard = warning_hazard(delayed_distance, self.track_profile, delayed_speed, grip_estimate)
        hazard_id = hazard.id if hazard else None
        active = hazard is not None
        if active != self.warning_active or hazard_id != self.warning_hazard_id:
            self.warning_active = active
            self.warning_hazard_id = hazard_id
            self.warning_seq += 1
            messages.append(
                {
                    "type": "warning_event",
                    "seq": self.warning_seq,
                    "active": active,
                    "reason": f"Approaching {hazard.label}" if hazard else None,
                    "hazard_zone": hazard.label if hazard else None,
                    "hazard_id": hazard_id,
                    "advised_speed": advised_corner_speed(hazard, grip_estimate) if hazard else None,
                    "source_t": now - self.start_time,
                }
            )

        messages.append(
            self._vehicle_state_message(
                now,
                faults,
                delayed_distance,
                delayed_speed,
                grip_estimate,
                path_delay_ms,
                fallback_active,
            )
        )
        return messages

    def _vehicle_state_message(
        self,
        now: float,
        faults: FaultState,
        delayed_distance: float,
        delayed_speed: float,
        grip_estimate: float,
        path_delay_ms: float,
        fallback_active: bool,
    ) -> dict[str, Any]:
        vehicle = self.vehicle
        profile = self.track_profile
        sector = sector_at(vehicle.distance_along_lap, profile)
        hazard = next_hazard_zone(vehicle.distance_along_lap, profile)

        packet_age_ms = 0.0
        if self.last_control_received_at is not None:
            packet_age_ms = max(0.0, (now - self.last_control_received_at) * 1000)

        return {
            "type": "vehicle_state",
            "seq": vehicle.seq,
            "t": now - self.start_time,
            "x": vehicle.x,
            "y": vehicle.y,
            "heading": vehicle.heading,
            "speed": vehicle.speed,
            "lap_progress": (vehicle.distance_along_lap % profile.total_length)
            / profile.total_length,
            "sector_index": sector.index,
            "sector_name": sector.name,
            "distance_along_lap": vehicle.distance_along_lap,
            "next_hazard_zone": hazard.label if hazard else None,
            "next_hazard_distance": distance_to_hazard(vehicle.distance_along_lap, hazard, profile)
            if hazard
            else None,
            "signed_clearance": signed_clearance(
                vehicle.x, vehicle.y, profile, hint=vehicle.nearest_point_index
            ),
            "packet_age_ms": packet_age_ms,
            "injected_delay_ms": faults.telemetry_delay_ms,
            "warning_path_delay_ms": path_delay_ms,
            "local_fallback_active": fallback_active,
            "warning_reason": warning_reason(delayed_distance, profile, delayed_speed, grip_estimate),
            "track_exit": vehicle.track_exit,
            "lap_complete": vehicle.lap_complete,
        }


def apply_message(session: Session, role: SessionRole, message: Any) -> list[dict[str, Any]]:
    """Applies one validated client message. Returns direct replies to the sender."""
    allowed = DRIVER_MESSAGE_TYPES if role == "driver" else ENGINEER_MESSAGE_TYPES
    if message.type not in allowed:
        return [error_message("forbidden", f"{role} cannot send {message.type!r}")]

    if message.type == "control_input":
        session.control["steering"] = max(-1.0, min(1.0, message.steering))
        session.control["throttle"] = max(0.0, min(1.0, message.throttle))
        session.control["brake"] = max(0.0, min(1.0, message.brake))
        session.last_control_received_at = time.monotonic()
    elif message.type == "pause":
        session.running = False
    elif message.type == "resume":
        session.running = True
    elif message.type == "reset":
        session.reset_run()
    elif message.type == "set_faults":
        session.manual_faults = message.faults
    elif message.type == "launch_scenario":
        scenario = SCENARIOS.get(message.scenario_id)
        if scenario is None:
            return [error_message("unknown_scenario", f"no scenario {message.scenario_id!r}")]
        if scenario.track != session.track_profile.id:
            return [
                error_message(
                    "scenario_track_mismatch",
                    f"scenario is for {scenario.track}, session is {session.track_profile.id}",
                )
            ]
        session.launch_scenario(scenario)
    elif message.type == "clear_scenario":
        session.scenario = None
        session.queue_session_info()
    return []


def handle_raw_message(session: Session, role: SessionRole, text: str) -> list[dict[str, Any]]:
    """Parses + validates untrusted client text. Never raises."""
    if len(text) > MAX_MESSAGE_CHARS:
        return [error_message("too_large", "message too large")]
    try:
        data = json.loads(text)
    except ValueError:
        return [error_message("invalid_json", "message is not valid JSON")]
    try:
        message = CLIENT_MESSAGE_ADAPTER.validate_python(data)
    except ValidationError as exc:
        first = exc.errors()[0]
        location = ".".join(str(p) for p in first["loc"])
        return [error_message("invalid_message", f"{location}: {first['msg']}")]
    return apply_message(session, role, message)
