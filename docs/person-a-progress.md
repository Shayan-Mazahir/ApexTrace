# Person A progress log (simulator + safety testing + AI)

Resumption point for any session. Read this first; it says what exists, what
is next, and where artifacts live. Design details are in `ARCHITECTURE.md`.

## Already implemented (Phase 0, before Person A work)

- `backend/app/main.py`: FastAPI app, CORS for `http://localhost:5173`, `GET /health`.
- `backend/app/schemas.py`: Pydantic `HealthStatus`, mirrored in `frontend/src/types/schemas.ts`.
- `frontend/`: Vite + React + React Three Fiber placeholder scene (Person B).
- No Python tests or lint; frontend has `npm run build` (tsc) and `npm run lint` (oxlint).

## Missing at audit time

Everything Person A owns (simulator, faults, safety system, runner, replay,
data, TCN, search, selection, upgrades, API, tests).

## Person A implementation plan (layout adapted to the real repo)

```
backend/app/schemas.py      shared contract (mirrored in frontend/src/types/schemas.ts)
backend/app/sim/            track, vehicle, safety, faults, driver, simulator, runner, upgrades, replay, evaluation, scenario_space
backend/app/ai/             features, dataset, tcn, metrics, training, inference, reward, search/, selection, search_pipeline, experiment
backend/app/services/       simulation_service, ai_service
backend/app/api/            simulation (HTTP), live (WebSocket), ai
backend/scripts/            generate_data, train_tcn, evaluate_tcn, train_sac, run_experiment, demo
backend/tests/              pytest suite
backend/models/             trained artifacts (committed)
backend/data/               generated datasets and replays (gitignored)
scenarios/                  preset scenario JSON
```

## Full-lap rework (2026-09-26)

Scenarios are now one flying lap of a closed track instead of a single corner:
- `track.py`: Monza (~4.4 km, 11 corners, clockwise) and Baku (~4.3 km, 13 corners,
  anticlockwise, 7.5 m castle section in a radio shadow) built from straights + arcs;
  two straights per track are solved so the loop closes exactly.
- `safety.py`: 1 km lookahead over upcoming corners; warnings name their corner.
- `driver.py`: full throttle on straights, per-corner targets, chicane linking
  (<60 m), trail braking within the felt friction circle.
- `simulator.py`: lap progress, lap time, per-corner metrics, `failure_corner`.
- `Scenario.corner_curvature` removed (the track fixes every corner); the search
  space is now 9-D. `/tracks/{name}` lost its `corner_curvature` query parameter.
- TCN input is now the first 12 s of the lap at 10 Hz; all models retrained.

## Merged into `version1` (Person B + hardware)

`aaryanved` was merged into `version1` (main + Person B's frontend/session
simulator/stress framework + steering-wheel firmware). Both simulators now live
side by side:
- Person B's session simulator (`placeholder_sim.py`, `stress/`, `ml/`) drives
  the Drive/Engineer/Garage/Compare screens via `/tracks`, `/sessions`,
  `/ws/driver|engineer`, `/scenarios`, `/evaluation/*`, `/ml/status`.
- The lap simulator (`sim/`, `ai/`) is served under `/simulation/*`,
  `/scenario/*`, `/configuration/*`, `/ai/status`, `/ws/simulation`.
- Unifying the two simulators is not done yet (next step).

## Drive screen / Baku fixes (on `version1`)

- First-person cockpit camera (default while driving; button cycles Cockpit -> Chase -> Overview).
- Racing line overlay (`frontend/src/scene/racingLine.ts`): curvature-minimising
  line inside the track edges, green = accelerate, red = brake, using the
  session car model's limits. About 7 s faster per lap than the centreline
  under those limits on both tracks. Toggle: "Racing line".
- Baku fixes: Turn 7 and Turn 12 cusps rounded, Turn 13-15 S-wobble removed
  (`track_layouts.py`); off-track clearance now uses the local width so the
  7.6 m castle section counts (`placeholder_sim.half_width_at`); city buildings
  kept clear of the road/walls using their footprint. The TCN observer's suite
  metrics were re-run with `python -m app.ml.evaluate_tcn` (PR-AUC 0.906 ->
  0.905; clearance MAE 0.315 -> 0.402 m because castle clearances are now true).

## 2026 car physics and driver features (on `version1`)

- `backend/app/f1_car.py`: dynamic bicycle model (tyre slip, friction circle,
  speed-dependent aero with Z/X active aero, load transfer, 400 kW ICE + 8-speed
  gearbox, 350 kW MGU-K with 290-355 km/h fade, 4 MJ battery). 0-100 km/h ~2.6 s,
  top speed ~325 (343 with X-mode).
- Car setup: traction control, ABS, auto/manual gearbox, DRS mode, battery mode;
  reverse gear; shift/DRS/reverse/battery buttons sent as running press totals.
- Lap validity uses the whole-car track-limit rule; session best lap survives resets.
- Simulator-style dash, input telemetry overlay, 2026 car model.
- Person B's scripted driver steers/feeds throttle through the car model; the
  fade+stale preset was recalibrated (brake effectiveness 0.7 -> 0.9).
- Person B's TCN observer retrained on the new physics (`python -m app.ml.dataset`
  then `python -m app.ml.train_tcn`): held-out suite PR-AUC 0.955 (0.51 on the
  old weights), test PR-AUC 0.939. Person B's SAC adversary was not retrained.

## Status: all Section 4 steps done

| Step | State | Evidence |
| --- | --- | --- |
| 1-3 Simulator, tracks, vehicle | done | `tests/test_track.py`, `tests/test_vehicle.py` |
| 4 Safety warning | done | `tests/test_safety.py` |
| 5 Fault injection | done | `tests/test_faults.py` |
| 6 Test runner | done | `tests/test_simulator.py` (determinism, per-fault effects, upgrades) |
| 7 Replay / evaluation | done | `tests/test_replay_eval.py` |
| 8 Training data | done | `tests/test_dataset.py`; 5000 runs, 19.5% failures |
| 9 TCN | done | `tests/test_tcn.py`; held-out metrics below |
| 10 SAC | done, used as default | `tests/test_search.py`; beats random in experiment below |
| 11 Scenario selection | done | `tests/test_selection.py` |
| 12 Upgrades | done | `tests/test_simulator.py`, `tests/test_replay_eval.py` |
| 13 API + WebSocket | done | `tests/test_api.py`; exercised against a live uvicorn |
| 14 Tests | 158 tests pass (`cd backend && pytest`, ~50 s) | includes `tests/test_contract.py` (backend/TS drift) |
| 15 Docs | done | `README.md`, `ARCHITECTURE.md`, this file |

`python scripts/demo.py` runs the Section 33 flows end to end.

## Measured results (full laps; all from real runs, regenerate with the commands in README)

- Random laps from the search space fail 26.8% of the time (5000-lap training set).
- Configuration comparison, 300 random laps (seed 2026): baseline 76 stress-test
  failures; brake_service 44 (fixed 41, new 9), reliable_telemetry 32 (fixed 48,
  new 4), local_warning_fallback 31 (fixed 45, new 0). The new failures come from
  fault timing shifting when an upgrade changes the car's pace (see ARCHITECTURE.md).
- TCN held-out (1500 laps, seed 7, 415 simulator failures, threshold 0.68 chosen
  on validation): accuracy 0.887, precision 0.830, recall 0.742, F1 0.784,
  ROC-AUC 0.918; TP 308 FP 63 FN 107 TN 1022. (`backend/models/tcn/evaluation.json`)
- SAC: 400 proposals -> 86.3% failed laps, 104 distinct (track, corner, factors)
  failure signatures, mean fault severity 0.58 (random: 25.8%, 60, 0.49).
- Budget experiment (50 full laps, seeds 0-4, mean ± std):
  random 13.6±2.7 failures / 13.4±3.1 distinct; TPE 19.0±8.1 / 10.4±2.4;
  SAC 43.2±2.3 / 31.0±2.1; SAC+TCN 47.0±1.4 / 30.4±3.3 (+41.9 full-lap
  equivalents of screening); random+TCN 35.8±3.9 / 27.8±3.4 (+41.9).
  Offline training cost excluded from the budget: TCN 5000 laps, SAC 3072 laps.
  One simulator, five seeds; not a general claim.

## Decisions

- Working branch is `aaryanved` (created by the user) rather than `person-a/sim-ai`.
- Merge: lap-simulator track routes moved from `/tracks` to `/simulation/tracks` (Person B's frontend owns `/tracks`).
- Merge: lap-simulator presets moved to `scenarios/presets/`; `scenarios/*.json` is Person B's StressScenario format and is validated at import.
- Merge: dependencies follow Person B's split. Core `requirements.txt` adds numpy (<2.2); torch 2.5.1, stable-baselines3 and optuna live in `requirements-ml.txt`. `/ai/*` routes are only mounted when that stack imports. The lap-simulator models load and all tests pass on torch 2.5.1 / numpy 1.26.
- Merge: `tests/test_contract.py` only checks the lap-simulator models (Person B mirrors WS messages as TS unions).
- Shared contract stays where Phase 0 put it: `backend/app/schemas.py` + `frontend/src/types/schemas.ts`; `frontend/src/types/schemas.ts` is the only frontend file touched.
- Docs extend the existing root `ARCHITECTURE.md` instead of creating `docs/architecture.md` (avoids two architecture docs).
- Scripts live in `backend/scripts/` (next to the `app` package) and are run from `backend/`.
- Python 3.12 venv in `backend/venv` (3.11 not installed on this machine; README warns 3.14 lacks pydantic-core wheels).
- API step done before the AI steps because the API is Tier 1.
- Failure = vehicle centre crosses a track edge (car width ignored). Timeouts do not count as failures (none observed).
- VehicleState uses `grip_usage` (demanded/available friction) instead of an ambiguous `grip` field; `actual_grip` and `estimated_grip` are separate fields.
- Scripted driver ignores CAUTION (advisory only); lifting on CAUTION bled so much speed through drag that only grip mismatch could cause a failure.
- Scenario gained `packet_loss` (0-0.9). Baku has a radio-shadow zone (s 120-250 m) where loss is x3.
- Upgrade semantics: brake_service sets brake_effectiveness=1.0; reliable_telemetry caps delay at 40 ms and loss at 2%; local_warning_fallback switches to on-car sensing when remote data is >120 ms old.
- Search bounds tuned so a random lap fails ~27% of the time (grip_error -0.1..0.12, actual grip 0.6..1.1, delay 0..250 ms, loss 0..0.25, reaction 0.1..0.5 s, brakes 0.65..1.0); a lap has 11-13 corners, so per-lap bounds are tighter than the old single-corner ones.
- Layouts follow the real corner sequences but are not accurate reproductions; lengths were picked so the loops close without self-intersection.
- `entry_speed` now means speed at the start line; the scripted driver goes full throttle on straights, so it mainly affects the first braking zone.
- Scripted driver trail-brakes only within the friction circle it feels (actual grip/brakes, "by feel"); full braking mid-corner made faster reactions cause more failures, which was unphysical.
- Corners starting <60 m after the previous exit are driven as one complex (chicanes); otherwise the driver accelerated between T1 and T2 at Monza.
- Fault randomness stays per-tick (common random numbers in time); no attempt to align faults by track position across configurations.
- A lap is the unit of a "full simulation" in the budget experiment.
- Training data uses the baseline configuration only; TCN input = first 12 s of the lap @ 10 Hz + scenario parameters as constant channels; label = the lap failed anywhere.
- Test budget counts full simulations; TCN screening (12 s prefix rollouts) is reported separately as full-sim equivalents rather than deducted.
- SAC as a one-step contextual bandit (critic target = reward). Target entropy 0.5/dim chosen after a sweep on the single-corner version (-1.0 collapsed onto few failure conditions); kept for laps (86% failures, 104 distinct per 400).
- SAC works, so it is the default strategy; TPE is the automatic fallback when no SAC checkpoint loads; random needs nothing.
- Trained artifacts (`backend/models/`, ~350 KB) are committed so the demo does not depend on retraining; datasets are gitignored and regenerable.
- Optuna added as a dependency for the TPE fallback; torch for TCN/SAC.

## Current step

All steps complete. Possible follow-ups (not started):
- Person B integration support (frontend consumes `/simulation/replay`, `/configuration/compare`, `/scenario/search`, `/ws/simulation`).
- Human wheel sessions: `/ws/simulation` with `mode: "manual"` already accepts steering/throttle/brake.

## Artifacts

- `backend/models/tcn/`: `model.pt`, `config.json` (feature order, normalisation, threshold), `training_metadata.json`, `evaluation.json`.
- `backend/models/sac/`: `sac.pt`, `config.json`, `training_metadata.json`.
- `backend/models/experiment.json`: budget experiment output.
- `backend/data/training.json` (5000 laps, seed 42), `backend/data/test.json` (1500 laps, seed 7): gitignored, regenerate with `scripts/generate_data.py`.
- `backend/data/replays/`: replays written by `scripts/demo.py` (gitignored).
