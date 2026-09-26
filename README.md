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
- Python **3.11** (3.14 has no prebuilt `pydantic-core` wheels yet)
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

Keyboard fallback: **W / ↑** throttle, **S / ↓ / Space** brake, **A / ←** and
**D / →** steer. A wheel/gamepad is used automatically if the browser sees one
(calibrate centre and dead-zone in the panel, bottom-left of the Drive screen).

## Tests

```bash
cd backend  && source venv/bin/activate && python -m pytest      # 87 tests
cd frontend && npm test                                          # 52 unit tests
cd frontend && npm run e2e                                       # 23 real-Chrome checks (25 with E2E_OUTAGE=1)
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
config/     upgrades.json — upgrade prices/effects and default budget (editable assumptions)
scenarios/  saved stress scenarios (*.json)
scripts/    start.sh, record_backup_replay.py
docs/       DEMO.md
```

## What is placeholder

`backend/app/placeholder_sim.py` and `placeholder_eval.py` stand in for
Person A's `backend/sim/*` and `backend/evaluation.py`. Everything above them
(sessions, faults, upgrades, budget, UI) talks to a small interface, so they
are replaceable; there is no ML/RL yet.
