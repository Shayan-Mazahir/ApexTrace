# Person A progress log (simulator + safety testing + AI)

Resumption point for any session. Read this first; it says what exists, what
is next, and where artifacts live.

## Already implemented (Phase 0, before Person A work)

- `backend/app/main.py`: FastAPI app, CORS for `http://localhost:5173`, `GET /health`.
- `backend/app/schemas.py`: Pydantic `HealthStatus` only. Mirrored by hand in
  `frontend/src/types/schemas.ts`.
- `frontend/`: Vite + React + React Three Fiber placeholder scene (Person B).
- `scenarios/`: empty (`.gitkeep`).
- No tests, no lint/type-check for Python. Frontend has `npm run build` (tsc) and `npm run lint` (oxlint).

## Missing (at audit time)

Everything Person A owns: track model, vehicle model, safety warning system,
fault injection, scripted driver, runner, replay, dataset generation, TCN,
scenario search (SAC + fallbacks), scenario selection, upgrade configurations,
simulation API endpoints, Python test suite.

## Person A implementation plan

Layout adapted to the real repo (there is no `services/` or `packages/shared`):

```
backend/app/schemas.py      shared API contract (mirrored in frontend/src/types/schemas.ts)
backend/app/sim/            track, vehicle, safety, faults, driver, simulator, runner, upgrades, replay, evaluation
backend/app/ai/             features, dataset, tcn, training, inference, search strategies, selection, experiment
backend/app/services/       orchestration used by API routes
backend/app/api/            FastAPI routers (included from main.py)
backend/scripts/            generate_data.py, train_tcn.py, evaluate_tcn.py, train_sac.py, run_experiment.py
backend/tests/              pytest suite
backend/models/             trained artifacts (small, committed)
backend/data/               generated datasets (gitignored, reproducible from scripts)
scenarios/                  preset scenario JSON files
```

Build order follows the master prompt Section 4 (simulator first, AI last).

## Decisions

- Working branch is `aaryanved` (created by the user) rather than `person-a/sim-ai`.
- Shared contract stays where Phase 0 put it: `backend/app/schemas.py` + `frontend/src/types/schemas.ts`.
- Failure = vehicle centre crosses a track edge (car width ignored). Timeouts do not count as failures (none observed).
- VehicleState uses `grip_usage` (demanded/available friction) instead of an ambiguous `grip` field; `actual_grip` and `estimated_grip` are separate fields.
- Scripted driver ignores CAUTION (advisory only); lifting on CAUTION bled so much speed through drag that no fault except grip mismatch could cause a failure.
- Scenario gained `packet_loss` (0-0.9) for the packet-loss/stale-telemetry fault. Baku has a radio-shadow zone (s 120-250 m) where loss is x3.
- Upgrade semantics: brake_service sets brake_effectiveness=1.0; reliable_telemetry caps delay at 40 ms and loss at 2%; local_warning_fallback switches to on-car sensing when remote data is >120 ms old.
- Search bounds tuned so uniform random sampling fails ~18% of the time (grip_error -0.1..0.2, actual grip 0.6..1.1, brakes 0.5..1.0, reaction 0.1..0.8 s).
- Python 3.12 venv in `backend/venv` (3.11 not installed on this machine; README warns 3.14 lacks pydantic-core wheels).

## Done so far

- Steps 1-7 (simulator, tracks, vehicle, safety warning, faults, runner, replay/evaluation) with tests (`cd backend && pytest`).
  - `app/sim/track.py`: Monza (12 m wide, 450 m approach, R60 right) and Baku (8 m, 250 m approach, R25 left, radio-shadow zone) profiles.
  - `app/sim/vehicle.py`: point mass + friction circle; understeer when lateral demand exceeds grip.
  - `app/sim/safety.py`: warning system (SAFE/CAUTION/BRAKE_NOW) on measured data + estimated grip; assumes nominal brakes and ignores telemetry age.
  - `app/sim/faults.py`: delay buffer, clipped Gaussian noise, Gilbert-Elliott burst loss, per-fault seeded RNG streams.
  - `app/sim/driver.py`: scripted driver that brakes only on perceived BRAKE_NOW (after reaction delay).
  - `app/sim/simulator.py` + `runner.py`: `Simulator.step(control)` / `run()`, `run_scenario`, `run_batch` (process pool).
  - `app/sim/upgrades.py`: baseline, brake_service, reliable_telemetry, local_warning_fallback.
  - `app/sim/replay.py`, `app/sim/evaluation.py`: replay build/save/load, `evaluate_configuration`, `compare_configurations`.
  - `app/sim/scenario_space.py`: shared bounded parameter space + `failure_signature` for distinct-failure counting.
- Measured (300 random scenarios, seed 2026): baseline 45 failures; brake_service 28, reliable_telemetry 30, local_warning_fallback 30; no upgrade introduced new failures.

## Current step

Step 8: training-data generation.

## Artifacts

(none yet)
