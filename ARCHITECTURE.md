# Architecture

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

A test (`backend/tests/test_contract.py`) fails if a Pydantic model and its
TypeScript interface stop having the same fields.

## Frontend state

- `GET /health` polled once on load to show a connected/unreachable status.
- A placeholder 3D scene (floor, lights, camera, one box standing in for the
  car) with orbit controls. Track geometry, replays and live state are
  available from the API below for Person B to render.

## Simulator (backend/app/sim)

Layers: `api/` -> `services/` -> `sim/simulator.py` -> vehicle / safety / faults / driver.

| Module | Role |
| --- | --- |
| `track.py` | Straight -> constant-radius corner -> straight, sampled every 0.5 m. `get_curvature`, `is_inside_track`, `distance_to_boundary`, `get_current_corner`, braking zones. |
| `vehicle.py` | Point mass with a friction circle: total accel <= grip x 24 m/s^2. Steering commands path curvature; demand beyond remaining grip makes the car run wide. Brakes scale with `brake_effectiveness`. |
| `safety.py` | The prototype under test. Uses measured speed/position and *estimated* grip to output SAFE / CAUTION / BRAKE_NOW plus an advised corner speed. Assumes nominal brakes and does not compensate for telemetry age (deliberate blind spots). |
| `faults.py` | Telemetry delay buffer (simulated time, no sleeping), bounded Gaussian sensor noise, Gilbert-Elliott burst packet loss. Each fault has its own seeded RNG stream. |
| `driver.py` | Scripted test driver: holds entry speed, brakes to the advised speed only after perceiving BRAKE_NOW (reaction delay), follows the centerline. Not a model of human behaviour. |
| `simulator.py` | 100 Hz loop; `step(control)` accepts external input (wheel) or uses the scripted driver. Records `VehicleState` frames. |
| `runner.py` | `run_scenario`, `run_batch` (process pool). Same scenario + seed -> identical result. |
| `upgrades.py` | Configurations that change simulator inputs, then re-run. |
| `replay.py` | Replay = track geometry + frames + events + result; save/load JSON. |
| `evaluation.py` | `evaluate_configuration`, `compare_configurations` on an identical scenario set. |
| `scenario_space.py` | Shared parameter bounds for data generation and every search strategy. |

Tracks (simplified test environments, not real circuit layouts):

- **monza**: 12 m wide, 450 m approach, R60 right-hander (curvature 1/90..1/40). High-speed approach and heavy braking.
- **baku**: 8 m wide, 250 m approach, R25 left-hander (1/40..1/18), plus a radio-shadow zone (s 120-250 m) where packet loss is tripled. Narrow, lower speed, staleness testing.

### Scenario

`Scenario` in `schemas.py`: `scenario_id, seed, track, entry_speed (m/s), actual_grip,
estimated_grip, corner_curvature (1/m or null = track default), telemetry_delay_ms,
sensor_noise (0..1), packet_loss (0..0.9), driver_reaction_delay (s), warning_margin
(fractional extra braking distance), brake_effectiveness (1.0 = baseline)`.

### Failure definition

A run fails when the car's centre crosses a track edge (`boundary_distance < 0`).
The result also reports `minimum_boundary_distance`, `overspeed_at_entry`,
`warning_lead_time`, `warning_too_late` (the first BRAKE_NOW came too late for
full braking with the car's *actual* brakes/grip/reaction to reach the true
safe speed) and `stale_telemetry_fraction`. Counts are reported as
"stress-test failures", never as real-world probabilities.

### Fault system

| Fault | Scenario field | Effect |
| --- | --- | --- |
| Grip mismatch | `actual_grip` vs `estimated_grip` | Car has `actual_grip`; the warning system plans with `estimated_grip`. |
| Telemetry delay | `telemetry_delay_ms` | Packets reach the warning system after the delay. |
| Sensor noise | `sensor_noise` | Speed +-2.5 m/s and position +-4 m std at 1.0, clipped at 3 sigma. |
| Packet loss / stale | `packet_loss` | Bursty loss (mean burst 200 ms); the system keeps using the last packet. |
| Brake degradation | `brake_effectiveness` | Braking force scaled; the warning system still assumes 1.0. |
| Reaction delay | `driver_reaction_delay` | Driver perceives the warning this much later. |

### Upgrade configurations

| Configuration | Change before re-running the simulator |
| --- | --- |
| `baseline` | none |
| `brake_service` | `brake_effectiveness = 1.0` |
| `reliable_telemetry` | delay capped at 40 ms, packet loss at 2% |
| `local_warning_fallback` | when remote telemetry is >120 ms old, the warning uses on-car sensors (no delay/loss) |

None of the upgrades addresses grip-estimation error, so grip-mismatch
failures persist in every configuration (see `scenarios/monza_grip_mismatch.json`).

## AI (backend/app/ai)

`data -> model -> training -> inference -> scenario search -> selection`.

- **Dataset** (`dataset.py`, `features.py`): scenarios sampled uniformly from
  the scenario space and run in the simulator (baseline). Each record holds the
  first 2 s of telemetry at 20 Hz (12 channels the monitoring side can see)
  plus the scenario parameters as constant channels, and the simulator's
  ground-truth `failed` label for the full run.
- **TCN** (`tcn.py`, `training.py`, `inference.py`): 4 residual blocks of
  dilated causal convolutions (32 channels), logit from the last step. Output
  is the model's estimate that the *simulator* run will fail, with MC-dropout
  uncertainty. It never replaces a simulator run. Held-out metrics are in
  `backend/models/tcn/evaluation.json` (produced by `scripts/evaluate_tcn.py`).
- **Scenario search** (`search/`): `ScenarioSearchStrategy` with
  `RandomSearch`, `TPESearch` (Optuna) and `SACSearch`. All use the same
  bounds and reward (`reward.py`: 1 for a failure, up to 0.5 for a near miss,
  minus a penalty for extreme fault settings).
- **SAC** (`search/sac.py`): one-step episodes, with the track as state and the
  scenario parameters as a tanh-squashed action mapped into the bounds (it cannot
  produce out-of-range values). The critic target is the reward itself. A
  novelty bonus rewards failures unlike earlier ones. It is trained against the
  real simulator by `scripts/train_sac.py`.
- **Fallback**: `make_strategy("sac")` returns TPE if no SAC checkpoint exists
  or it fails to load; random search needs nothing. The simulator does not
  depend on any trained model.
- **Selection** (`selection.py`): candidates (adversarial + random) get a 2 s
  prefix rollout, TCN probability + uncertainty, and novelty against tested
  scenarios. Near-duplicates are dropped, then the top k are run in the full
  simulator. Only the simulator declares failures.
- **Experiment** (`experiment.py`, `scripts/run_experiment.py`): random vs TPE
  vs SAC vs SAC+TCN selection vs random+TCN selection, with identical bounds,
  budget of full simulations and configuration, and several seeds. TCN
  screening cost is reported separately. Offline training cost is listed in
  the output, not hidden. Results: `backend/models/experiment.json`.

## API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/health` | `HealthStatus` |
| GET | `/tracks`, `/tracks/{name}?corner_curvature=` | `TrackGeometry` |
| GET | `/configurations` | `ConfigurationInfo[]` |
| GET | `/scenario/presets` | `ScenarioPreset[]` (from `scenarios/`) |
| POST | `/scenario/generate` | `Scenario[]` sampled from the bounded space |
| POST | `/simulation/run` | `SimulationResult` (optionally with telemetry) |
| POST | `/simulation/batch` | `BatchResult` |
| POST | `/simulation/replay` | `Replay` (call once per configuration to compare) |
| POST | `/scenario/evaluate` | `ConfigurationEvaluation` for one configuration |
| POST | `/configuration/compare` | `ConfigurationComparison` across configurations on the same scenarios |
| POST | `/scenario/predict` | `ModelPrediction[]` (TCN estimate, labelled as such) |
| POST | `/scenario/search` | `ScenarioSearchResponse`: tested scenarios with prediction + simulator result |
| GET | `/ai/status` | model availability, held-out TCN metrics, experiment summary |
| WS | `/ws/simulation` | `LiveStart` -> track, state stream, result; `LiveControl` for manual driving |
