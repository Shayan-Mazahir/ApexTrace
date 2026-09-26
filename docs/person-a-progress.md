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
| 14 Tests | 145 tests pass (`cd backend && pytest`) | includes `tests/test_contract.py` (backend/TS drift) |
| 15 Docs | done | `README.md`, `ARCHITECTURE.md`, this file |

`python scripts/demo.py` runs the Section 33 flows end to end.

## Measured results (all from real runs; regenerate with the commands in README)

- Configuration comparison, 300 random scenarios (seed 2026): baseline 45
  stress-test failures; brake_service 28, reliable_telemetry 30,
  local_warning_fallback 30; no upgrade created new failures.
- TCN held-out (1500 runs, seed 7, 309 simulator failures, threshold 0.77 chosen
  on validation): accuracy 0.927, precision 0.884, recall 0.741, F1 0.806,
  ROC-AUC 0.955; TP 229 FP 30 FN 80 TN 1161. (`backend/models/tcn/evaluation.json`)
- SAC: 400 proposals -> 80.7% simulator failures, 68 distinct failure
  signatures, mean fault severity 0.60 (random: 16.5%, 47, 0.49).
- Budget experiment (50 full simulations, seeds 0-4, mean ± std):
  random 9.0±1.7 failures / 8.8±1.7 distinct; TPE 22.4±6.3 / 8.4±2.4;
  SAC 43.0±2.6 / 30.2±1.5; SAC+TCN 46.6±1.4 / 32.4±2.1 (+43 full-sim
  equivalents of screening); random+TCN 32.2±1.9 / 26.6±2.4 (+43).
  Offline training cost excluded from the budget: TCN 5000 sims, SAC 3072 sims.
  One simulator, five seeds; not a general claim.

## Decisions

- Working branch is `aaryanved` (created by the user) rather than `person-a/sim-ai`.
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
- Search bounds tuned so uniform random sampling fails ~18% of the time (grip_error -0.1..0.2, actual grip 0.6..1.1, brakes 0.5..1.0, reaction 0.1..0.8 s).
- Training data uses the baseline configuration only; TCN input = first 2 s @ 20 Hz + scenario parameters as constant channels.
- Test budget counts full simulations; TCN screening (2 s prefix rollouts) is reported separately as full-sim equivalents rather than deducted.
- SAC as a one-step contextual bandit (critic target = reward). Target entropy 0.5/dim chosen after a sweep: -1.0 gave 99% failures but only 19 distinct conditions per 400; 0.5 gives 81% and 68.
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
- `backend/data/training.json` (5000 runs, seed 42), `backend/data/test.json` (1500 runs, seed 7): gitignored, regenerate with `scripts/generate_data.py`.
- `backend/data/replays/`: replays written by `scripts/demo.py` (gitignored).
