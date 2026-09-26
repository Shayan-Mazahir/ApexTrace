from __future__ import annotations

import json
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from pydantic import ValidationError

from app.placeholder_sim import DemoVehicleState
from app.schemas import (
    CLIENT_MESSAGE_ADAPTER,
    DRIVER_MESSAGE_TYPES,
    ENGINEER_MESSAGE_TYPES,
    SessionRole,
    TrackProfile,
    UpgradeConfig,
)
from app.stress.run import TICK_DT, RunConfig, StressRun
from app.stress.spec import FaultSpec, StressScenario

MAX_MESSAGE_CHARS = 20_000
TICK_HZ = round(1 / TICK_DT)


def new_run_id() -> str:
    return uuid.uuid4().hex[:8]


def error_message(code: str, message: str) -> dict[str, Any]:
    return {"type": "error", "code": code, "message": message}


@dataclass
class Session:
    """A live driving session. All physics, faults and warnings live in the
    StressRun (the same engine the headless evaluation uses)."""

    session_id: str
    track_profile: TrackProfile
    seed: int = 1
    upgrades: UpgradeConfig = field(default_factory=UpgradeConfig)
    run_id: str = field(default_factory=new_run_id)
    scenario: StressScenario | None = None
    manual_faults: list[FaultSpec] = field(default_factory=list)
    control: dict[str, float] = field(
        default_factory=lambda: {"steering": 0.0, "throttle": 0.0, "brake": 0.0}
    )
    running: bool = True
    last_control_received_at: float | None = None
    clients: dict[Any, SessionRole] = field(default_factory=dict)
    engineer_ever_connected: bool = False
    last_active: float = field(default_factory=time.monotonic)
    start_time: float = field(default_factory=time.monotonic)
    outbox: list[dict[str, Any]] = field(default_factory=list)
    fault_signature: tuple | None = None
    loop_task: Any = None
    run: StressRun = field(init=False)

    def __post_init__(self) -> None:
        self.build_run()

    # -- run lifecycle -------------------------------------------------------

    def build_run(self) -> None:
        self.run = StressRun(RunConfig(
            profile=self.track_profile,
            scenario=self.scenario,
            upgrades=self.upgrades,
            seed=self.scenario.seed if self.scenario else self.seed,
        ))
        for spec in self.manual_faults:
            self.run.add_fault(spec)
        self.fault_signature = None

    @property
    def vehicle(self) -> DemoVehicleState:
        return self.run.vehicle

    @vehicle.setter
    def vehicle(self, value: DemoVehicleState) -> None:
        self.run.vehicle = value

    def touch(self, now: float | None = None) -> None:
        self.last_active = time.monotonic() if now is None else now

    def reset_run(self) -> None:
        """Back to the start: fresh vehicle, empty packet queues, fault states
        and lap state; the same scenario and manual faults re-armed."""
        self.running = True
        self.run_id = new_run_id()
        self.build_run()
        self.queue_session_info()

    def arm_scenario(self, scenario: StressScenario) -> None:
        self.scenario = scenario
        self.seed = scenario.seed
        self.manual_faults = []
        self.reset_run()

    def cancel_scenario(self) -> None:
        if self.scenario:
            for f in self.scenario.faults:
                self.outbox.extend(self.run.cancel_faults(f.id))
        self.scenario = None
        self.fault_signature = None
        self.queue_session_info()

    def add_fault(self, spec: FaultSpec) -> None:
        self.manual_faults = [f for f in self.manual_faults if f.id != spec.id] + [spec]
        self.run.add_fault(spec)
        self.fault_signature = None

    def cancel_fault(self, fault_id: str) -> None:
        self.manual_faults = [f for f in self.manual_faults if f.id != fault_id]
        self.outbox.extend(self.run.cancel_faults(fault_id))
        self.fault_signature = None

    # -- messages --------------------------------------------------------------

    def session_info(self) -> dict[str, Any]:
        return {
            "type": "session_info",
            "session_id": self.session_id,
            "run_id": self.run_id,
            "seed": self.run.seed,
            "track": self.track_profile.id,
            "scenario_id": self.scenario.id if self.scenario else None,
            "scenario_name": self.scenario.name if self.scenario else None,
            "upgrades": self.upgrades.model_dump(),
            "driver_connected": "driver" in self.clients.values(),
            "engineer_connected": "engineer" in self.clients.values(),
            "engineer_ever_connected": self.engineer_ever_connected,
        }

    def fault_state_message(self) -> dict[str, Any]:
        run = self.run
        return {
            "type": "fault_state",
            "faults": run.scheduler.summary(run.vehicle.distance_along_lap),
            "effective": run.effective.as_dict(),
            "scenario_id": self.scenario.id if self.scenario else None,
            "distance_along_lap": run.vehicle.distance_along_lap,
            "t": round(run.t, 3),
        }

    def queue_session_info(self) -> None:
        self.outbox.append(self.session_info())

    def tick(self, now: float | None = None, dt: float = TICK_DT) -> list[dict[str, Any]]:
        """Advance one simulation step; returns messages to broadcast."""
        now = time.monotonic() if now is None else now
        c = self.control
        events = self.run.tick(c["steering"], c["throttle"], c["brake"], dt, advance=self.running)
        messages, self.outbox = self.outbox, []
        messages.extend(events)

        summary = self.run.scheduler.summary(self.run.vehicle.distance_along_lap)
        signature = tuple((f["id"], f["state"], round(f["level"], 1)) for f in summary)
        if signature != self.fault_signature:
            self.fault_signature = signature
            messages.append(self.fault_state_message())

        messages.append(self._vehicle_state_message(now))
        return messages

    def _vehicle_state_message(self, now: float) -> dict[str, Any]:
        run, vehicle, profile = self.run, self.run.vehicle, self.track_profile
        # measured, real: age of the last control message from the driver's device
        control_age_ms = 0.0
        if self.last_control_received_at is not None:
            control_age_ms = max(0.0, (now - self.last_control_received_at) * 1000)
        tel = run.telemetry()
        return {
            "type": "vehicle_state",
            "seq": vehicle.seq,
            "t": round(run.t, 3),
            "x": vehicle.x,
            "y": vehicle.y,
            "heading": vehicle.heading,
            "speed": vehicle.speed,
            "lap_progress": (vehicle.distance_along_lap % profile.total_length) / profile.total_length,
            "distance_along_lap": vehicle.distance_along_lap,
            "packet_age_ms": control_age_ms,
            "track_exit": vehicle.track_exit,
            "lap_complete": vehicle.lap_complete,
            "off_track": vehicle.off_track,
            "track_exits": vehicle.track_exits,
            "barrier_contacts": vehicle.barrier_contacts,
            "lap": vehicle.laps_completed + 1,
            "laps_completed": vehicle.laps_completed,
            "lap_time_s": vehicle.lap_time,
            "last_lap_s": vehicle.last_lap_time,
            "best_lap_s": vehicle.best_lap_time,
            **tel,
        }


def apply_message(session: Session, role: SessionRole, message: Any) -> list[dict[str, Any]]:
    """Applies one validated client message. Returns direct replies to the sender."""
    from app.scenarios import SCENARIOS, ScenarioOverrides, apply_overrides

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
    elif message.type == "arm_scenario":
        scenario = SCENARIOS.get(message.scenario_id)
        if scenario is None:
            return [error_message("unknown_scenario", f"no scenario {message.scenario_id!r}")]
        if scenario.track != session.track_profile.id:
            return [error_message("scenario_track_mismatch",
                                  f"scenario is for {scenario.track}, session is {session.track_profile.id}")]
        try:
            overrides = ScenarioOverrides.model_validate(message.overrides)
        except ValidationError as exc:
            return [error_message("invalid_overrides", exc.errors()[0]["msg"])]
        if overrides.zone_id and overrides.zone_id not in {h.id for h in session.track_profile.hazard_zones}:
            return [error_message("unknown_zone", f"no zone {overrides.zone_id!r} on this track")]
        session.arm_scenario(apply_overrides(scenario, overrides))
    elif message.type == "cancel_scenario":
        session.cancel_scenario()
    elif message.type == "add_fault":
        try:
            spec = FaultSpec.model_validate({**message.fault, "source": message.fault.get("source", "manual")})
        except ValidationError as exc:
            return [error_message("invalid_fault", exc.errors()[0]["msg"])]
        if spec.trigger.kind == "zone" and spec.trigger.zone_id not in {h.id for h in session.track_profile.hazard_zones}:
            return [error_message("unknown_zone", f"no zone {spec.trigger.zone_id!r} on this track")]
        session.add_fault(spec)
    elif message.type == "cancel_fault":
        session.cancel_fault(message.fault_id)
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
    try:
        return apply_message(session, role, message)
    except Exception as exc:  # a bad command must never take the session down
        return [error_message("command_failed", str(exc)[:200])]
