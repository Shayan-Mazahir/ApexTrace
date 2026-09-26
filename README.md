# LimitLab

Motorsport safety-testing prototype: a driver runs a wheel/keyboard-controlled
car through a simplified corner while an engineer injects bounded faults into
a corner-entry warning system. See [ARCHITECTURE.md](ARCHITECTURE.md) for the
system split.

This repo is at the **Phase 0 scaffolding** stage — a blank frontend and
backend that talk to each other. No simulation, warning logic, or ML yet.

## Structure

```
frontend/    React + Vite + TypeScript + React Three Fiber (3D scene, UI)
backend/     Python + FastAPI (simulation, safety, ML — API only for now)
scenarios/   JSON scenario/fault configs (empty for now)
```

## Requirements

- Node.js 20+
- Python 3.11 (3.14 does not yet have prebuilt wheels for `pydantic-core`)

## Running locally

**Backend** (from `backend/`):

```bash
python3.11 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

Health check: `curl http://localhost:8000/health`

**Frontend** (from `frontend/`):

```bash
npm install
npm run dev
```

Open the printed local URL (default `http://localhost:5173`). The status
bar in the top-left shows whether it reached the backend `/health` endpoint.

## Tests

```bash
cd backend && source venv/bin/activate && python -m pytest   # sessions, faults, scenarios, sim
cd frontend && npm test                                       # stream/warning/quality logic
```

## Two-device demo

1. Drive screen -> pick a track -> **Start**. Note the Session ID shown at the top.
2. On the second device/tab, Engineer screen -> paste the Session ID -> **Join**.
3. Engineer applies faults or launches a saved scenario (`scenarios/*.json`).
