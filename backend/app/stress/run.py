"""
One stress-test run: the true world plus every pipeline layer plus the
evaluator. Live sessions, headless evaluation, dataset generation and RL all
drive this same object, so a scenario behaves identically everywhere.
"""

from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Any

from app.placeholder_sim import (
    BRAKE_DECEL,
    DemoVehicleState,
    distance_to_hazard,
    initial_state,
    next_hazard_zone,
    sector_at,
    signed_clearance,
    signed_lateral,
    state_at_distance,
    step,
)
from app.schemas import TrackProfile, UpgradeConfig
from app.stress.pipeline import (
    Actuators,
    Decision,
    DriverDisplay,
    Effective,
    Evaluator,
    Link,
    Sensors,
    WarningService,
    resolve,
)
from app.stress.scheduler import FaultScheduler
from app.stress.spec import FaultSpec, StressScenario, VehicleConfig, WarningPolicyConfig

TICK_DT = 0.05
COMMS_DELAY_SCALE = 0.4  # comms upgrade: declared improvement on the same disturbance
COMMS_LOSS_SCALE = 0.5


@dataclass
class RunConfig:
    profile: TrackProfile
    scenario: StressScenario | None = None
    upgrades: UpgradeConfig = field(default_factory=UpgradeConfig)
    policy: WarningPolicyConfig = field(default_factory=WarningPolicyConfig)
    vehicle: VehicleConfig = field(default_factory=VehicleConfig)
    seed: int = 1

    def effective_policy(self) -> WarningPolicyConfig:
        return self.policy.model_copy(update={"local_fallback": self.policy.local_fallback or self.upgrades.local_fallback})

    def brake_wear(self) -> float:
        return 1.0 if self.upgrades.brake_servicing else self.vehicle.brake_wear


@dataclass
class StressRun:
    config: RunConfig
    t: float = 0.0
    vehicle: DemoVehicleState = field(init=False)
    scheduler: FaultScheduler = field(init=False)
    events: list[dict[str, Any]] = field(default_factory=list)
    effective: Effective = field(default_factory=Effective)

    def __post_init__(self) -> None:
        cfg = self.config
        profile = cfg.profile
        scenario = cfg.scenario
        seed = scenario.seed if scenario else cfg.seed
        self.seed = seed
        start = scenario.start if scenario else None
        if start and (start.distance_m or start.speed_ms or start.lateral_offset_m or start.heading_error_rad):
            self.vehicle = state_at_distance(profile, start.distance_m, start.speed_ms, start.lateral_offset_m,
                                             start.heading_error_rad)
        else:
            self.vehicle = initial_state(profile)
        self.start_distance = self.vehicle.distance_along_lap
        self.scheduler = FaultScheduler.from_specs(profile, scenario.faults if scenario else [])
        self.policy = cfg.effective_policy()
        self.actuators = Actuators()
        self.sensors = Sensors(profile, seed)
        self.sensors.grip_estimate = 1.0
        self.uplink = Link(seed * 31 + 1)
        self.downlink = Link(seed * 31 + 2)
        self.remote = WarningService(profile, self.policy, "remote")
        self.local = WarningService(profile, self.policy, "local")
        self.display = DriverDisplay(self.policy)
        self.evaluator = Evaluator(profile)
        self.was_blackout = False
        self.blackout_release_ms = 0.0
        self.shown_key: tuple | None = None
        self.warning_seq = 0
        self.last_packet = None
        self.last_local: Decision | None = None
        self.last_controls = (0.0, 0.0, 0.0)
        self.applied = (0.0, 0.0)

    # -- faults -----------------------------------------------------------

    def add_fault(self, spec: FaultSpec) -> None:
        self.scheduler.add(spec)

    def cancel_faults(self, fault_id: str | None = None) -> list[dict[str, Any]]:
        events = self.scheduler.cancel(fault_id, self.t, self.vehicle.distance_along_lap)
        self.events.extend(events)
        return events

    # -- one tick ------------------------------------------------------------

    def tick(self, steering: float, throttle: float, brake: float, dt: float = TICK_DT, advance: bool = True) -> list[dict[str, Any]]:
        """Advance the run by dt. Returns new events (fault / warning)."""
        cfg, profile = self.config, self.config.profile
        new_events: list[dict[str, Any]] = []
        if advance:
            self.t += dt
        t = self.t
        v = self.vehicle

        new_events += self.scheduler.update(t, dt, v.distance_along_lap,
                                            v.laps_completed, v.speed)
        comms = cfg.upgrades.comms_improvement
        e = resolve(self.scheduler, COMMS_DELAY_SCALE if comms else 1.0, COMMS_LOSS_SCALE if comms else 1.0)
        self.effective = e

        # actual world: actuators then vehicle dynamics
        self.last_controls = (steering, throttle, brake)
        if advance:
            steer_eff, brake_eff = self.actuators.apply(t, steering, brake, e)
            self.applied = (steer_eff, brake_eff)
            self.vehicle = step(v, steer_eff, throttle, brake_eff, dt, profile,
                                grip=e.grip, brake_wear=cfg.brake_wear() * e.brake_fade)
            v = self.vehicle
            self.sensors.estimate(e.grip, dt, e)

        # sensors -> uplink -> remote service
        lateral = signed_lateral(v.x, v.y, v.nearest_point_index, profile)
        packet = self.sensors.sample(t, v, lateral, e) if advance else None
        if e.blackout:
            self.blackout_release_ms = e.release_delay_ms  # remember: the fault is gone once it ends
        if self.was_blackout and not e.blackout:
            self.uplink.end_blackout(t, e.uplink_delay_ms, self.blackout_release_ms)
        self.was_blackout = e.blackout
        if packet is not None:
            self.last_packet = packet
            self.uplink.send(t, packet, e.uplink_delay_ms, e.uplink_jitter_ms, e.uplink_loss,
                             e.blackout, e.release_buffer, e.release_delay_ms)
            self.local.receive(packet)  # onboard: same sensors, no link
        for pkt in self.uplink.deliver(t):
            self.remote.receive(pkt)

        # remote decision -> compute delay + downlink -> display
        decision = self.remote.decide(t)
        self.downlink.send(t, decision, e.downlink_delay_ms + e.compute_delay_ms, 0.0, e.downlink_loss)
        for d in self.downlink.deliver(t):
            self.display.receive_remote(d, t)
        local = self.local.decide(t) if self.policy.local_fallback else None
        self.last_local = local
        shown = self.display.resolve(t, local)

        # evaluator: ground truth
        ev = self.evaluator
        clearance = signed_clearance(v.x, v.y, profile, hint=v.nearest_point_index)
        ev.min_clearance = min(ev.min_clearance, clearance)
        if v.track_exit and ev.exit_t is None:
            ev.exit_t, ev.exit_distance = t, v.distance_along_lap
            new_events.append({"type": "run_event", "event": "track_exit", "t": round(t, 3),
                               "distance": round(v.distance_along_lap, 1), "location": ev.exit_location()})
        if shown is not None and shown.state in ("stale", "no_data"):
            ev.stale_time_s += dt
        if e.blackout:
            ev.blackout_time_s += dt
        if self.display.fallback_active and ev.fallback_first_t is None:
            ev.fallback_first_t = t
        if self.applied[1] > 0.5 and ev.first_brake_t is None:
            ev.first_brake_t = t

        # warning display changes
        key = None if shown is None else (shown.state, shown.hazard_id, shown.source)
        if key != self.shown_key:
            self.shown_key = key
            self.warning_seq += 1
            true_decel = min(BRAKE_DECEL * cfg.brake_wear() * e.brake_fade * e.brake_cap, e.grip * BRAKE_DECEL)
            if shown is not None and shown.state == "brake":
                ev.warning_displayed(t, shown, v, e.grip, true_decel)
            new_events.append(self.warning_event(shown))

        self.events.extend(new_events)
        return new_events

    def warning_event(self, shown: Decision | None) -> dict[str, Any]:
        return {
            "type": "warning_event",
            "seq": self.warning_seq,
            "active": shown is not None and shown.state == "brake",
            "state": "clear" if shown is None else shown.state,
            "reason": None if shown is None else shown.reason,
            "hazard_zone": None if shown is None else shown.hazard_label,
            "hazard_id": None if shown is None else shown.hazard_id,
            "advised_speed": None if shown is None else shown.advised_speed,
            "source": None if shown is None else shown.source,
            "data_age_ms": None if shown is None or shown.data_age_ms is None else round(shown.data_age_ms, 1),
            "generated_t": None if shown is None else round(shown.generated_t, 3),
            "displayed_t": round(self.t, 3),
            "source_t": round(self.t, 3),
        }

    # -- views --------------------------------------------------------------

    def observation(self) -> dict[str, Any]:
        """What the car has observed (declared channels only) — the TCN's input."""
        p = self.last_packet
        e = self.effective
        profile = self.config.profile
        speed = p.channels["speed"][0] if p else 0.0
        position = p.channels["position"][0] if p else 0.0
        grip = p.channels["grip"][0] if p else 1.0
        h = next_hazard_zone(position, profile)
        shown = self.display.shown
        return {
            "speed": speed,
            "steering": self.last_controls[0],
            "brake": self.last_controls[2],
            "throttle": self.last_controls[1],
            "yaw_rate": p.yaw_rate if p else 0.0,
            "lateral": p.lateral if p else 0.0,
            "distance_to_corner": distance_to_hazard(position, h, profile) if h else 2000.0,
            "grip_estimate": grip,
            "packet_age_ms": self.remote.data_age_ms(self.t) or 0.0,
            "warning": 0.0 if shown is None or shown.state == "clear" else (1.0 if shown.state == "brake" else 2.0),
            "_effective": e,
        }

    def summary(self) -> dict[str, Any]:
        v, ev = self.vehicle, self.evaluator
        return {
            "track_exit": v.track_exit,
            "lap_complete": v.lap_complete,
            "exit_location": ev.exit_location(),
            "exit_t": ev.exit_t,
            "min_clearance_m": round(ev.min_clearance, 3) if math.isfinite(ev.min_clearance) else None,
            "warnings": ev.warnings,
            "unnecessary_warnings": ev.unnecessary,
            "stale_time_s": round(ev.stale_time_s, 2),
            "blackout_time_s": round(ev.blackout_time_s, 2),
            "fallback_first_t": ev.fallback_first_t,
            "first_brake_t": ev.first_brake_t,
            "packets_rejected_old": self.remote.rejected_old,
            "uplink_dropped": self.uplink.dropped,
            "uplink_blacked_out": self.uplink.blacked_out,
            "downlink_dropped": self.downlink.dropped,
            "barrier_contacts": getattr(v, "barrier_contacts", 0),
            "lap_time_s": v.last_lap_time,
            "sim_time_s": round(self.t, 2),
        }

    def telemetry(self) -> dict[str, Any]:
        """Per-tick fields the live UI shows (true state is fine here: this is
        for the driver's HUD/engineer, not an input to the safety system)."""
        v, profile, e = self.vehicle, self.config.profile, self.effective
        sector = sector_at(v.distance_along_lap, profile)
        hazard = next_hazard_zone(v.distance_along_lap, profile)
        shown = self.display.shown
        return {
            "sector_index": sector.index,
            "sector_name": sector.name,
            "next_hazard_zone": hazard.label if hazard else None,
            "next_hazard_distance": distance_to_hazard(v.distance_along_lap, hazard, profile) if hazard else None,
            "signed_clearance": signed_clearance(v.x, v.y, profile, hint=v.nearest_point_index),
            "sample_age_ms": self.remote.data_age_ms(self.t),
            "injected_delay_ms": e.uplink_delay_ms,
            "warning_path_delay_ms": e.uplink_delay_ms,
            "warning_delivery_delay_ms": e.downlink_delay_ms + e.compute_delay_ms,
            "blackout": e.blackout,
            "local_fallback_active": self.display.fallback_active,
            "warning_reason": None if shown is None or shown.state == "clear" else shown.reason,
            "warning_state": "clear" if shown is None else shown.state,
            "true_grip": e.grip,
            "estimated_grip": self.sensors.grip_estimate,
        }
