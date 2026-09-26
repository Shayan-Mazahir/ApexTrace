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

## Upgrades, evaluation and comparison

- `config/upgrades.json` holds prices, effects and the default budget (declared
  assumptions). `backend/app/budget.py` loads it, enumerates the 8 combinations
  and applies effects inside the simulator: brake servicing restores the
  persistent wear factor (0.75 -> 1.0), comms scales the injected warning delay
  (x0.4), local fallback bypasses the remote path when its data is older than
  150 ms (using local speed/position only, never hidden grip).
- `placeholder_eval.py` runs a fixed 36-test suite through the same `Session`
  engine as live driving, with one scripted driver that brakes only in response
  to warnings, so a better warning system can change the braking. Acceptance is
  declared up front. Results are deterministic and cached; the cache is warmed
  at start-up.
- `POST /evaluation/replay` re-runs a test for two configurations and returns
  10 Hz frames for the synchronized Compare view. `frontend/public/backup-replay.json`
  is a recording of the same thing, used if the backend is down.
- Money math (`available = cash - commitments - reserve`, affordability,
  filtering, recommendation) lives in `frontend/src/garage/budgetMath.ts` and is
  unit-tested; pass/fail comes from the backend.
- Cornering is speed-limited (lateral accel = grip x G), the baseline warning
  advises a corner speed from a *lagged* grip estimate, and clearance is
  point-to-segment. These live in `placeholder_sim.py` and are Person A's to
  replace.

## Connection recovery

`frontend/src/stream/connection.ts` is a framework-free reconnecting socket:
backoff (0.5 s doubling to 5 s), and before each retry a REST probe decides
whether the session still exists (gone -> stop; server unreachable -> keep
trying). It is unit-tested with a fake socket and exercised end-to-end in Chrome
(transient drop resumes the same session; backend outage shows "Reconnecting",
and a restart ends the lost in-memory session).

## Lap simulator (backend/app/sim, Person A)

The lap simulator is independent of the session simulator used by the drive
screen (`placeholder_sim.py`, `stress/`): it has its own track model, scripted
driver and warning system, and its routes do not overlap the session API.
Unifying the two is future work.

Layers: `api/` -> `services/` -> `sim/simulator.py` -> vehicle / safety / faults / driver.

| Module | Role |
| --- | --- |
| `track.py` | Closed lap of straights and constant-radius arcs, sampled every ~0.5 m; two designated straights are solved so the loop closes exactly. `get_curvature`, `is_inside_track`, `distance_to_boundary`, `get_current_corner`, `next_corner`, `corners_ahead`, per-section width, braking zones, radio-shadow zones. `s` wraps at the lap length. |
| `vehicle.py` | Point mass with a friction circle: total accel <= grip x 24 m/s^2. Steering commands path curvature; demand beyond remaining grip makes the car run wide. Brakes scale with `brake_effectiveness`. |
| `safety.py` | The prototype under test. Uses measured speed/position and *estimated* grip to check the current corner and every corner starting within 1 km, and outputs the most urgent SAFE / CAUTION / BRAKE_NOW with the corner name and advised speed (ties go to the tighter corner, e.g. the second half of a chicane). Assumes nominal brakes and does not compensate for telemetry age (deliberate blind spots). |
| `faults.py` | Telemetry delay buffer (simulated time, no sleeping), bounded Gaussian sensor noise, Gilbert-Elliott burst packet loss. Each fault has its own seeded RNG stream. |
| `driver.py` | Scripted test driver: full throttle on straights; brakes to a corner's advised speed only after perceiving BRAKE_NOW for it (reaction delay); holds entry speed through corners it got no warning for; carries speed through linked corners (<60 m apart, i.e. chicanes); trail-brakes within the friction circle it feels. Not a model of human behaviour. |
| `simulator.py` | 100 Hz loop over one flying lap (starts at the line at `entry_speed`); `step(control)` accepts external input (wheel) or uses the scripted driver. Records `VehicleState` frames, per-corner entry/warning data, lap progress and lap time. |
| `runner.py` | `run_scenario`, `run_batch` (process pool). Same scenario + seed -> identical result. |
| `upgrades.py` | Configurations that change simulator inputs, then re-run. |
| `replay.py` | Replay = track geometry + frames + events + result; save/load JSON. |
| `evaluation.py` | `evaluate_configuration`, `compare_configurations` on an identical scenario set. |
| `scenario_space.py` | Shared parameter bounds for data generation and every search strategy. |

Tracks are full closed laps that follow the real circuits' corner sequence
(names, directions, rough radii) but are simplified test environments, not
accurate reproductions:

- **monza** (clockwise, ~4.4 km, 12 m, 11 corners): main straight -> Rettifilo
  chicane (T1/T2) -> Curva Grande -> Roggia chicane -> Lesmo 1/2 -> Ascari
  (T8-T10) -> back straight -> Parabolica. High speed, heavy braking into chicanes.
  A healthy car laps in ~82 s simulated time.
- **baku** (anticlockwise, ~4.3 km, 10 m, 13 corners): 90-degree city corners
  T1-T6, the castle section T8-T12 narrowed to 7.5 m and inside a radio-shadow
  zone (packet loss x3), then the long flat-out seafront run back to the line.
  A healthy car laps in ~103 s.

### Scenario

`Scenario` in `schemas.py` is one flying lap: `scenario_id, seed, track, entry_speed
(m/s at the start line), actual_grip, estimated_grip, telemetry_delay_ms, sensor_noise
(0..1), packet_loss (0..0.9), driver_reaction_delay (s), warning_margin (fractional
extra braking distance), brake_effectiveness (1.0 = baseline)`. Faults apply for the
whole lap.

### Failure definition

A lap fails when the car's centre crosses a track edge (`boundary_distance < 0`)
anywhere; `failure_corner` names the corner being driven (or last exited).
Otherwise the lap completes and reports `lap_time`. Per corner the result
reports entry speed, the true safe speed, the advised speed, overspeed,
warning lead time and `warning_too_late` (braking was needed but the first
BRAKE_NOW for that corner came too late for full braking with the car's
*actual* brakes/grip/reaction to reach the true safe speed). Lap-level:
`minimum_boundary_distance`, `corners_with_late_warning`,
`stale_telemetry_fraction`. Counts are reported as
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
Each preset in `scenarios/` fails at a specific corner in baseline and shows
which upgrade (if any) fixes it.

Random faults are drawn per simulator tick from the scenario seed, so every
configuration sees the same fault sequence in time. When an upgrade changes
the car's pace, a loss burst or noise spike can land at a different corner,
so a few scenarios pass in baseline but fail after an upgrade.
`ConfigurationComparison.new_failures_vs_baseline` lists these rather than
hiding them.

## Lap-simulator AI (backend/app/ai)

`data -> model -> training -> inference -> scenario search -> selection`.

- **Dataset** (`dataset.py`, `features.py`): scenarios sampled uniformly from
  the scenario space and run in the simulator for a full lap (baseline). Each
  record holds the first 12 s of the lap at 10 Hz (13 channels the monitoring
  side can see, covering the first braking zones) plus the scenario parameters
  as constant channels, and the simulator's ground-truth `failed` label for
  the whole lap.
- **TCN** (`tcn.py`, `training.py`, `inference.py`): 5 residual blocks of
  dilated causal convolutions (32 channels, receptive field 125 steps), logit
  from the last step. Output
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
- **Selection** (`selection.py`): candidates (adversarial + random) get a 12 s
  prefix rollout, TCN probability + uncertainty, and novelty against tested
  scenarios. Near-duplicates are dropped, then the top k are run in the full
  simulator. Only the simulator declares failures.
- **Experiment** (`experiment.py`, `scripts/run_experiment.py`): random vs TPE
  vs SAC vs SAC+TCN selection vs random+TCN selection, with identical bounds,
  budget of full simulations and configuration, and several seeds. TCN
  screening cost is reported separately. Offline training cost is listed in
  the output, not hidden. Results: `backend/models/experiment.json`.

## Lap-simulator API

| Method | Path | Returns |
| --- | --- | --- |
| GET | `/simulation/tracks`, `/simulation/tracks/{name}` | `TrackGeometry` (closed lap: centerline, boundaries, corners, zones) |
| GET | `/configurations` | `ConfigurationInfo[]` |
| GET | `/scenario/presets` | `ScenarioPreset[]` (from `scenarios/presets/`) |
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
