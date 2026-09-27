"""When is each fault on? Triggers, ramps, repeat rules and lifecycle events."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

from app.schemas import TrackProfile
from app.stress.spec import FaultSpec

FaultState = Literal["pending", "active", "waiting", "completed", "cancelled"]


@dataclass
class FaultRuntime:
    spec: FaultSpec
    state: FaultState = "pending"
    level: float = 0.0  # 0..1 after ramps
    on: bool = False  # trigger condition (before ramps)
    on_since: float | None = None
    activated_at: float | None = None
    fired_in_lap: int | None = None
    fired_once: bool = False
    activations: int = 0


@dataclass
class FaultScheduler:
    profile: TrackProfile
    faults: list[FaultRuntime] = field(default_factory=list)

    @classmethod
    def from_specs(cls, profile: TrackProfile, specs: list[FaultSpec]) -> "FaultScheduler":
        return cls(profile, [FaultRuntime(spec=s) for s in specs if s.enabled])

    def add(self, spec: FaultSpec) -> None:
        self.faults = [f for f in self.faults if f.spec.id != spec.id]
        if spec.enabled:
            self.faults.append(FaultRuntime(spec=spec))

    def cancel(self, fault_id: str | None, t: float, distance: float) -> list[dict[str, Any]]:
        events = []
        for f in self.faults:
            if (fault_id is None or f.spec.id == fault_id) and f.state not in ("completed", "cancelled"):
                if f.level > 0:
                    events.append(self._event("fault_deactivated", f, t, distance, reason="cancelled"))
                f.state, f.level, f.on = "cancelled", 0.0, False
                events.append(self._event("fault_cancelled", f, t, distance))
        return events

    def _condition(self, f: FaultRuntime, t: float, lap_distance: float, speed: float) -> bool:
        tr = f.spec.trigger
        total = self.profile.total_length
        if tr.kind == "always":
            return True
        if tr.kind == "time":
            return t >= tr.start and (tr.end is None or t < tr.end)
        if tr.kind == "distance":
            end = total if tr.end is None else tr.end
            return tr.start <= lap_distance < end
        if tr.kind == "zone":
            zone = next((h for h in self.profile.hazard_zones if h.id == tr.zone_id), None)
            if zone is None:
                return False
            start = zone.start_distance - tr.pad_m
            if start >= 0:
                return start <= lap_distance < zone.end_distance
            return lap_distance >= start % total or lap_distance < zone.end_distance
        if tr.kind == "speed_above":
            return speed > tr.start
        return False

    def update(self, t: float, dt: float, distance_along_lap: float, lap: int, speed: float) -> list[dict[str, Any]]:
        """Advance every fault one tick. `lap` is 0-based completed laps."""
        events: list[dict[str, Any]] = []
        lap_distance = distance_along_lap % self.profile.total_length
        for f in self.faults:
            if f.state in ("completed", "cancelled"):
                continue
            spec = f.spec
            repeat = spec.trigger.repeat
            may_fire = not (
                (repeat == "once_per_run" and f.fired_once and not f.on)
                or (repeat == "once_per_lap" and f.fired_in_lap == lap and not f.on)
            )
            cond = may_fire and self._condition(f, t, lap_distance, speed)
            if cond and spec.duration_s is not None and f.on_since is not None and t - f.on_since >= spec.duration_s:
                cond = False  # duration cap reached for this activation
            if cond and not f.on:
                f.on, f.on_since = True, t
                f.fired_once, f.fired_in_lap = True, lap
            elif not cond and f.on:
                f.on, f.on_since = False, None

            target = 1.0 if f.on else 0.0
            ramp = spec.ramp_in_s if target > f.level else spec.ramp_out_s
            before = f.level
            if ramp <= 0:
                f.level = target
            else:
                step = dt / ramp
                f.level = min(target, f.level + step) if target > f.level else max(target, f.level - step)

            if before == 0 and f.level > 0:
                f.state, f.activated_at = "active", t
                f.activations += 1
                events.append(self._event("fault_activated", f, t, distance_along_lap))
            elif before > 0 and f.level == 0:
                events.append(self._event("fault_deactivated", f, t, distance_along_lap))
                if repeat == "once_per_run" or spec.trigger.kind in ("always", "time"):
                    f.state = "completed"
                else:
                    f.state = "waiting"  # can fire again next lap
            elif f.level == 0 and f.state == "waiting" and f.fired_in_lap != lap:
                f.state = "pending"
        return events

    def active(self) -> list[FaultRuntime]:
        return [f for f in self.faults if f.level > 0]

    def summary(self, distance_along_lap: float) -> list[dict[str, Any]]:
        lap_distance = distance_along_lap % self.profile.total_length
        out = []
        for f in self.faults:
            item = {
                "id": f.spec.id,
                "type": f.spec.type,
                "target": f.spec.target,
                "source": f.spec.source,
                "state": f.state,
                "level": round(f.level, 3),
                "description": f.spec.describe(),
                "parameters": f.spec.parameters,
                "activations": f.activations,
                "remaining_m": None,
                "starts_at_m": None,  # lap distance where a zone/distance trigger switches it on
            }
            tr = f.spec.trigger
            if tr.kind == "zone":
                zone = next((h for h in self.profile.hazard_zones if h.id == tr.zone_id), None)
                if zone:
                    item["starts_at_m"] = round((zone.start_distance - tr.pad_m) % self.profile.total_length, 1)
            elif tr.kind == "distance":
                item["starts_at_m"] = round(tr.start % self.profile.total_length, 1)
            if f.level > 0 and tr.kind == "zone":
                zone = next((h for h in self.profile.hazard_zones if h.id == tr.zone_id), None)
                if zone:
                    item["remaining_m"] = round((zone.end_distance - lap_distance) % self.profile.total_length, 1)
            elif f.level > 0 and tr.kind == "distance":
                end = self.profile.total_length if tr.end is None else tr.end
                item["remaining_m"] = round(end - lap_distance, 1)
            out.append(item)
        return out

    @staticmethod
    def _event(kind: str, f: FaultRuntime, t: float, distance: float, **extra: Any) -> dict[str, Any]:
        return {
            "type": "fault_event",
            "event": kind,
            "t": round(t, 3),
            "distance": round(distance, 1),
            "fault_id": f.spec.id,
            "fault_type": f.spec.type,
            "target": f.spec.target,
            "source": f.spec.source,
            "description": f.spec.describe(),
            **extra,
        }
