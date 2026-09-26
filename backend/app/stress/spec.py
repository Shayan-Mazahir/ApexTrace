"""
Fault specifications and the fault catalogue.

Every fault is a validated FaultSpec: a type from the catalogue, the layer it
targets, a trigger (when it switches on/off), optional ramps, parameters
checked against the catalogue's bounds, a seed, and where it came from.
Only catalogue entries with status "implemented" can be armed; the rest are
listed so nobody mistakes them for working controls.
"""

from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field, model_validator

FaultTarget = Literal["world", "vehicle", "sensor", "uplink", "downlink", "warning_service", "driver"]
FaultSource = Literal["manual", "preset", "random", "sac"]
TriggerKind = Literal["always", "time", "distance", "zone", "speed_above"]
Repeat = Literal["once_per_run", "once_per_lap"]
CatalogStatus = Literal["implemented", "requires_model_extension"]


class ParamSpec(BaseModel):
    name: str
    unit: str
    min: float
    max: float
    default: float
    description: str


class FaultType(BaseModel):
    type: str
    label: str
    target: FaultTarget
    status: CatalogStatus
    description: str
    params: list[ParamSpec] = []
    # how the parameter composes with other faults on the same quantity
    composition: str = ""


def _p(name, unit, lo, hi, default, description):
    return ParamSpec(name=name, unit=unit, min=lo, max=hi, default=default, description=description)


CATALOG: dict[str, FaultType] = {
    ft.type: ft
    for ft in [
        # --- world / vehicle (actual dynamics) --------------------------------
        FaultType(type="grip_loss", label="Grip loss", target="world", status="implemented",
                  description="Actual tyre-road friction multiplied by grip_multiplier (braking and turning).",
                  params=[_p("grip_multiplier", "x", 0.4, 1.0, 0.7, "actual friction multiplier")],
                  composition="multiplies with other grip faults; final value bounded to [0.3, 1]"),
        FaultType(type="brake_fade", label="Brake fade (temporary)", target="vehicle", status="implemented",
                  description="Temporary loss of braking effectiveness for the same brake command. "
                              "Separate from persistent wear; servicing does not remove it.",
                  params=[_p("effectiveness", "x", 0.4, 1.0, 0.75, "brake effectiveness multiplier")],
                  composition="multiplies with persistent wear and other fades; bounded to [0.2, 1]"),
        FaultType(type="brake_actuation_delay", label="Brake actuation delay", target="vehicle", status="implemented",
                  description="Brake command reaches the brakes late (steering unaffected).",
                  params=[_p("delay_ms", "ms", 0, 600, 200, "actuation delay")],
                  composition="largest active delay applies"),
        FaultType(type="brake_saturation", label="Brake command saturation", target="vehicle", status="implemented",
                  description="Brake command capped below full braking.",
                  params=[_p("max_brake", "0-1", 0.3, 1.0, 0.6, "maximum brake command")],
                  composition="lowest active cap applies"),
        FaultType(type="steering_delay", label="Steering actuation delay", target="vehicle", status="implemented",
                  description="Simulated steering response lags the input (never touches real hardware).",
                  params=[_p("delay_ms", "ms", 0, 400, 120, "actuation delay")],
                  composition="largest active delay applies"),
        FaultType(type="steering_limit", label="Steering angle limit", target="vehicle", status="implemented",
                  description="Simulated steering command capped.",
                  params=[_p("max_steer", "0-1", 0.3, 1.0, 0.6, "maximum |steering|")],
                  composition="lowest active cap applies"),
        # --- sensors (what the car reports) ------------------------------------
        FaultType(type="grip_estimate_lag", label="Grip estimate lag", target="sensor", status="implemented",
                  description="The grip estimator's first-order time constant is increased, so the estimate "
                              "trails actual grip changes.",
                  params=[_p("extra_time_constant_s", "s", 0.0, 8.0, 3.0, "added estimator time constant")],
                  composition="adds to the 1.0 s base time constant"),
        FaultType(type="grip_estimate_bias", label="Grip estimate bias", target="sensor", status="implemented",
                  description="Estimated grip multiplied (>1 overconfident, <1 pessimistic).",
                  params=[_p("multiplier", "x", 0.6, 1.4, 1.2, "estimate multiplier")],
                  composition="multiplies; estimate bounded to [0.2, 1.5]"),
        FaultType(type="speed_bias", label="Speed sensor bias", target="sensor", status="implemented",
                  description="Reported speed = true speed x scale + offset (under- or over-read).",
                  params=[_p("scale", "x", 0.6, 1.4, 0.85, "multiplicative error"),
                          _p("offset_ms", "m/s", -15, 15, 0, "additive error")],
                  composition="scales multiply, offsets add; reported speed >= 0"),
        FaultType(type="speed_noise", label="Speed sensor noise", target="sensor", status="implemented",
                  description="Seeded Gaussian noise on reported speed.",
                  params=[_p("std_ms", "m/s", 0, 6, 2, "noise standard deviation")],
                  composition="independent draws add"),
        FaultType(type="sensor_freeze", label="Frozen sensor", target="sensor", status="implemented",
                  description="A channel keeps reporting its last measurement AND that measurement's sample "
                              "time, while packets keep arriving.",
                  params=[_p("channel", "0 speed / 1 position / 2 grip", 0, 2, 0, "which channel freezes")],
                  composition="per channel"),
        FaultType(type="position_offset", label="Position offset", target="sensor", status="implemented",
                  description="Reported distance along the lap offset (warning uses it to find corners).",
                  params=[_p("offset_m", "m", -40, 40, 20, "along-track offset (+ = reports further ahead)")],
                  composition="offsets add"),
        FaultType(type="sample_rate", label="Lower sampling rate", target="sensor", status="implemented",
                  description="Sensors produce new samples at a lower rate than the 20 Hz tick.",
                  params=[_p("rate_hz", "Hz", 1, 20, 5, "sampling rate")],
                  composition="lowest active rate applies"),
        # --- uplink (car -> warning system) -----------------------------------
        FaultType(type="uplink_delay", label="Telemetry delay (uplink)", target="uplink", status="implemented",
                  description="Sensor packets queued before reaching the warning system. Sample time and "
                              "sequence are preserved; jitter can reorder packets.",
                  params=[_p("delay_ms", "ms", 0, 1000, 300, "added delay"),
                          _p("jitter_ms", "ms", 0, 300, 0, "uniform extra delay 0..jitter")],
                  composition="delays add"),
        FaultType(type="uplink_loss", label="Packet loss (uplink)", target="uplink", status="implemented",
                  description="Seeded independent packet loss.",
                  params=[_p("probability", "0-1", 0, 0.9, 0.3, "drop probability")],
                  composition="independent: p = 1 - prod(1 - p_i)"),
        FaultType(type="uplink_blackout", label="Telemetry blackout (uplink)", target="uplink", status="implemented",
                  description="No packets delivered while active. With release_buffer=1 the packets sent during "
                              "the blackout arrive late, after fresher ones (old data after reconnect).",
                  params=[_p("release_buffer", "0/1", 0, 1, 0, "deliver buffered packets after reconnect"),
                          _p("release_delay_ms", "ms", 0, 2000, 600, "extra delay for released packets")],
                  composition="any active blackout blocks delivery"),
        # --- warning service + downlink (warning -> driver) -------------------
        FaultType(type="warning_compute_delay", label="Warning computation delay", target="warning_service",
                  status="implemented", description="The warning service takes longer to produce each decision.",
                  params=[_p("delay_ms", "ms", 0, 800, 250, "compute delay")], composition="delays add"),
        FaultType(type="downlink_delay", label="Warning delivery delay (downlink)", target="downlink",
                  status="implemented", description="A correctly generated remote warning reaches the driver late.",
                  params=[_p("delay_ms", "ms", 0, 1000, 400, "added delay")], composition="delays add"),
        FaultType(type="downlink_loss", label="Warning messages dropped (downlink)", target="downlink",
                  status="implemented", description="Seeded loss of remote warning messages to the driver.",
                  params=[_p("probability", "0-1", 0, 0.9, 0.5, "drop probability")],
                  composition="independent: p = 1 - prod(1 - p_i)"),
        # --- scripted driver ---------------------------------------------------
        FaultType(type="driver_reaction_delay", label="Scripted driver reaction delay", target="driver",
                  status="implemented",
                  description="The automated driver responds to BRAKE later. Scripted driver only — not a claim "
                              "about human reaction.",
                  params=[_p("extra_delay_s", "s", 0, 2.0, 0.5, "added reaction delay")], composition="delays add"),
        FaultType(type="driver_weak_braking", label="Scripted driver weak braking", target="driver",
                  status="implemented", description="The automated driver brakes at most max_brake.",
                  params=[_p("max_brake", "0-1", 0.3, 1.0, 0.6, "maximum brake command")],
                  composition="lowest cap applies"),
        FaultType(type="driver_ignore_warning", label="Scripted driver ignores a warning", target="driver",
                  status="implemented",
                  description="Deliberate noncompliance: the automated driver ignores the next N BRAKE warnings. "
                              "A resulting exit does not by itself show the warning failed.",
                  params=[_p("count", "warnings", 1, 3, 1, "warnings ignored")], composition="counts add"),
        # --- listed but NOT implementable honestly with the current model -----
        *[
            FaultType(type=t, label=l, target=tg, status="requires_model_extension", description=d)
            for t, l, tg, d in [
                ("crosswind", "Crosswind", "world", "Needs lateral aero/force modelling (point-mass model has none)."),
                ("brake_imbalance", "Left/right brake imbalance", "vehicle", "Needs per-wheel braking and yaw moment."),
                ("tyre_blowout", "Tyre blowout", "vehicle", "Needs per-tyre forces."),
                ("abs_failure", "ABS failure", "vehicle", "Needs wheel slip / lock-up modelling."),
                ("suspension_damage", "Suspension damage", "vehicle", "Needs a suspension model."),
                ("yaw_rate_bias", "Yaw-rate sensor bias", "sensor", "The warning does not consume yaw rate."),
                ("driver_visibility", "Fog / glare (human view)", "driver",
                 "Would only change the human's view; not wired to the renderer yet."),
            ]
        ],
    ]
}


class Trigger(BaseModel):
    kind: TriggerKind = "always"
    start: float = 0.0  # seconds (time) or metres (distance); speed threshold m/s (speed_above)
    end: float | None = None  # exclusive end; None = until the run ends (time) / same lap (distance)
    zone_id: str | None = None  # kind == "zone": active inside this hazard zone (+ pad)
    pad_m: float = 0.0  # zone: also active this far before the zone
    repeat: Repeat = "once_per_lap"


class FaultSpec(BaseModel):
    id: str
    type: str
    enabled: bool = True
    target: FaultTarget | None = None  # filled from the catalogue if omitted
    trigger: Trigger = Field(default_factory=Trigger)
    duration_s: float | None = Field(None, gt=0)  # cap on how long one activation lasts
    parameters: dict[str, float] = {}
    ramp_in_s: float = Field(0.0, ge=0)
    ramp_out_s: float = Field(0.0, ge=0)
    seed: int = 0
    source: FaultSource = "manual"

    @model_validator(mode="after")
    def _validate(self) -> "FaultSpec":
        ft = CATALOG.get(self.type)
        if ft is None:
            raise ValueError(f"unknown fault type {self.type!r}")
        if ft.status != "implemented":
            raise ValueError(f"fault type {self.type!r} is not implemented: {ft.description}")
        if self.target is None:
            self.target = ft.target
        elif self.target != ft.target:
            raise ValueError(f"{self.type} targets {ft.target}, not {self.target}")
        known = {p.name: p for p in ft.params}
        unknown = set(self.parameters) - set(known)
        if unknown:
            raise ValueError(f"unknown parameters for {self.type}: {sorted(unknown)}")
        filled = {}
        for name, p in known.items():
            value = float(self.parameters.get(name, p.default))
            if not (p.min <= value <= p.max):
                raise ValueError(f"{self.type}.{name}={value} outside [{p.min}, {p.max}] {p.unit}")
            filled[name] = value
        self.parameters = filled
        t = self.trigger
        if t.kind == "zone" and not t.zone_id:
            raise ValueError("zone trigger needs zone_id")
        if t.end is not None and t.kind in ("time", "distance") and t.end <= t.start:
            raise ValueError("trigger end must be after start")
        return self

    def describe(self) -> str:
        ft = CATALOG[self.type]
        params = ", ".join(f"{k}={v:g}" for k, v in self.parameters.items())
        t = self.trigger
        when = {
            "always": "whole run",
            "time": f"t {t.start:g}–{'end' if t.end is None else f'{t.end:g}'} s",
            "distance": f"{t.start:g}–{'lap end' if t.end is None else f'{t.end:g}'} m",
            "zone": f"zone {t.zone_id}" + (f" (+{t.pad_m:g} m before)" if t.pad_m else ""),
            "speed_above": f"while speed > {t.start:g} m/s",
        }[t.kind]
        return f"{ft.label} [{ft.target}] {params} — {when}"


class VehicleConfig(BaseModel):
    brake_wear: float = Field(0.75, ge=0.5, le=1.0)  # persistent; brake servicing restores to 1.0


class WarningPolicyConfig(BaseModel):
    """The safety system under test. Changing these is changing the system,
    so they are explicit, never silently altered between compared runs."""

    name: str = "baseline"
    reaction_allowance_s: float = Field(0.35, ge=0, le=2)
    margin_m: float = Field(7.0, ge=0, le=100)
    stale_threshold_ms: float = Field(300.0, ge=50, le=5000)
    lookahead_m: float = Field(1500.0, ge=100, le=4000)
    local_fallback: bool = False
    fallback_after_ms: float = Field(150.0, ge=0, le=5000)
    nominal_brake_decel: float = Field(40.0, gt=0)


class StartConfig(BaseModel):
    distance_m: float = 0.0  # start this far along the lap
    speed_ms: float = Field(0.0, ge=0, le=90)
    lateral_offset_m: float = 0.0
    heading_error_rad: float = Field(0.0, ge=-0.5, le=0.5)


class DriverConfig(BaseModel):
    kind: Literal["scripted", "human"] = "scripted"
    cruise_speed_ms: float = Field(84.0, gt=0, le=90)
    reaction_s: float = Field(0.3, ge=0, le=3)


class StressScenario(BaseModel):
    id: str
    name: str
    description: str = ""
    track: Literal["monza", "baku"]
    seed: int = 1
    faults: list[FaultSpec] = []
    start: StartConfig = Field(default_factory=StartConfig)
    driver: DriverConfig = Field(default_factory=DriverConfig)
    max_time_s: float = Field(240.0, gt=0, le=900)
    laps: int = Field(1, ge=1, le=5)
    # segment runs (dataset / RL): stop after this many metres instead of a lap
    segment_length_m: float | None = Field(None, gt=0)
    source: FaultSource = "preset"
