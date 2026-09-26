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

from pydantic import BaseModel, Field

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
    """One reproducible stress test: a single flying lap of the chosen track.

    The same scenario (incl. seed) always gives the same result. Fault
    parameters apply for the whole lap.
    """

    scenario_id: str = Field(default="scenario", min_length=1, max_length=128)
    seed: int = Field(default=0, ge=0, le=2**31 - 1)
    track: TrackName = "monza"
    entry_speed: float = Field(default=80.0, ge=10.0, le=95.0, description="m/s when crossing the start line (flying lap)")
    actual_grip: float = Field(default=1.0, ge=0.3, le=1.3, description="true surface grip (hidden from the safety system)")
    estimated_grip: float = Field(default=1.0, ge=0.3, le=1.3, description="grip the safety system believes")
    telemetry_delay_ms: float = Field(default=0.0, ge=0.0, le=1000.0)
    sensor_noise: float = Field(default=0.0, ge=0.0, le=1.0, description="0 = clean, 1 = max bounded noise")
    packet_loss: float = Field(default=0.0, ge=0.0, le=0.9, description="long-run fraction of telemetry packets lost")
    driver_reaction_delay: float = Field(default=0.3, ge=0.0, le=2.0, description="seconds")
    warning_margin: float = Field(default=0.1, ge=0.0, le=1.0, description="fractional extra braking distance")
    brake_effectiveness: float = Field(default=1.0, ge=0.2, le=1.0, description="1.0 = baseline, <1 degraded")


# --------------------------------------------------------------------------- #
# Simulation state / results
# --------------------------------------------------------------------------- #


class VehicleState(BaseModel):
    """One simulator tick. Ground truth unless noted."""

    timestamp: float
    x: float
    y: float
    s: float = Field(description="distance along centerline from the start line (wraps at lap length)")
    lap_progress: float = Field(description="metres driven this lap")
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
    next_corner: str = Field(description="corner the car is in, or the next one ahead")
    # Safety system / fault state at this tick.
    warning: WarningLevel = Field(description="warning currently displayed to the driver")
    warning_source: WarningSource
    warning_corner: str | None = Field(description="corner the displayed warning refers to")
    advised_speed: float | None = Field(description="corner speed the safety system recommends")
    measured_speed: float | None = Field(description="speed as seen by the safety system (delayed/noisy)")
    telemetry_age_ms: float | None = Field(description="age of the telemetry packet the warning used")
    packet_dropped: bool = Field(description="this tick's telemetry packet was lost")


class CornerMetrics(BaseModel):
    """Per-corner outcome for corners the car reached this lap."""

    name: str
    entry_speed: float
    approach_max_speed: float = Field(description="highest speed in the corner's braking zone")
    safe_speed: float = Field(description="max corner speed under ACTUAL grip (ground truth)")
    advised_speed: float = Field(description="corner speed the safety system targets, from ESTIMATED grip")
    overspeed_at_entry: float = Field(description="entry_speed - safe_speed")
    warning_timestamp: float | None = Field(description="first BRAKE_NOW shown for this corner")
    warning_lead_time: float | None = Field(description="s from that BRAKE_NOW to corner entry")
    warning_too_late: bool = Field(
        description="braking was needed but no BRAKE_NOW came early enough for full braking "
        "(actual brakes/grip/reaction) to reach the safe speed"
    )


class SimulationMetrics(BaseModel):
    lap_completed: bool
    lap_time: float | None = Field(description="seconds, only when the lap was completed")
    lap_distance: float = Field(description="metres driven before the run ended")
    corners: list[CornerMetrics]
    max_overspeed_at_entry: float | None
    corners_with_late_warning: int
    warning_too_late: bool = Field(description="at least one corner had a late or missing warning")
    max_lateral_error: float
    max_grip_usage: float
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
    failure_corner: str | None = Field(description="corner being driven (or last one exited) when the car left the track")
    failure_s: float | None
    warning_triggered: bool = Field(description="a BRAKE_NOW warning was displayed at some point")
    warning_timestamp: float | None = Field(description="first BRAKE_NOW displayed")
    failure_timestamp: float | None
    minimum_boundary_distance: float
    metrics: SimulationMetrics
    telemetry: list[VehicleState] | None = None


# --------------------------------------------------------------------------- #
# Track geometry / replay
# --------------------------------------------------------------------------- #


class CornerInfo(BaseModel):
    name: str
    s_entry: float
    s_exit: float
    curvature: float = Field(description="signed 1/m, + = left")
    radius: float
    direction: Literal["left", "right"]
    width: float


class BrakingZoneInfo(BaseModel):
    corner: str
    s_start: float
    s_end: float


class TrackGeometry(BaseModel):
    name: TrackName
    display_name: str
    purpose: str
    width: float = Field(description="nominal width; narrower sections are reflected in the boundaries")
    min_width: float
    length: float
    closed: bool = Field(description="True: the centerline loops back to its first point")
    centerline: list[tuple[float, float]]
    left_boundary: list[tuple[float, float]]
    right_boundary: list[tuple[float, float]]
    corners: list[CornerInfo]
    braking_zones: list[BrakingZoneInfo]
    telemetry_shadow_zones: list[tuple[float, float]] = Field(description="(s_start, s_end) with amplified packet loss")


class ReplayEvent(BaseModel):
    timestamp: float
    kind: Literal["caution_shown", "brake_now_shown", "corner_entry", "left_track", "lap_completed", "finished"]
    detail: str | None = None


class Replay(BaseModel):
    """Everything needed to play a run back. Regenerable from (scenario, configuration)."""

    replay_id: str
    scenario: Scenario
    configuration: ConfigurationName
    sample_hz: float
    track: TrackGeometry
    frames: list[VehicleState]
    events: list[ReplayEvent]
    result: SimulationResult = Field(description="summary; its telemetry field is omitted (see frames)")


# --------------------------------------------------------------------------- #
# Configuration evaluation
# --------------------------------------------------------------------------- #


class ScenarioOutcome(BaseModel):
    scenario_id: str
    failed: bool
    minimum_boundary_distance: float
    warning_too_late: bool
    failure_corner: str | None
    lap_time: float | None


class ConfigurationEvaluation(BaseModel):
    configuration: ConfigurationName
    description: str
    scenario_count: int
    stress_test_failures: int = Field(description="count of simulator failures (not a real-world probability)")
    failed_scenario_ids: list[str]
    outcomes: list[ScenarioOutcome]


class ConfigurationComparison(BaseModel):
    scenario_count: int
    scenario_ids: list[str] = Field(description="the identical scenario set run under every configuration")
    evaluations: list[ConfigurationEvaluation]
    fixed_vs_baseline: dict[str, list[str]] = Field(description="configuration -> scenarios that fail in baseline but pass here")
    new_failures_vs_baseline: dict[str, list[str]]


# --------------------------------------------------------------------------- #
# API requests / misc responses
# --------------------------------------------------------------------------- #

MAX_BATCH = 1000
MAX_COMPARE = 500


class ScenarioPreset(BaseModel):
    name: str
    description: str
    scenario: Scenario


class ConfigurationInfo(BaseModel):
    name: ConfigurationName
    description: str


class RunRequest(BaseModel):
    scenario: Scenario
    configuration: ConfigurationName = ConfigurationName.BASELINE
    include_telemetry: bool = False


class BatchRequest(BaseModel):
    scenarios: list[Scenario] = Field(min_length=1, max_length=MAX_BATCH)
    configuration: ConfigurationName = ConfigurationName.BASELINE


class BatchResult(BaseModel):
    configuration: ConfigurationName
    scenario_count: int
    stress_test_failures: int
    results: list[SimulationResult]


class ReplayRequest(BaseModel):
    scenario: Scenario
    configuration: ConfigurationName = ConfigurationName.BASELINE
    sample_hz: float = Field(default=20.0, gt=0, le=100.0)


class GenerateScenariosRequest(BaseModel):
    count: int = Field(default=50, ge=1, le=MAX_COMPARE)
    seed: int = Field(default=0, ge=0)
    track: TrackName | None = Field(default=None, description="None = both tracks")


class EvaluateRequest(BaseModel):
    scenarios: list[Scenario] = Field(min_length=1, max_length=MAX_COMPARE)
    configuration: ConfigurationName = ConfigurationName.BASELINE


class CompareRequest(BaseModel):
    scenarios: list[Scenario] = Field(min_length=1, max_length=MAX_COMPARE)
    configurations: list[ConfigurationName] = Field(default_factory=lambda: list(ConfigurationName))


# --------------------------------------------------------------------------- #
# Live simulation over WebSocket (/ws/simulation)
# --------------------------------------------------------------------------- #


class LiveStart(BaseModel):
    """First client message. ``mode='manual'`` means the client sends LiveControl messages (e.g. a wheel)."""

    type: Literal["start"] = "start"
    scenario: Scenario
    configuration: ConfigurationName = ConfigurationName.BASELINE
    mode: Literal["scripted", "manual"] = "scripted"
    rate_hz: float = Field(default=50.0, gt=0, le=100.0, description="state messages per second of sim time")
    speedup: float = Field(default=1.0, gt=0, le=100.0, description="sim seconds per wall-clock second")


class LiveControl(BaseModel):
    type: Literal["control"] = "control"
    steering: float = Field(ge=-1.0, le=1.0)
    throttle: float = Field(ge=0.0, le=1.0)
    brake: float = Field(ge=0.0, le=1.0)


class LiveTrackMessage(BaseModel):
    type: Literal["track"] = "track"
    track: TrackGeometry


class LiveStateMessage(BaseModel):
    type: Literal["state"] = "state"
    state: VehicleState


class LiveResultMessage(BaseModel):
    type: Literal["result"] = "result"
    result: SimulationResult


class LiveErrorMessage(BaseModel):
    type: Literal["error"] = "error"
    detail: str


# --------------------------------------------------------------------------- #
# AI: predictions and scenario search
# --------------------------------------------------------------------------- #

SearchStrategyName = Literal["sac", "tpe", "random"]
MAX_SEARCH_BUDGET = 200


class ModelPrediction(BaseModel):
    """TCN output. A model estimate of the simulator outcome, NOT a simulator result."""

    kind: Literal["model_prediction"] = "model_prediction"
    scenario_id: str
    failure_probability: float = Field(ge=0.0, le=1.0)
    uncertainty: float = Field(ge=0.0, description="std over MC-dropout samples")
    predicted_failure: bool = Field(description="failure_probability >= model threshold")


class PredictRequest(BaseModel):
    scenarios: list[Scenario] = Field(min_length=1, max_length=MAX_COMPARE)
    configuration: ConfigurationName = ConfigurationName.BASELINE


class ScenarioSearchRequest(BaseModel):
    strategy: SearchStrategyName = "sac"
    use_tcn_selection: bool = True
    budget: int = Field(default=30, ge=1, le=MAX_SEARCH_BUDGET, description="number of FULL simulations")
    track: TrackName | None = None
    seed: int = Field(default=0, ge=0)
    candidates_per_round: int = Field(default=40, ge=2, le=200)
    per_round: int = Field(default=10, ge=1, le=50)


class SearchTestRecord(BaseModel):
    scenario: Scenario
    prediction: ModelPrediction | None = Field(description="present when the TCN screened this scenario")
    result: SimulationResult = Field(description="ground truth from the simulator")


class ScenarioSearchResponse(BaseModel):
    strategy_requested: SearchStrategyName
    strategy_used: str
    used_tcn_selection: bool
    notes: list[str]
    budget: int
    simulations_run: int
    stress_test_failures: int = Field(description="simulator failures found (not a real-world probability)")
    distinct_failure_conditions: int
    tests_until_first_failure: int | None
    candidates_screened: int
    screening_sim_seconds: float = Field(description="simulated prefix time spent screening candidates")
    tested: list[SearchTestRecord]


class ModelStatus(BaseModel):
    available: bool
    path: str
    metadata: dict | None = Field(default=None, description="training metadata / evaluation read from disk")


class AIStatus(BaseModel):
    tcn: ModelStatus
    tcn_heldout_evaluation: dict | None = Field(description="metrics from scripts/evaluate_tcn.py on held-out simulator data")
    sac: ModelStatus
    default_strategy: SearchStrategyName
    experiment: dict | None = Field(description="summary from scripts/run_experiment.py, if it has been run")
