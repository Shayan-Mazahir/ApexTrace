"""
Gymnasium environment: an adversary that schedules bounded faults to find
weaknesses in the warning system. It controls the FAULTS only; the scripted
driver drives and reacts to the displayed warnings. Same StressRun engine.

Episode: a short rollout starting 450-800 m before a target corner (fast to
train); any discovered schedule is re-evaluated in a complete-lap run.

Action (every 0.5 s): three values in [-1, 1] mapped to targets for
  grip loss      grip multiplier 1.0 -> 0.6
  uplink delay   0 -> 400 ms
  brake fade     effectiveness 1.0 -> 0.7
Hard limits (enforced, not just penalised): each level moves at most
MAX_STEP per decision; total integrated disturbance is capped by BUDGET;
once spent, all faults are forced off.

Reward: +10 on track exit; +danger increase (drop in the running minimum
true clearance, per metre); minus magnitude and abrupt-change penalties.
Successful completion of the corner ends the episode without bonus.
"""

from __future__ import annotations

import math
import random
from typing import Any

import gymnasium as gym
import numpy as np
from gymnasium import spaces

from app.placeholder_sim import TRACK_PRESETS, signed_clearance
from app.schemas import UpgradeConfig
from app.stress.evaluation import ScriptedDriver
from app.stress.run import TICK_DT, RunConfig, StressRun
from app.stress.spec import DriverConfig, FaultSpec, StartConfig, StressScenario

DECISION_TICKS = 10  # 0.5 s
MAX_STEP = 0.25  # max change of a normalised level per decision
BUDGET = 6.0  # level-seconds summed over the three channels
MAG_PENALTY = 0.05
CHANGE_PENALTY = 0.2
EXIT_REWARD = 10.0
GRIP_RANGE = (1.0, 0.6)
DELAY_RANGE = (0.0, 400.0)
FADE_RANGE = (1.0, 0.7)


def levels_to_params(levels: np.ndarray) -> dict[str, float]:
    g, d, f = (float(np.clip(x, 0, 1)) for x in levels)
    return {
        "grip_multiplier": GRIP_RANGE[0] + (GRIP_RANGE[1] - GRIP_RANGE[0]) * g,
        "delay_ms": DELAY_RANGE[0] + (DELAY_RANGE[1] - DELAY_RANGE[0]) * d,
        "effectiveness": FADE_RANGE[0] + (FADE_RANGE[1] - FADE_RANGE[0]) * f,
    }


class FaultAdversaryEnv(gym.Env):
    metadata = {"render_modes": []}

    def __init__(self, track: str = "monza", hazards: list[str] | None = None, upgrades: UpgradeConfig | None = None,
                 seed: int = 0) -> None:
        super().__init__()
        self.profile = TRACK_PRESETS[track]
        self.track = track
        self.hazard_ids = hazards or [h.id for h in self.profile.hazard_zones]
        self.upgrades = upgrades or UpgradeConfig()
        self.rng = random.Random(seed)
        self.action_space = spaces.Box(-1.0, 1.0, shape=(3,), dtype=np.float32)
        self.observation_space = spaces.Box(-5.0, 5.0, shape=(11,), dtype=np.float32)
        self.interactions = 0  # decision steps taken (the budget unit)

    # -- helpers ---------------------------------------------------------------

    def _obs(self) -> np.ndarray:
        v = self.run.vehicle
        ahead = (self.hazard.start_distance - v.distance_along_lap) % self.profile.total_length
        shown = self.run.display.shown
        warn = 0.0 if shown is None or shown.state == "clear" else (1.0 if shown.state == "brake" else 2.0)
        return np.array([
            v.speed / 88.0,
            min(ahead, 1000.0) / 500.0,
            self.clearance / 7.0,
            (v.heading - self.prev_heading) / TICK_DT / 2.0,
            warn,
            *self.levels,
            min(self.run.t / 25.0, 2.0),
            self.budget_left / BUDGET,
            min(len(self.run.uplink.queue), 20) / 20.0,
        ], dtype=np.float32)

    def _set_levels(self) -> None:
        params = levels_to_params(self.levels)
        self.grip.spec.parameters["grip_multiplier"] = params["grip_multiplier"]
        self.delay.spec.parameters["delay_ms"] = params["delay_ms"]
        self.fade.spec.parameters["effectiveness"] = params["effectiveness"]

    # -- gym API -----------------------------------------------------------------

    def reset(self, *, seed: int | None = None, options: dict | None = None):
        super().reset(seed=seed)
        if seed is not None:
            self.rng = random.Random(seed)
        pick = self.rng.choice(self.hazard_ids)
        self.hazard = next(h for h in self.profile.hazard_zones if h.id == pick)
        total = self.profile.total_length
        start_d = (self.hazard.start_distance - self.rng.uniform(450, 800)) % total
        for _ in range(30):
            d = (self.hazard.start_distance - self.rng.uniform(450, 800)) % total
            if not any(h.start_distance - 80 <= d <= h.end_distance + 60 for h in self.profile.hazard_zones):
                start_d = d
                break
        scenario = StressScenario(
            id="sac_episode", name="sac", track=self.track, seed=self.rng.randint(1, 10**6),
            faults=[
                FaultSpec(id="sac_grip", type="grip_loss", parameters={"grip_multiplier": 1.0}, source="sac"),
                FaultSpec(id="sac_delay", type="uplink_delay", parameters={"delay_ms": 0.0}, source="sac"),
                FaultSpec(id="sac_fade", type="brake_fade", parameters={"effectiveness": 1.0}, source="sac"),
            ],
            start=StartConfig(distance_m=round(start_d, 1), speed_ms=round(self.rng.uniform(45, 70), 1)),
            driver=DriverConfig(cruise_speed_ms=round(self.rng.uniform(78, 88), 1), reaction_s=0.3),
        )
        self.scenario = scenario
        self.run = StressRun(RunConfig(profile=self.profile, scenario=scenario, upgrades=self.upgrades,
                                       seed=scenario.seed))
        byid = {f.spec.id: f for f in self.run.scheduler.faults}
        self.grip, self.delay, self.fade = byid["sac_grip"], byid["sac_delay"], byid["sac_fade"]
        self.driver = ScriptedDriver(self.profile, scenario.driver.cruise_speed_ms, scenario.driver.reaction_s)
        self.levels = np.zeros(3, dtype=np.float32)
        self.budget_left = BUDGET
        self.prev_heading = self.run.vehicle.heading
        v = self.run.vehicle
        self.clearance = signed_clearance(v.x, v.y, self.profile, hint=v.nearest_point_index)
        self.min_clearance = self.clearance
        self.schedule: list[dict[str, Any]] = []
        self.start_distance = v.distance_along_lap
        self._set_levels()
        return self._obs(), {}

    def step(self, action: np.ndarray):
        self.interactions += 1
        target = (np.clip(np.asarray(action, dtype=np.float32), -1, 1) + 1) / 2
        change = np.clip(target - self.levels, -MAX_STEP, MAX_STEP)  # rate limit (hard)
        new = np.clip(self.levels + change, 0, 1)
        if self.budget_left <= 0:
            new = np.zeros(3, dtype=np.float32)  # budget exhausted: faults forced off (hard)
        abrupt = float(np.abs(new - self.levels).sum())
        self.levels = new
        self._set_levels()
        v = self.run.vehicle
        self.schedule.append({"t": round(self.run.t, 2), "distance": round(v.distance_along_lap, 1),
                              "levels": [round(float(x), 3) for x in new], **levels_to_params(new)})

        prev_min = self.min_clearance
        exited = False
        for _ in range(DECISION_TICKS):
            self.prev_heading = self.run.vehicle.heading
            c = self.driver.control(self.run.vehicle, self.run.t + TICK_DT, self.run.effective.driver_max_brake)
            for ev in self.run.tick(*c):
                if ev["type"] == "warning_event":
                    self.driver.on_warning(ev, self.run.t, 0.0, 0)
            v = self.run.vehicle
            self.clearance = signed_clearance(v.x, v.y, self.profile, hint=v.nearest_point_index)
            self.min_clearance = min(self.min_clearance, self.clearance)
            if v.track_exit:
                exited = True
                break
        self.budget_left -= float(self.levels.sum()) * DECISION_TICKS * TICK_DT

        reward = max(0.0, prev_min - self.min_clearance)  # danger increase, metres
        reward -= MAG_PENALTY * float(self.levels.sum()) + CHANGE_PENALTY * abrupt
        passed = (v.distance_along_lap - self.start_distance) > (
            (self.hazard.end_distance - self.start_distance) % self.profile.total_length + 60)
        terminated = exited or passed
        truncated = self.run.t > 40.0
        if exited:
            reward += EXIT_REWARD
        info = {"exited": exited, "min_clearance": self.min_clearance, "hazard": self.hazard.id}
        return self._obs(), float(reward), terminated, truncated, info
