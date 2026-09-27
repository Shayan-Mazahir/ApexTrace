"""End-to-end walkthrough of the Person A pipeline, using the trained artifacts.

    python scripts/demo.py

1. Preset lap -> baseline run fails at some corner -> each upgrade re-run on the SAME scenario.
2. Replay saved for baseline and upgraded runs.
3. Candidate scenarios -> SAC proposals + TCN screening -> selected scenarios
   -> real simulator -> ground truth (prediction and result shown side by side).
"""

from __future__ import annotations

import json
from pathlib import Path

import _path  # noqa: F401

from app.ai.inference import get_predictor, model_available
from app.ai.search_pipeline import make_strategy, selected_search
from app.schemas import ConfigurationName, Scenario
from app.sim.replay import build_replay, save_replay
from app.sim.runner import run_scenario
from app.sim.scenario_space import ScenarioSpace

ROOT = Path(__file__).resolve().parents[2]


def section(title: str) -> None:
    print(f"\n=== {title} " + "=" * max(0, 70 - len(title)))


def main() -> None:
    section("1. Baseline vs upgrades on identical scenarios (simulator ground truth)")
    for name in ("monza_worn_brakes", "monza_telemetry_delay", "baku_stale_telemetry", "monza_grip_mismatch"):
        sc = Scenario.model_validate(json.loads((ROOT / "scenarios" / "presets" / f"{name}.json").read_text())["scenario"])
        cells = []
        for cfg in ConfigurationName:
            r = run_scenario(sc, cfg)
            cells.append(f"{cfg.value}=" + (f"FAIL@{r.failure_corner}" if r.failed else f"lap {r.metrics.lap_time:.1f}s"))
        print(f"{name:22s} " + " | ".join(cells))

    section("2. Replays")
    sc = Scenario.model_validate(json.loads((ROOT / "scenarios" / "presets" / "monza_worn_brakes.json").read_text())["scenario"])
    for cfg in (ConfigurationName.BASELINE, ConfigurationName.BRAKE_SERVICE):
        rp = build_replay(sc, cfg, sample_hz=20)
        p = save_replay(rp, Path("data/replays") / f"{sc.scenario_id}_{cfg.value}.json")
        ev = ", ".join(f"{e.kind}({e.detail or ''})@{e.timestamp:.1f}s" for e in rp.events
                       if e.kind in ("left_track", "lap_completed", "finished"))
        n_entries = sum(e.kind == "corner_entry" for e in rp.events)
        print(f"{cfg.value:14s} {'FAIL' if rp.result.failed else 'pass'}  {len(rp.frames)} frames, "
              f"{n_entries} corners reached -> {p}\n    {ev}")

    section("3. Adversarial search -> TCN screening -> simulator")
    if not model_available():
        print("no trained TCN in models/tcn; run scripts/train_tcn.py first")
        return
    strategy, note = make_strategy("sac", ScenarioSpace(), seed=42)
    if note:
        print("note:", note)
    out = selected_search(strategy, budget=10, predictor=get_predictor(), per_round=5, candidates_per_round=30, seed=42)
    print(f"strategy {out.method}: screened {out.candidates_screened} candidates "
          f"({out.screening_sim_seconds:.0f} s of prefix simulation), ran {len(out.tested)} full simulations")
    print(f"{'scenario':18s} {'track':6s} {'model p(fail)':>13s} {'±':>6s}  simulator")
    for t in out.tested:
        p = t.prediction
        print(f"{t.scenario.scenario_id:18s} {t.scenario.track:6s} {p.predicted_failure_probability:13.2f} "
              f"{p.uncertainty:6.2f}  " + (f"FAIL at {t.result.failure_corner}" if t.result.failed
                                           else f"pass (lap {t.result.metrics.lap_time:.1f} s)"))
    print(f"stress-test failures found: {len(out.failures)} of {len(out.tested)} simulations "
          f"({out.distinct_failure_conditions} distinct conditions)")


if __name__ == "__main__":
    main()
