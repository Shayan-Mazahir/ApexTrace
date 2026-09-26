# LimitLab — test the limit, fund the fix

A motorsport safety-testing prototype. A driver drives full laps of
Monza or Baku (real layouts, simplified, low-poly 3D), an engineer injects bounded faults into
a corner-entry **BRAKE warning system** from a second device, and a budget
screen helps a fictional small team decide which upgrade to fund — by
re-running the same fixed test suite and checking what the season budget can
afford.

This is an F1-*inspired* prototype: a toy vehicle model with a scripted
driver, **not** F1 physics, not certification, and no real team economics.
See [docs/DEMO.md](docs/DEMO.md) for the demo script, launch checklist and
the honest limits of the evidence, and [ARCHITECTURE.md](ARCHITECTURE.md) for
the design.

## Requirements

- Node.js 20+ and npm
- Python **3.11** or 3.12 (3.14 has no prebuilt `pydantic-core` wheels yet)
- Google Chrome (only for the optional browser end-to-end test)

## First-time setup

```bash
cd backend && python3.11 -m venv venv && source venv/bin/activate \
  && pip install -r requirements.txt && cd ..
cd frontend && npm install && cd ..
```

## Launch (driver laptop)

```bash
scripts/start.sh
```

Starts the API on `:8000` and the app on `:5173`, both reachable on the local
network. It prints two URLs:

- Driver laptop: `http://localhost:5173/#drive`
- Engineer device (same Wi-Fi): `http://<laptop-ip>:5173/#engineer`

Manual equivalents:

```bash
cd backend  && source venv/bin/activate && uvicorn app.main:app --host 0.0.0.0 --port 8000
cd frontend && npm run dev -- --host --port 5173
```

Screens are addressable by hash: `#drive`, `#engineer`, `#garage`, `#compare`.
Health check: `curl localhost:8000/health`.

## Controls

| Action | Keyboard | Wheel / gamepad |
| --- | --- | --- |
| Throttle / brake | W / ↑, S / ↓ / Space | right / left trigger |
| Steer | A / ←, D / → | axis 0 |
| Shift up / down (manual) | E / Q | RB / LB (paddles) |
| DRS / active aero (manual) | F | A |
| Reverse (when stopped) | R | X |
| Cycle battery mode | B | Y |

A wheel/gamepad is used automatically if the browser sees one (calibrate
centre and dead-zone in the Controls panel of the Drive screen). The view
button cycles cockpit, chase and overview cameras.

**Car setup** (track picker or the dock during a run; applies immediately):
traction control Off/Medium/Full, ABS On/Off, automatic or manual
transmission, DRS Off/Auto/Manual, and battery power Harvest/Balanced/Overtake.

**Car model** (`backend/app/f1_car.py`): a simplified 2026-regulation car -
tyre slip and a friction circle (so braking or wheelspin costs cornering
grip), downforce and drag that grow with speed plus Z/X-mode active aero, a
400 kW engine through an 8-speed gearbox and a 350 kW MGU-K that fades above
290 km/h and runs on a 4 MJ battery recharged under braking. It reaches
0-100 km/h in about 2.6 s and 325-343 km/h. Plausible public figures, not team
data. Laps are timed against track limits (void once the whole car is past
the edge line) and the dash keeps the session's best valid lap.

## Tests

```bash
cd backend  && source venv/bin/activate && python -m pytest
cd frontend && npm test
cd frontend && npm run e2e                                       # 23 real-Chrome checks (25 with E2E_OUTAGE=1)
cd frontend && node e2e/barriers.mjs                             # wall impacts + live TCN on both tracks
```

`npm run e2e` needs the app running (`scripts/start.sh`) and Chrome installed.
`E2E_OUTAGE=1 npm run e2e` additionally kills and restarts the backend to check
outage recovery. Screenshots land in `frontend/e2e/shots/` (git-ignored).

## Production build (the frozen demo build)

```bash
cd frontend && npm run build && npm run preview -- --host --port 4173
# e2e against it:  BASE=http://localhost:4173 npm run e2e
```

## Layout

```
frontend/   React + TypeScript + React Three Fiber (Drive, Engineer, Garage, Compare, demo mode)
backend/    FastAPI: sessions + WebSockets, faults, scenarios, upgrades, evaluation
            + app/sim (lap simulator), app/ai (TCN lap forecaster, SAC/TPE/random scenario search)
config/     upgrades.json — upgrade prices/effects and default budget (editable assumptions)
scenarios/  saved stress scenarios (*.json); scenarios/presets/ = lap-simulator presets
scripts/    start.sh, record_backup_replay.py
docs/       DEMO.md
```

## Simulator and AI status

`backend/app/placeholder_sim.py` still contains the simplified vehicle model,
pending integration with Person A's simulator. `backend/app/stress/` owns
the shared fault pipeline and evaluation. Solid barriers use swept collision
checks against the rendered wall geometry and the whole 5.6 × 2 m car.
Impact stops the car and records a failed run; use Reset to restart after a
head-on crash. This is a contact constraint, not a realistic damage model.

The optional TCN observer loads three trained checkpoints and `meta.json`
from `backend/models/tcn/`. It predicts one-second exit risk and clearance
from 2.5 seconds of observed telemetry, in both live sessions and replays;
it does not control braking warnings. Missing models or ML dependencies
are shown as unavailable. SAC artifacts and its random-search comparison
are in `backend/models/sac/`.

```bash
cd backend
venv/bin/pip install -r requirements-ml.txt
venv/bin/python -m app.ml.dataset        # regenerate training data if needed
venv/bin/python -m app.ml.train_tcn      # train and evaluate the ensemble
venv/bin/python -m app.ml.evaluate_tcn   # recheck saved models after simulator changes
```

The saved training/test results use the original dataset; the held-out
stress suite is reevaluated after the solid-barrier fix. Simulator hashes
and this distinction are recorded in the model metadata. Clearance error
must be compared with its baseline separately from exit classification.

## Lap simulator and AI scenario search (Person A)

A separate deterministic lap simulator lives in `backend/app/sim/` with its
AI layer in `backend/app/ai/`. It runs one flying lap of simplified closed
Monza (~4.4 km, 11 corners) and Baku (~4.3 km, 13 corners) layouts with a
scripted driver, a corner-entry warning system and seeded faults (grip
mismatch, telemetry delay, sensor noise, burst packet loss, brake
degradation, reaction delay). The same scenario and seed always give the same
lap. It is served under `/simulation/*`, `/scenario/*`,
`/configuration/*`, `/ai/status` and `/ws/simulation`; interactive docs at
`http://localhost:8000/docs`. The AI routes need `requirements-ml.txt` and
are skipped if torch/optuna are missing. Presets are in `scenarios/presets/`;
design notes are in [ARCHITECTURE.md](ARCHITECTURE.md), and progress/decisions
in [docs/person-a-progress.md](docs/person-a-progress.md).

Trained artifacts are committed (`backend/models/tcn/model.pt` +
`config.json`, `backend/models/sac/sac.pt`, `backend/models/experiment.json`),
next to the TCN observer / SAC artifacts above. To regenerate (from `backend/`,
venv active, ML requirements installed):

```bash
python scripts/demo.py   # baseline vs upgrades on presets, replays, AI search -> simulator

# simulator-labelled data and a held-out set (5000 laps take ~4 min on 8 cores)
python scripts/generate_data.py --num-runs 5000 --seed 42 --output data/training.json
python scripts/generate_data.py --num-runs 1500 --seed 7  --output data/test.json
python scripts/train_tcn.py --data data/training.json --output models/tcn
python scripts/evaluate_tcn.py --model models/tcn --data data/test.json
python scripts/train_sac.py --steps 3072 --output models/sac
python scripts/run_experiment.py --budget 50 --seeds 0 1 2 3 4 --output models/experiment.json
```

Quick API example:

```bash
curl -s -X POST localhost:8000/simulation/run -H 'content-type: application/json' \
  -d '{"scenario": {"track": "monza", "entry_speed": 85, "brake_effectiveness": 0.5, "warning_margin": 0, "driver_reaction_delay": 0.5}, "configuration": "baseline"}'
```
