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

Nothing else — no track geometry, simulation loop, WebSocket session, fault
injection, or ML yet. Those land in later phases per the task breakdown.
