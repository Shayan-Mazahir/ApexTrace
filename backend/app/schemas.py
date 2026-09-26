"""Shared Pydantic schemas. Mirrors frontend/src/types/schemas.ts — keep both in sync by hand.

Units: metres, seconds, m/s, m/s^2, radians, unless a field name says otherwise
(``*_ms`` = milliseconds). World frame: the track starts at the origin heading
along +x; +y is to the left. The frontend projects (x, y) onto its ground plane.

Everything named ``actual_*`` or produced by the simulator is ground truth.
Anything under ``prediction`` fields comes from a model and is never a
simulator result.
"""

from __future__ import annotations

from enum import Enum
from typing import Literal

from pydantic import BaseModel, Field, model_validator

TrackName = Literal["monza", "baku"]


class HealthStatus(BaseModel):
    status: str
    service: str


class WarningLevel(str, Enum):
    SAFE = "SAFE"
    CAUTION = "CAUTION"
    BRAKE_NOW = "BRAKE_NOW"


class WarningSource(str, Enum):
    REMOTE = "remote"  # computed from (possibly delayed/lossy) remote telemetry
    LOCAL = "local"  # on-car fallback, only with the local_warning_fallback upgrade


class ConfigurationName(str, Enum):
    BASELINE = "baseline"
    BRAKE_SERVICE = "brake_service"
    RELIABLE_TELEMETRY = "reliable_telemetry"
    LOCAL_WARNING_FALLBACK = "local_warning_fallback"


# --------------------------------------------------------------------------- #
# Scenario
# --------------------------------------------------------------------------- #


class Scenario(BaseModel):
    """One reproducible stress test. The same scenario (incl. seed) always gives the same result."""

    scenario_id: str = Field(default="scenario", min_length=1, max_length=128)
    seed: int = Field(default=0, ge=0, le=2**31 - 1)
    track: TrackName = "monza"
    entry_speed: float = Field(default=80.0, ge=10.0, le=95.0, description="m/s at start of approach")
    actual_grip: float = Field(default=1.0, ge=0.3, le=1.3, description="true surface grip (hidden from the safety system)")
    estimated_grip: float = Field(default=1.0, ge=0.3, le=1.3, description="grip the safety system believes")
    corner_curvature: float | None = Field(
        default=None, gt=0, description="1/m; None = track default. Must lie in the track's range."
    )
    telemetry_delay_ms: float = Field(default=0.0, ge=0.0, le=1000.0)
    sensor_noise: float = Field(default=0.0, ge=0.0, le=1.0, description="0 = clean, 1 = max bounded noise")
    packet_loss: float = Field(default=0.0, ge=0.0, le=0.9, description="long-run fraction of telemetry packets lost")
    driver_reaction_delay: float = Field(default=0.3, ge=0.0, le=2.0, description="seconds")
    warning_margin: float = Field(default=0.1, ge=0.0, le=1.0, description="fractional extra braking distance")
    brake_effectiveness: float = Field(default=1.0, ge=0.2, le=1.0, description="1.0 = baseline, <1 degraded")

    @model_validator(mode="after")
    def _curvature_in_track_range(self) -> "Scenario":
        from app.sim.track import PROFILES

        if self.corner_curvature is not None:
            lo, hi = PROFILES[self.track].curvature_range
            if not (lo - 1e-9 <= self.corner_curvature <= hi + 1e-9):
                raise ValueError(
                    f"corner_curvature {self.corner_curvature:.5f} outside {self.track} range [{lo:.5f}, {hi:.5f}]"
                )
        return self


# --------------------------------------------------------------------------- #
# Simulation state / results
# --------------------------------------------------------------------------- #


class VehicleState(BaseModel):
    """One simulator tick. Ground truth unless noted."""

    timestamp: float
    x: float
    y: float
    s: float = Field(description="distance along centerline")
    lateral_offset: float = Field(description="m from centerline, + = left")
    speed: float
    heading: float
    steering: float = Field(description="-1..1, + = left")
    throttle: float
    brake: float
    acceleration: float = Field(description="longitudinal, m/s^2")
    lateral_acceleration: float
    grip_usage: float = Field(description="demanded / available friction; >1 means the tyres could not deliver")
    actual_grip: float
    estimated_grip: float
    boundary_distance: float = Field(description="m to nearest edge; negative = off track")
    on_track: bool
    # Safety system / fault state at this tick.
    warning: WarningLevel = Field(description="warning currently displayed to the driver")
    warning_source: WarningSource
    advised_speed: float | None = Field(description="corner speed the safety system recommends")
    measured_speed: float | None = Field(description="speed as seen by the safety system (delayed/noisy)")
    telemetry_age_ms: float | None = Field(description="age of the telemetry packet the warning used")
    packet_dropped: bool = Field(description="this tick's telemetry packet was lost")


class SimulationMetrics(BaseModel):
    corner_entry_speed: float | None
    safe_corner_speed: float = Field(description="max corner speed under ACTUAL grip (ground truth)")
    advised_corner_speed: float = Field(description="corner speed the safety system targets, from ESTIMATED grip")
    overspeed_at_entry: float | None = Field(description="corner_entry_speed - safe_corner_speed")
    max_lateral_error: float
    max_grip_usage: float
    warning_lead_time: float | None = Field(description="s from first BRAKE_NOW shown to corner entry")
    warning_too_late: bool = Field(
        description="no BRAKE_NOW was shown early enough for full braking (actual brakes/grip) to reach the safe speed"
    )
    stale_telemetry_fraction: float
    packets_dropped: int
    sim_time: float
    ticks: int


class SimulationResult(BaseModel):
    scenario_id: str
    configuration: ConfigurationName
    scenario: Scenario = Field(description="the effective scenario after the configuration was applied")
    success: bool
    failed: bool
    left_track: bool
    failure_reason: Literal["left_track"] | None
    warning_triggered: bool = Field(description="a BRAKE_NOW warning was displayed at some point")
    warning_timestamp: float | None = Field(description="first BRAKE_NOW displayed")
    failure_timestamp: float | None
    minimum_boundary_distance: float
    metrics: SimulationMetrics
    telemetry: list[VehicleState] | None = None
