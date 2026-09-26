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
- Python 3.12 venv in `backend/venv` (3.11 not installed on this machine; README warns 3.14 lacks pydantic-core wheels).

## Current step

Step 1–3: simulator core (track, vehicle).

## Artifacts

(none yet)
