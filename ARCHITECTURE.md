# Architecture (Phase 0)

## Stack

- **Frontend**: React + Vite + TypeScript. 3D scene (track, car, camera,
  replay trail) rendered with React Three Fiber (Three.js). No physics runs
  here — the scene only visualizes state the backend sends.
- **Backend**: Python + FastAPI. Owns the actual vehicle simulation, fault
  injection, warning logic, and (later) the ML/RL components. Exposed to the
  frontend over HTTP/WebSocket.

The Python simulator can stay a simple 2D track model; the frontend projects
that state into a 3D scene. Physics logic lives in exactly one place
(Python) — the frontend never duplicates it.

## Work split

- **Person A** (simulation, data, AI): `backend/app` simulation/safety/ML
  modules, scenario generation, schemas.
- **Person B** (frontend, networking, decisions): `frontend/`, FastAPI
  routing/WebSocket wiring, input adapters, demo screens.

Both sides agree on shared data shapes before building features on top of
them — see below.

## Shared schemas

Backend schemas (Pydantic) live in [backend/app/schemas.py](backend/app/schemas.py).
Frontend types (TypeScript) live in [frontend/src/types/schemas.ts](frontend/src/types/schemas.ts).
These are kept in sync by hand: any new schema (e.g. `VehicleState`,
`TelemetryPacket`, `WarningEvent`) gets added to both files in the same
change.

## Current state

- `GET /health` on the backend, polled once by the frontend on load to show
  a connected/unreachable status.
- A placeholder 3D scene (floor, lights, camera, one box standing in for the
  car) with orbit controls, rendered via React Three Fiber.

(That was the Phase 0 baseline. Since then: full-lap tracks, driver and
engineer sessions, fault injection, and saved scenarios have landed; the
simulator is still a placeholder pending `backend/sim/*`, and there is no ML
yet.)

## Session protocol (driver + engineer)

- `WS /ws/driver/{id}` sends `control_input`; `WS /ws/engineer/{id}` sends
  `set_faults`, `launch_scenario`, `clear_scenario`. Both may `pause`/`resume`/`reset`.
  Role permissions are enforced server-side; every message is validated against
  the pydantic union in `backend/app/schemas.py`. Malformed or forbidden
  messages get an `error` reply and never touch session state.
- One server-side tick loop per session broadcasts `vehicle_state`,
  `warning_event` (sequenced; the browser drops stale/out-of-order ones),
  `fault_state` (on change), `session_info` (run id, seed, presence) and a
  1 Hz `heartbeat`.
- Sessions outlive their sockets: clients reconnect with backoff and get the
  current state back. Sessions with no clients are swept after 5 minutes.
- Fault ranges (hard limits): grip 0.65-1.0, telemetry delay 0-400 ms, brake
  wear 0.75-1.0. Telemetry delay is injected only on the warning-data path.
  Measured packet age and injected delay are reported separately.
- Saved scenarios live in `scenarios/*.json` and apply their faults over a
  lap-distance window (distance-triggered, so onset is corner-relative).
