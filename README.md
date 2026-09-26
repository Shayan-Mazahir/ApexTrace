# LimitLab

Motorsport safety-testing prototype: a driver runs a wheel/keyboard-controlled
car around a simplified lap while an engineer injects bounded faults into
a corner-entry warning system. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
system split and the simulator/AI design.

Each scenario is one flying lap of a simplified Monza or Baku layout.
Current state: the backend simulator, fault injection, safety warning system,
automated test runner, replays, upgrade comparison, TCN failure forecaster and
SAC scenario adversary are implemented and exposed over HTTP/WebSocket. The
frontend is still the Phase 0 scene (Person B's area).

All results come from our own simplified simulator. Failure counts are
"stress-test failures" in that simulator, not real-world crash probabilities.

## Structure

```
frontend/            React + Vite + TypeScript + React Three Fiber (3D scene, UI)
backend/app/sim/     track, vehicle, faults, safety system, driver, simulator, replay
backend/app/ai/      dataset, TCN, scenario search (SAC / TPE / random), selection, experiment
backend/app/api/     FastAPI routers (HTTP + /ws/simulation)
backend/scripts/     data generation, training, evaluation, experiment, demo
backend/models/      trained TCN + SAC artifacts and experiment results (committed)
backend/tests/       pytest suite
scenarios/           preset scenario JSON files
```

## Requirements

- Node.js 20+
- Python 3.11 or 3.12 (3.14 does not yet have prebuilt wheels for `pydantic-core`)

## Running locally

**Backend** (from `backend/`):

```bash
python3.12 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health`. Interactive API docs at
`http://localhost:8000/docs`.

**Frontend** (from `frontend/`):

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). The status
bar in the top-left shows whether it reached the backend `/health` endpoint.

## Simulator and AI workflow

All commands run from `backend/` with the venv active. Trained artifacts are
committed in `backend/models/`, so the API works straight after a clone; these
steps regenerate them.

```bash
# tests (simulator, faults, safety, replay, API, AI)
pytest

# end-to-end walkthrough: baseline vs upgrades, replays, AI search -> simulator
python scripts/demo.py

# 1. generate simulator-labelled training data and a held-out set (different seed);
#    5000 laps take ~4 minutes on 8 cores
python scripts/generate_data.py --num-runs 5000 --seed 42 --output data/training.json
python scripts/generate_data.py --num-runs 1500 --seed 7  --output data/test.json

# 2. train and evaluate the TCN
python scripts/train_tcn.py --data data/training.json --output models/tcn
python scripts/evaluate_tcn.py --model models/tcn --data data/test.json

# 3. train the SAC scenario adversary (every step is a real simulator lap)
python scripts/train_sac.py --steps 3072 --output models/sac

# 4. AI-selected vs random testing under the same simulation budget
python scripts/run_experiment.py --budget 50 --seeds 0 1 2 3 4 --output models/experiment.json
```

Quick API examples:

```bash
curl -s localhost:8000/scenario/presets
curl -s -X POST localhost:8000/simulation/run -H 'content-type: application/json' \
  -d '{"scenario": {"track": "monza", "entry_speed": 85, "brake_effectiveness": 0.5, "warning_margin": 0, "driver_reaction_delay": 0.5}, "configuration": "baseline"}'
curl -s -X POST localhost:8000/scenario/search -H 'content-type: application/json' \
  -d '{"strategy": "sac", "budget": 20}'
```
