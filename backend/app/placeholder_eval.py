"""
TEMPORARY stand-in for backend/evaluation.py (Person A's ownership).

Runs a fixed suite of stress tests headlessly through the *same* Session
engine the live demo uses (same step(), same fault windows, same warning
path), with one scripted driver whose braking is triggered only by the
warnings it receives. Because the driver reacts to warnings rather than
replaying frozen inputs, a better warning system can change the braking.

The suite and acceptance criteria are fixed here, before any upgrade is
compared. Fault severities come from the brief's ranges (grip 0.65-1.0,
delay 0-400 ms, brake fade 0.8-1.0); paired faults use a capped combined
severity. Do not edit the suite to make an affordable upgrade pass.
"""

from __future__ import annotations

import math
import random
from concurrent.futures import ProcessPoolExecutor
from dataclasses import dataclass

from app.budget import enumerate_configs
from app.placeholder_sim import (
    G_LAT,
    MAX_CURVATURE,
    TRACK_PRESETS,
    DemoVehicleState,
    initial_state,
    loop_size,
)
from app.schemas import (
    Acceptance,
    ConfigResult,
    EvaluationResponse,
    FaultState,
    HazardZone,
    ReplayFrame,
    ReplayRun,
    ScenarioConfig,
    SuiteInfo,
    SuiteTestInfo,
    TestResult,
    TrackId,
    UpgradeConfig,
    UpgradeOption,
)
from app.session_state import TICK_DT, Session

SUITE_VERSION = "suite-v3"
ACCEPTANCE = Acceptance(max_track_exits=0, min_clearance_m=0.5, require_lap_complete=True)
MAX_TICKS = 6000  # 300 s at 20 Hz — a lap that takes longer counts as not completed
HOLD_AFTER_M = 25.0
TARGET_MARGIN = 0.97
FRAME_EVERY_TICKS = 2  # 10 Hz replay frames


REPLICATES = 3


def _test(
    track: TrackId,
    slug: str,
    name: str,
    replicate: int,
    seed: int,
    faults: FaultState,
    window: tuple[float, float],
) -> SuiteTestInfo:
    """One seeded stress variation: reaction delay, cruise (entry) speed and
    starting lateral position are drawn from the seed, so every replicate of
    a fault type is a different but reproducible driver/start condition."""
    profile = TRACK_PRESETS[track]
    rng = random.Random(seed)
    return SuiteTestInfo(
        id=f"{track}_{slug}_{replicate}",
        track=track,
        name=f"{name} #{replicate}",
        seed=seed,
        faults=faults,
        onset_distance=round(window[0] * profile.total_length, 1),
        end_distance=round(window[1] * profile.total_length, 1),
        cruise_speed=round(rng.uniform(80.0, 88.0), 1),
        reaction_s=round(rng.uniform(0.25, 0.40), 2),
        lateral_offset=round(rng.uniform(-0.25, 0.25) * profile.track_width / 2, 3),
    )


# Severity rule, fixed before comparing any upgrade: single faults sit at the
# worst end of the declared range; paired faults use 75% of each worst case
# (capped combined severity).
WORST = FaultState(grip_multiplier=0.65, telemetry_delay_ms=400, brake_wear=0.80)


def _pair_level(worst: float, healthy: float) -> float:
    return round(healthy + 0.75 * (worst - healthy), 3)


PAIR = FaultState(
    grip_multiplier=_pair_level(WORST.grip_multiplier, 1.0),
    telemetry_delay_ms=_pair_level(WORST.telemetry_delay_ms, 0.0),
    brake_wear=_pair_level(WORST.brake_wear, 1.0),
)


def _track_tests(track: TrackId, base_seed: int) -> list[SuiteTestInfo]:
    whole, patch = (0.0, 1.0), (0.0, 0.6)
    kinds = [
        ("nominal", "Nominal (no faults)", FaultState(), whole),
        ("stale_telemetry", f"Stale telemetry ({WORST.telemetry_delay_ms:.0f} ms)",
         FaultState(telemetry_delay_ms=WORST.telemetry_delay_ms), whole),
        ("brake_fade", f"Brake fade ({WORST.brake_wear:.2f})",
         FaultState(brake_wear=WORST.brake_wear), whole),
        ("grip_patch", f"Grip loss patch ({WORST.grip_multiplier:.2f})",
         FaultState(grip_multiplier=WORST.grip_multiplier), patch),
        ("delay_and_fade", "Stale telemetry + brake fade (paired)",
         FaultState(telemetry_delay_ms=PAIR.telemetry_delay_ms, brake_wear=PAIR.brake_wear), whole),
        ("grip_and_delay", "Grip loss patch + stale telemetry (paired)",
         FaultState(grip_multiplier=PAIR.grip_multiplier,
                    telemetry_delay_ms=PAIR.telemetry_delay_ms), patch),
    ]
    tests = []
    for k, (slug, name, faults, window) in enumerate(kinds):
        for replicate in range(1, REPLICATES + 1):
            seed = base_seed + k * 10 + replicate
            tests.append(_test(track, slug, name, replicate, seed, faults, window))
    return tests


SUITE_TESTS: list[SuiteTestInfo] = _track_tests("monza", 100) + _track_tests("baku", 200)
TESTS_BY_ID = {t.id: t for t in SUITE_TESTS}


def suite_info() -> SuiteInfo:
    return SuiteInfo(version=SUITE_VERSION, acceptance=ACCEPTANCE, tests=SUITE_TESTS)


# --- scripted driver ------------------------------------------------------


class ScriptedDriver:
    """Follows the centerline and cruises; brakes to a hazard's corner speed
    only after a BRAKE warning plus its reaction delay. It has no other
    knowledge of upcoming corners, so a late or missing warning means a late
    or missing brake."""

    def __init__(self, profile, cruise: float, reaction_s: float) -> None:
        self.centerline = profile.centerline
        self.n = loop_size(self.centerline)
        self.step = profile.total_length / self.n
        self.hazards = {h.id: h for h in profile.hazard_zones}
        self.cruise = cruise
        self.reaction_s = reaction_s
        self.pending: tuple[HazardZone, float] | None = None
        self.latched: HazardZone | None = None
        self.advised: float = 0.0

    def on_warning(self, event: dict, t: float) -> None:
        if not event["active"] or event["hazard_id"] is None:
            return
        hazard = self.hazards[event["hazard_id"]]
        already = self.latched is hazard or (self.pending is not None and self.pending[0] is hazard)
        if not already:
            self.pending = (hazard, t + self.reaction_s)
        if event.get("advised_speed") is not None:
            self.advised = event["advised_speed"]

    def control(self, vehicle: DemoVehicleState, t: float) -> tuple[float, float, float]:
        if self.pending and t >= self.pending[1]:
            self.latched, self.pending = self.pending[0], None
        if self.latched and vehicle.distance_along_lap >= self.latched.end_distance + HOLD_AFTER_M:
            self.latched = None

        target = self.advised * TARGET_MARGIN if self.latched else self.cruise

        # Pure pursuit: steer along the arc that reaches a point ~0.25 s ahead
        # on the centerline, as a fraction of what nominal grip allows.
        lookahead_m = 5.0 + 0.25 * vehicle.speed
        ahead = max(1, math.ceil(lookahead_m / self.step))
        tx, ty = self.centerline[(vehicle.nearest_point_index + ahead) % self.n]
        dx, dy = tx - vehicle.x, ty - vehicle.y
        alpha = (math.atan2(dy, dx) - vehicle.heading + math.pi) % (2 * math.pi) - math.pi
        wanted_curvature = 2 * math.sin(alpha) / max(math.hypot(dx, dy), 1.0)
        capacity = min(MAX_CURVATURE, G_LAT / max(vehicle.speed**2, 1.0))
        steering = max(-1.0, min(1.0, wanted_curvature / capacity))

        speed_error = target - vehicle.speed
        if speed_error < -0.3:
            return steering, 0.0, 1.0
        if speed_error > 0.3:
            return steering, 0.8, 0.0
        return steering, 0.3, 0.0


# --- runner ---------------------------------------------------------------


@dataclass
class RunOutput:
    result: TestResult
    frames: list[ReplayFrame]


def run_test(test: SuiteTestInfo, upgrades: UpgradeConfig, record: bool = False) -> RunOutput:
    profile = TRACK_PRESETS[test.track]
    scenario = ScenarioConfig(
        id=test.id,
        name=test.name,
        description="",
        track=test.track,
        seed=test.seed,
        faults=test.faults,
        onset_distance=test.onset_distance,
        end_distance=test.end_distance,
    )
    session = Session(
        session_id=f"eval-{test.id}",
        track_profile=profile,
        seed=test.seed,
        upgrades=upgrades,
        scenario=scenario,
    )
    session.vehicle = initial_state(profile, test.lateral_offset)
    driver = ScriptedDriver(profile, test.cruise_speed, test.reaction_s)

    min_clearance = math.inf
    first_warning: dict[str, float] = {}
    crossed: set[str] = set()
    leads: list[float] = []
    missed = 0
    frames: list[ReplayFrame] = []
    lap_time: float | None = None
    steering = throttle = brake = 0.0
    state: dict = {}

    for i in range(1, MAX_TICKS + 1):
        t = i * TICK_DT
        steering, throttle, brake = driver.control(session.vehicle, t)
        session.control.update(steering=steering, throttle=throttle, brake=brake)
        messages = session.tick(now=session.start_time + t)

        warning_active = session.warning_active
        for message in messages:
            if message["type"] == "warning_event":
                driver.on_warning(message, t)
                hazard_id = message["hazard_id"]
                if message["active"] and hazard_id not in first_warning:
                    first_warning[hazard_id] = t
            elif message["type"] == "vehicle_state":
                state = message

        min_clearance = min(min_clearance, state["signed_clearance"])

        distance = session.vehicle.distance_along_lap
        for hazard in profile.hazard_zones:
            if hazard.id in crossed or distance < hazard.start_distance:
                continue
            crossed.add(hazard.id)
            if hazard.id in first_warning:
                leads.append(t - first_warning[hazard.id])
            elif state["speed"] > hazard.corner_speed * 1.05:
                missed += 1

        if record and i % FRAME_EVERY_TICKS == 0:
            frames.append(
                ReplayFrame(
                    t=round(t, 3),
                    x=round(state["x"], 3),
                    y=round(state["y"], 3),
                    heading=round(state["heading"], 4),
                    speed=round(state["speed"], 3),
                    throttle=round(throttle, 2),
                    brake=round(brake, 2),
                    distance=round(distance, 2),
                    clearance=round(state["signed_clearance"], 3),
                    warning_active=warning_active,
                    track_exit=state["track_exit"],
                    lap_complete=state["lap_complete"],
                )
            )

        if state["lap_complete"]:
            lap_time = t
            break
        if state["track_exit"]:
            break

    track_exit = bool(state.get("track_exit"))
    completed = bool(state.get("lap_complete"))
    passed = (
        (not track_exit)
        and (completed or not ACCEPTANCE.require_lap_complete)
        and min_clearance >= ACCEPTANCE.min_clearance_m
    )
    result = TestResult(
        test_id=test.id,
        track=test.track,
        passed=passed,
        track_exit=track_exit,
        completed=completed,
        min_clearance_m=round(min_clearance, 3),
        min_warning_lead_s=round(min(leads), 3) if leads else None,
        warnings_missed=missed,
        lap_time_s=round(lap_time, 2) if lap_time is not None else None,
    )
    return RunOutput(result=result, frames=frames)


def evaluate_config(option: UpgradeOption) -> ConfigResult:
    results = [run_test(test, option.upgrades).result for test in SUITE_TESTS]
    leads = [r.min_warning_lead_s for r in results if r.min_warning_lead_s is not None]
    return ConfigResult(
        key=option.key,
        label=option.label,
        upgrades=option.upgrades,
        cost_cad=option.cost_cad,
        test_count=len(results),
        track_exits=sum(r.track_exit for r in results),
        min_clearance_m=min(r.min_clearance_m for r in results),
        min_warning_lead_s=min(leads) if leads else None,
        warnings_missed=sum(r.warnings_missed for r in results),
        passed=all(r.passed for r in results),
        failed_test_ids=[r.test_id for r in results if not r.passed],
        tests=results,
    )


_CACHE: EvaluationResponse | None = None


def _evaluate_option_dict(option_dict: dict) -> dict:
    return evaluate_config(UpgradeOption.model_validate(option_dict)).model_dump()


def evaluate_all(use_cache: bool = True, parallel: bool = True) -> EvaluationResponse:
    """All eight configurations on the same suite. Deterministic, so cached."""
    global _CACHE
    if use_cache and _CACHE is not None:
        return _CACHE
    options = enumerate_configs()
    configs: list[ConfigResult] | None = None
    if parallel:
        try:
            with ProcessPoolExecutor() as pool:
                dumped = list(pool.map(_evaluate_option_dict, [o.model_dump() for o in options]))
            configs = [ConfigResult.model_validate(d) for d in dumped]
        except Exception:  # e.g. a pool that can't spawn: slower beats broken
            configs = None
    if configs is None:
        configs = [evaluate_config(o) for o in options]
    response = EvaluationResponse(suite=suite_info(), configs=configs)
    if use_cache:
        _CACHE = response
    return response


def replay(test_id: str, baseline: UpgradeConfig, upgraded: UpgradeConfig):
    from app.budget import config_label

    test = TESTS_BY_ID[test_id]
    runs = []
    for prefix, cfg in (("Baseline", baseline), ("Upgraded", upgraded)):
        output = run_test(test, cfg, record=True)
        name = config_label(cfg)
        runs.append(
            ReplayRun(
                label=name if name.startswith(prefix) else f"{prefix}: {name}",
                upgrades=cfg,
                result=output.result,
                frames=output.frames,
            )
        )
    return test, runs[0], runs[1]
