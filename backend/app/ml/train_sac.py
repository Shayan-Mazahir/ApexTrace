"""
SAC fault adversary vs random search, same interaction budget.

  python -m app.ml.train_sac

Both get BUDGET decision steps (0.5 s each) on the same environment. SAC's
training interactions count toward its budget: every failure it finds while
learning counts, and whatever budget is left after training is spent on
deterministic rollouts of the learned policy. Random search spends its
whole budget on random actions under the same bounds and rate limits.

Reported: steps to first failure, failures found, severity (lowest true
clearance), distinct failure bins (corner x dominant fault), wall time.
The most severe SAC-found schedules are converted to distance-triggered
scenarios (source "sac") and re-evaluated in a complete-lap run.
SAC is not promised to beat random search; the numbers say what happened.
"""

from __future__ import annotations

import json
import time
from datetime import datetime, timezone
from pathlib import Path

import numpy as np

from app.ml.sac_env import FaultAdversaryEnv
from app.stress.evaluation import run_scenario
from app.stress.spec import FaultSpec, StressScenario

OUT_DIR = Path(__file__).resolve().parents[2] / "models" / "sac"
DISCOVERED_DIR = Path(__file__).resolve().parents[3] / "scenarios" / "discovered"
FAULT_NAMES = ["grip", "delay", "fade"]


class Tracker:
    def __init__(self, name: str) -> None:
        self.name = name
        self.steps = 0
        self.first_failure_step: int | None = None
        self.failures: list[dict] = []
        self.episodes = 0
        self.started = time.time()
        self.wall: float | None = None

    def finish(self) -> "Tracker":
        self.wall = round(time.time() - self.started, 1)
        return self

    def episode_end(self, env: FaultAdversaryEnv, exited: bool) -> None:
        self.episodes += 1
        if exited:
            if self.first_failure_step is None:
                self.first_failure_step = self.steps
            sched = env.schedule
            mean_levels = np.mean([s["levels"] for s in sched], axis=0) if sched else np.zeros(3)
            self.failures.append({
                "hazard": env.hazard.id,
                "dominant_fault": FAULT_NAMES[int(np.argmax(mean_levels))],
                "min_clearance": round(env.min_clearance, 3),
                "mean_levels": [round(float(x), 3) for x in mean_levels],
                "schedule": sched,
                "scenario_seed": env.scenario.seed,
                "start": env.scenario.start.model_dump(),
                "driver": env.scenario.driver.model_dump(),
                "step": self.steps,
            })

    def report(self) -> dict:
        bins = {(f["hazard"], f["dominant_fault"]) for f in self.failures}
        return {
            "method": self.name,
            "interaction_steps": self.steps,
            "episodes": self.episodes,
            "first_failure_step": self.first_failure_step,
            "failures_found": len(self.failures),
            "worst_min_clearance_m": min((f["min_clearance"] for f in self.failures), default=None),
            "distinct_failure_bins": len(bins),
            "bins": sorted(f"{h} / {d}" for h, d in bins),
            "wall_seconds": self.wall if self.wall is not None else round(time.time() - self.started, 1),
        }


def run_random(budget: int, seed: int, track: str) -> Tracker:
    env = FaultAdversaryEnv(track=track, seed=seed)
    tr = Tracker("random search")
    rng = np.random.default_rng(seed)
    obs, _ = env.reset(seed=seed)
    while tr.steps < budget:
        obs, _, term, trunc, info = env.step(rng.uniform(-1, 1, size=3))
        tr.steps += 1
        if term or trunc:
            tr.episode_end(env, info["exited"])
            obs, _ = env.reset()
    return tr.finish()


def run_sac(budget: int, train_steps: int, seed: int, track: str) -> tuple[Tracker, object]:
    from stable_baselines3 import SAC
    from stable_baselines3.common.callbacks import BaseCallback

    env = FaultAdversaryEnv(track=track, seed=seed)
    tr = Tracker("SAC")

    model = SAC("MlpPolicy", env, policy_kwargs={"net_arch": [64, 64]}, seed=seed, verbose=0,
                learning_starts=200)
    # SB3 resets the env itself, so the tracker must read the env's schedule
    # BEFORE the auto-reset: record at the step that ends the episode.
    orig_step = env.step

    def step_and_capture(action):
        out = orig_step(action)
        _, _, term, trunc, info = out
        if term or trunc:
            env._last_episode = {"schedule": list(env.schedule), "hazard": env.hazard,
                                 "min_clearance": env.min_clearance, "scenario": env.scenario}
        return out

    env.step = step_and_capture

    class EnvView:
        """What Tracker.episode_end reads, frozen at episode end."""

    def end(exited: bool) -> None:
        last = env._last_episode
        view = EnvView()
        view.schedule, view.hazard, view.min_clearance, view.scenario = (
            last["schedule"], last["hazard"], last["min_clearance"], last["scenario"])
        Tracker.episode_end(tr, view, exited)

    class CountCapture(BaseCallback):
        def _on_step(self) -> bool:
            tr.steps += 1
            if self.locals["dones"][0]:
                end(bool(self.locals["infos"][0].get("exited")))
            return True

    model.learn(total_timesteps=train_steps, callback=CountCapture())
    # remaining budget: deterministic rollouts of the learned policy
    obs, _ = env.reset()
    while tr.steps < budget:
        action, _ = model.predict(obs, deterministic=True)
        obs, _, term, trunc, info = env.step(action)
        tr.steps += 1
        if term or trunc:
            end(bool(info["exited"]))
            obs, _ = env.reset()
    return tr.finish(), model


def to_scenario(failure: dict, track: str, name: str) -> StressScenario:
    """Distance-triggered faults, one per 0.5 s decision, so the schedule
    replays at the same place on the lap regardless of timing."""
    faults = []
    sched = failure["schedule"]
    for i, s in enumerate(sched):
        start = s["distance"]
        end = sched[i + 1]["distance"] if i + 1 < len(sched) else start + 60
        if end <= start + 0.5:
            continue
        common = {"trigger": {"kind": "distance", "start": round(start, 1), "end": round(end, 1),
                              "repeat": "once_per_run"}, "source": "sac"}
        if s["grip_multiplier"] < 0.999:
            faults.append(FaultSpec(id=f"g{i}", type="grip_loss", parameters={"grip_multiplier": round(s["grip_multiplier"], 3)}, **common))
        if s["delay_ms"] > 1:
            faults.append(FaultSpec(id=f"d{i}", type="uplink_delay", parameters={"delay_ms": round(s["delay_ms"], 1)}, **common))
        if s["effectiveness"] < 0.999:
            faults.append(FaultSpec(id=f"f{i}", type="brake_fade", parameters={"effectiveness": round(s["effectiveness"], 3)}, **common))
    return StressScenario(id=name, name=f"SAC-discovered: {failure['hazard']} ({failure['dominant_fault']})",
                          description="Fault schedule found by the SAC adversary (distance-triggered replay).",
                          track=track, seed=failure["scenario_seed"], faults=faults, source="sac")


def summarise(reports: list[dict]) -> dict:
    firsts = [r["first_failure_step"] for r in reports]
    found = [r["first_failure_step"] for r in reports if r["first_failure_step"] is not None]
    return {
        "method": reports[0]["method"],
        "seeds": len(reports),
        "seeds_with_a_failure": len(found),
        "first_failure_step_per_seed": firsts,
        "median_first_failure_step": float(np.median(found)) if found else None,
        "failures_found_total": sum(r["failures_found"] for r in reports),
        "worst_min_clearance_m": min((r["worst_min_clearance_m"] for r in reports if r["worst_min_clearance_m"] is not None), default=None),
        "distinct_failure_bins": len({b for r in reports for b in r["bins"]}),
        "bins": sorted({b for r in reports for b in r["bins"]}),
        "wall_seconds_total": round(sum(r["wall_seconds"] for r in reports), 1),
    }


def main(budget: int = 6000, train_steps: int = 4500, seeds: tuple[int, ...] = (7, 8, 9), track: str = "monza") -> dict:
    """Each seed: random search and SAC with the same budget and the same
    episode start sequence. The model saved is the last seed's."""
    t0 = time.time()
    per_seed, sac_failures, model = [], [], None
    for seed in seeds:
        rnd = run_random(budget, seed, track)
        sac, model = run_sac(budget, train_steps, seed, track)
        print(f"seed {seed}: random {rnd.report()}\n         sac {sac.report()}", flush=True)
        per_seed.append({"seed": seed, "random": rnd.report(), "sac": sac.report()})
        sac_failures += sac.failures

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    model.save(OUT_DIR / "sac_fault_adversary")
    DISCOVERED_DIR.mkdir(parents=True, exist_ok=True)
    for old in DISCOVERED_DIR.glob(f"sac_{track}_*.json"):
        old.unlink()
    exported = []
    seen = set()
    for f in sorted(sac_failures, key=lambda f: f["min_clearance"]):
        key = (f["hazard"], f["dominant_fault"])
        if key in seen:
            continue
        seen.add(key)
        name = f"sac_{track}_{f['hazard']}_{f['dominant_fault']}"
        scenario = to_scenario(f, track, name)
        full_lap = run_scenario(scenario).result  # complete-lap re-evaluation, from the grid
        (DISCOVERED_DIR / f"{name}.json").write_text(json.dumps(scenario.model_dump(), indent=2) + "\n")
        exported.append({"scenario_id": name, "segment_min_clearance": f["min_clearance"],
                         "full_lap_track_exit": full_lap["track_exit"], "full_lap_passed": full_lap["passed"],
                         "full_lap_min_clearance": full_lap["min_clearance_m"],
                         "full_lap_exit_location": full_lap["exit_location"]})
        if len(exported) >= 4:
            break

    report = {
        "created": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "track": track,
        "budget_decision_steps_per_seed": budget,
        "sac_training_steps_within_budget": train_steps,
        "decision_period_s": 0.5,
        "bounds": {"grip_multiplier": [0.6, 1.0], "uplink_delay_ms": [0, 400], "brake_effectiveness": [0.7, 1.0],
                   "max_level_change_per_step": 0.25, "integrated_budget_level_seconds": 6.0},
        "results": [summarise([s["random"] for s in per_seed]), summarise([s["sac"] for s in per_seed])],
        "per_seed": per_seed,
        "exported_schedules": exported,
        "note": "SAC is compared with random search under identical bounds, driver, start distribution and "
                "interaction budget (SAC's training steps included), over several seeds. Schedules are "
                "re-evaluated in complete laps from the grid, where the car arrives at different speeds, so a "
                "segment failure need not reproduce.",
        "total_seconds": round(time.time() - t0, 1),
    }
    (OUT_DIR / "report.json").write_text(json.dumps(report, indent=2))
    return report


if __name__ == "__main__":
    print(json.dumps(main(), indent=2))
