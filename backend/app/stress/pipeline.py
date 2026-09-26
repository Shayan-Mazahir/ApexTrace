"""
The layered test pipeline. Order within one tick:

  faults -> effective values (composition rules below, recorded every tick)
  driver controls -> actuator faults -> vehicle step (TRUE world: grip, brakes)
  true state -> sensors (sampling rate, estimator, bias, noise, freeze)
  sensor packets -> uplink (delay/jitter/loss/blackout) -> remote warning service
  remote decisions -> compute delay + downlink (delay/loss) -> driver display
  onboard sensors -> local fallback (only if fitted; same sensors, no link)
  evaluator reads the TRUE state and the display to score the run

The warning service and fallback only ever see sensor channels, each carrying
its own sample time, so a frozen channel is detectable even while packets
keep arriving. Nothing downstream of the sensors reads true speed or grip.

Composition (several faults on one quantity):
  multipliers multiply, then clamp; offsets and delays add; caps take the
  minimum; loss probabilities combine as 1 - prod(1 - p); any active
  blackout blocks delivery. A fault at ramp level L contributes
  multiplier 1 - L(1 - m), delay L*d, probability L*p.
"""

from __future__ import annotations

import math
import random
from collections import deque
from dataclasses import dataclass, field
from typing import Any

from app.placeholder_sim import (
    BRAKE_DECEL,
    DemoVehicleState,
    distance_to_hazard,
    loop_size,
)
from app.schemas import HazardZone, TrackProfile
from app.stress.scheduler import FaultScheduler
from app.stress.spec import WarningPolicyConfig

CHANNELS = ("speed", "position", "grip")
BASE_ESTIMATOR_TAU_S = 1.0


# --------------------------------------------------------------------------
# effective values


@dataclass
class Effective:
    grip: float = 1.0
    brake_fade: float = 1.0
    brake_delay_ms: float = 0.0
    brake_cap: float = 1.0
    steer_delay_ms: float = 0.0
    steer_cap: float = 1.0
    estimator_extra_tau_s: float = 0.0
    estimate_bias: float = 1.0
    speed_scale: float = 1.0
    speed_offset: float = 0.0
    speed_noise_std: float = 0.0
    frozen: frozenset[str] = frozenset()
    position_offset: float = 0.0
    sample_rate_hz: float = 20.0
    uplink_delay_ms: float = 0.0
    uplink_jitter_ms: float = 0.0
    uplink_loss: float = 0.0
    blackout: bool = False
    release_buffer: bool = False
    release_delay_ms: float = 0.0
    compute_delay_ms: float = 0.0
    downlink_delay_ms: float = 0.0
    downlink_loss: float = 0.0
    driver_extra_delay_s: float = 0.0
    driver_max_brake: float = 1.0
    driver_ignore: int = 0

    def as_dict(self) -> dict[str, Any]:
        d = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in self.__dict__.items()}
        d["frozen"] = sorted(self.frozen)
        return d


def resolve(scheduler: FaultScheduler, comms_scale: float = 1.0, comms_loss_scale: float = 1.0) -> Effective:
    e = Effective()
    keep = {"up": 1.0, "down": 1.0}
    frozen: set[str] = set()
    for f in scheduler.active():
        L, p, t = f.level, f.spec.parameters, f.spec.type
        mult = lambda m: 1 - L * (1 - m)  # noqa: E731
        if t == "grip_loss":
            e.grip *= mult(p["grip_multiplier"])
        elif t == "brake_fade":
            e.brake_fade *= mult(p["effectiveness"])
        elif t == "brake_actuation_delay":
            e.brake_delay_ms = max(e.brake_delay_ms, L * p["delay_ms"])
        elif t == "brake_saturation":
            e.brake_cap = min(e.brake_cap, mult(p["max_brake"]))
        elif t == "steering_delay":
            e.steer_delay_ms = max(e.steer_delay_ms, L * p["delay_ms"])
        elif t == "steering_limit":
            e.steer_cap = min(e.steer_cap, mult(p["max_steer"]))
        elif t == "grip_estimate_lag":
            e.estimator_extra_tau_s += L * p["extra_time_constant_s"]
        elif t == "grip_estimate_bias":
            e.estimate_bias *= mult(p["multiplier"])
        elif t == "speed_bias":
            e.speed_scale *= mult(p["scale"])
            e.speed_offset += L * p["offset_ms"]
        elif t == "speed_noise":
            e.speed_noise_std = math.hypot(e.speed_noise_std, L * p["std_ms"])
        elif t == "sensor_freeze":
            frozen.add(CHANNELS[int(round(p["channel"]))])
        elif t == "position_offset":
            e.position_offset += L * p["offset_m"]
        elif t == "sample_rate":
            e.sample_rate_hz = min(e.sample_rate_hz, p["rate_hz"])
        elif t == "uplink_delay":
            e.uplink_delay_ms += L * p["delay_ms"]
            e.uplink_jitter_ms += L * p["jitter_ms"]
        elif t == "uplink_loss":
            keep["up"] *= 1 - L * p["probability"]
        elif t == "uplink_blackout":
            e.blackout = True
            e.release_buffer = e.release_buffer or p["release_buffer"] >= 0.5
            e.release_delay_ms = max(e.release_delay_ms, p["release_delay_ms"])
        elif t == "warning_compute_delay":
            e.compute_delay_ms += L * p["delay_ms"]
        elif t == "downlink_delay":
            e.downlink_delay_ms += L * p["delay_ms"]
        elif t == "downlink_loss":
            keep["down"] *= 1 - L * p["probability"]
        elif t == "driver_reaction_delay":
            e.driver_extra_delay_s += L * p["extra_delay_s"]
        elif t == "driver_weak_braking":
            e.driver_max_brake = min(e.driver_max_brake, mult(p["max_brake"]))
        elif t == "driver_ignore_warning":
            e.driver_ignore += int(round(p["count"]))
    e.frozen = frozenset(frozen)
    e.grip = max(0.3, min(1.0, e.grip))
    e.brake_fade = max(0.2, min(1.0, e.brake_fade))
    # the comms upgrade acts on the SAME underlying disturbance
    e.uplink_delay_ms *= comms_scale
    e.uplink_jitter_ms *= comms_scale
    e.downlink_delay_ms *= comms_scale
    e.uplink_loss = (1 - keep["up"]) * comms_loss_scale
    e.downlink_loss = (1 - keep["down"]) * comms_loss_scale
    return e


# --------------------------------------------------------------------------
# actuators (simulated vehicle response to the driver's commands)


@dataclass
class Actuators:
    history: deque = field(default_factory=lambda: deque(maxlen=60))  # (t, steer, brake)

    def apply(self, t: float, steering: float, brake: float, e: Effective) -> tuple[float, float]:
        self.history.append((t, steering, brake))
        steer_out, brake_out = steering, brake
        if e.steer_delay_ms > 0 or e.brake_delay_ms > 0:
            steer_out = self._at(t - e.steer_delay_ms / 1000, 1, steering)
            brake_out = self._at(t - e.brake_delay_ms / 1000, 2, brake)
        steer_out = max(-e.steer_cap, min(e.steer_cap, steer_out))
        brake_out = min(e.brake_cap, brake_out)
        return steer_out, brake_out

    def _at(self, t: float, idx: int, default: float) -> float:
        value = None
        for sample in self.history:
            if sample[0] <= t + 1e-9:
                value = sample[idx]
            else:
                break
        return default if value is None else value


# --------------------------------------------------------------------------
# sensors


@dataclass
class Packet:
    seq: int
    sent_t: float
    channels: dict[str, tuple[float, float]]  # name -> (value, sample_time)
    lateral: float = 0.0  # observed lateral offset (position sensor)
    yaw_rate: float = 0.0  # onboard IMU (not faulted)


@dataclass
class Sensors:
    profile: TrackProfile
    seed: int
    rng: random.Random = field(init=False)
    seq: int = 0
    last_sample_t: float = -1e9
    grip_estimate: float = 1.0
    frozen_values: dict[str, tuple[float, float]] = field(default_factory=dict)
    last_heading: float | None = None

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed * 7919 + 17)

    def estimate(self, true_grip: float, dt: float, e: Effective) -> None:
        tau = BASE_ESTIMATOR_TAU_S + e.estimator_extra_tau_s
        self.grip_estimate += (true_grip - self.grip_estimate) * (1 - math.exp(-dt / tau))

    def sample(self, t: float, v: DemoVehicleState, lateral: float, e: Effective) -> Packet | None:
        yaw = 0.0 if self.last_heading is None else v.heading - self.last_heading
        self.last_heading = v.heading
        if t - self.last_sample_t < 1.0 / e.sample_rate_hz - 1e-6:
            return None
        self.last_sample_t = t
        self.seq += 1
        speed = max(0.0, v.speed * e.speed_scale + e.speed_offset + (self.rng.gauss(0, e.speed_noise_std) if e.speed_noise_std else 0.0))
        position = (v.distance_along_lap + e.position_offset)
        grip = max(0.2, min(1.5, self.grip_estimate * e.estimate_bias))
        fresh = {"speed": (speed, t), "position": (position, t), "grip": (grip, t)}
        channels = {}
        for name, value in fresh.items():
            if name in e.frozen:
                held = self.frozen_values.setdefault(name, value)
                channels[name] = held  # old value AND old sample time
            else:
                self.frozen_values.pop(name, None)
                channels[name] = value
        yaw_rate = ((yaw + math.pi) % (2 * math.pi) - math.pi) / 0.05
        return Packet(seq=self.seq, sent_t=t, channels=channels, lateral=lateral, yaw_rate=yaw_rate)


# --------------------------------------------------------------------------
# links (application-level simulated transport; no real network is touched)


@dataclass
class Link:
    seed: int
    rng: random.Random = field(init=False)
    queue: list[tuple[float, int, Any]] = field(default_factory=list)
    buffered: list[Any] = field(default_factory=list)
    sent: int = 0
    dropped: int = 0
    blacked_out: int = 0
    _order: int = 0

    def __post_init__(self) -> None:
        self.rng = random.Random(self.seed)

    def send(self, t: float, item: Any, delay_ms: float, jitter_ms: float = 0.0, loss: float = 0.0,
             blackout: bool = False, release_buffer: bool = False, release_delay_ms: float = 0.0) -> None:
        self.sent += 1
        # always draw, so loss settings don't shift later random draws
        lost = self.rng.random() < loss
        jitter = self.rng.random() * jitter_ms
        if blackout:
            self.blacked_out += 1
            if release_buffer:
                self.buffered.append(item)
            return
        if lost:
            self.dropped += 1
            return
        self._push(t + (delay_ms + jitter) / 1000, item)

    def end_blackout(self, t: float, delay_ms: float, release_delay_ms: float) -> None:
        for item in self.buffered:
            self._push(t + (delay_ms + release_delay_ms) / 1000, item)
        self.buffered.clear()

    def _push(self, at: float, item: Any) -> None:
        self._order += 1
        self.queue.append((at, self._order, item))

    def deliver(self, t: float) -> list[Any]:
        due = sorted((q for q in self.queue if q[0] <= t + 1e-9), key=lambda q: (q[0], q[1]))
        if due:
            self.queue = [q for q in self.queue if q[0] > t + 1e-9]
        return [q[2] for q in due]

    def clear(self) -> None:
        self.queue.clear()
        self.buffered.clear()


# --------------------------------------------------------------------------
# the safety system under test


@dataclass
class Decision:
    seq: int
    generated_t: float
    state: str  # "brake" | "clear" | "stale" | "no_data"
    source: str  # "remote" | "local"
    data_sample_t: float | None
    data_age_ms: float | None
    hazard_id: str | None = None
    hazard_label: str | None = None
    advised_speed: float | None = None
    reason: str | None = None


def corner_target(h: HazardZone, grip: float) -> float:
    return h.corner_speed * math.sqrt(max(grip, 0.05))


def assess(distance: float, speed: float, grip: float, profile: TrackProfile, policy: WarningPolicyConfig,
           decel: float | None = None) -> tuple[HazardZone, float, float] | None:
    """The braking-warning rule, looking along the route (not Euclidean
    nearest): of every corner within the lookahead, the one whose braking
    point is most overdue. Returns (hazard, advised speed, metres ahead)."""
    decel = policy.nominal_brake_decel if decel is None else decel
    best = None
    for h in profile.hazard_zones:
        ahead = distance_to_hazard(distance, h, profile)
        if ahead > policy.lookahead_m:
            continue
        target = corner_target(h, grip)
        if speed <= target:
            continue
        required = (speed**2 - target**2) / (2 * decel) + speed * policy.reaction_allowance_s + policy.margin_m
        slack = ahead - required
        if slack < 0 and (best is None or slack < best[0]):
            best = (slack, h, target, ahead)
    return None if best is None else (best[1], best[2], best[3])


@dataclass
class WarningService:
    """Consumes only sensor channels. Keeps the newest sample per channel by
    packet sequence; an older packet can never overwrite newer data."""

    profile: TrackProfile
    policy: WarningPolicyConfig
    source: str
    latest_seq: int = 0
    channels: dict[str, tuple[float, float]] = field(default_factory=dict)
    rejected_old: int = 0
    received: int = 0
    decision_seq: int = 0

    def receive(self, packet: Packet) -> None:
        if packet.seq <= self.latest_seq:
            self.rejected_old += 1
            return
        self.received += 1
        self.latest_seq = packet.seq
        self.channels = dict(packet.channels)

    def data_age_ms(self, t: float) -> float | None:
        if not self.channels:
            return None
        oldest = min(self.channels[c][1] for c in CHANNELS)  # per-channel freshness
        return (t - oldest) * 1000

    def decide(self, t: float) -> Decision:
        self.decision_seq += 1
        age = self.data_age_ms(t)
        oldest = None if age is None else t - age / 1000
        if age is None:
            return Decision(self.decision_seq, t, "no_data", self.source, None, None, reason="No telemetry received")
        if age > self.policy.stale_threshold_ms:
            stale = [c for c in CHANNELS if (t - self.channels[c][1]) * 1000 > self.policy.stale_threshold_ms]
            return Decision(self.decision_seq, t, "stale", self.source, oldest, age,
                            reason=f"Telemetry stale ({', '.join(stale)} {age:.0f} ms old)")
        speed = self.channels["speed"][0]
        distance = self.channels["position"][0]
        grip = self.channels["grip"][0]
        found = assess(distance, speed, grip, self.profile, self.policy)
        if found is None:
            return Decision(self.decision_seq, t, "clear", self.source, oldest, age)
        h, target, ahead = found
        return Decision(self.decision_seq, t, "brake", self.source, oldest, age, h.id, h.label, target,
                        f"Brake for {h.label} in {ahead:.0f} m")


@dataclass
class DriverDisplay:
    """What the driver actually sees: remote decisions as they arrive over the
    downlink, or the onboard fallback when remote information is too old."""

    policy: WarningPolicyConfig
    remote: Decision | None = None
    shown: Decision | None = None
    fallback_active: bool = False
    fallback_since: float | None = None
    remote_received_t: float | None = None

    def receive_remote(self, d: Decision, t: float) -> None:
        if self.remote is not None and d.seq <= self.remote.seq:
            return  # late/out-of-order decision: never overrides a newer one
        self.remote = d
        self.remote_received_t = t

    def remote_age_ms(self, t: float) -> float | None:
        if self.remote is None or self.remote.data_sample_t is None:
            return None
        return (t - self.remote.data_sample_t) * 1000

    def resolve(self, t: float, local: Decision | None) -> Decision | None:
        age = self.remote_age_ms(t)
        remote_ok = age is not None and age <= self.policy.fallback_after_ms and self.remote.state in ("brake", "clear")
        use_local = self.policy.local_fallback and local is not None and not remote_ok
        if use_local and not self.fallback_active:
            self.fallback_since = t
        if not use_local:
            self.fallback_since = None
        self.fallback_active = use_local
        if use_local:
            self.shown = local
        elif self.remote is not None:
            # Remote-only. A late BRAKE is still shown (late beats never); an
            # old "all clear" is not trusted and becomes a STALE caution —
            # stale data is never silently treated as fresh.
            if self.remote.state == "clear" and age is not None and age > self.policy.stale_threshold_ms:
                self.shown = Decision(self.remote.seq, t, "stale", "remote", self.remote.data_sample_t, age,
                                      reason=f"No fresh warning data ({age:.0f} ms)")
            else:
                self.shown = self.remote
        return self.shown


# --------------------------------------------------------------------------
# evaluator (ground truth)


@dataclass
class Evaluator:
    profile: TrackProfile
    min_clearance: float = math.inf
    exit_distance: float | None = None
    exit_t: float | None = None
    warnings: list[dict[str, Any]] = field(default_factory=list)
    unnecessary: int = 0
    stale_time_s: float = 0.0
    fallback_first_t: float | None = None
    blackout_time_s: float = 0.0
    first_brake_t: float | None = None

    def exit_location(self) -> str | None:
        if self.exit_distance is None:
            return None
        d = self.exit_distance % self.profile.total_length
        near = [h for h in self.profile.hazard_zones if h.start_distance - 150 <= d <= h.end_distance + 50]
        return near[0].label if near else f"{d:.0f} m"

    def warning_displayed(self, t: float, d: Decision, v: DemoVehicleState, grip: float, brake_decel: float) -> None:
        """Ground-truth margin at display: metres left before the latest point
        at which full braking (with TRUE grip and brakes) still reaches the
        corner at a speed it can take. Positive = there was room."""
        h = next((z for z in self.profile.hazard_zones if z.id == d.hazard_id), None)
        if h is None:
            return
        ahead = distance_to_hazard(v.distance_along_lap, h, self.profile)
        target = corner_target(h, grip)
        needed = max(0.0, v.speed**2 - target**2) / (2 * max(brake_decel, 1e-3))
        necessary = v.speed > target
        if not necessary:
            self.unnecessary += 1
        self.warnings.append({
            "t": round(t, 3),
            "hazard_id": h.id,
            "source": d.source,
            "generated_t": round(d.generated_t, 3),
            "data_age_ms": None if d.data_age_ms is None else round(d.data_age_ms, 1),
            "margin_m": round(ahead - needed, 2),
            "necessary": necessary,
        })
