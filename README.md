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

**Detailed car model (optional, per machine):** the game draws
`frontend/public/models/car.glb` if it exists, and silently falls back to the
built-in car if not. Both it and the raw model are git-ignored (too big), so on
each machine drop the RB22 `.glb` into `frontend/public/` and run:

```bash
python3 scripts/optimize_car_model.py   # needs Pillow; writes public/models/car.glb
```

It caps textures at 1024 px (GPU texture memory ~391 MB → ~122 MB) and leaves
the meshes and material names alone, so the wheels still spin and steer. Refresh
the page afterwards: the game checks for the model once per page load.

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

**Result cache:** the upgrade evaluation (~340 simulated laps) and every
Compare replay are deterministic, so they are stored in `backend/.cache/`
(git-ignored). The first start after a change computes the evaluation
(~1.5 min) and then fills the replays in the background on one low-priority
core (~5 min); later starts read them back instantly. Editing anything under
`backend/app/`, `config/`, `scenarios/` or the TCN models invalidates it
automatically. `rm -rf backend/.cache` clears it, `LIMITLAB_CACHE=0` turns it off.

Screens are addressable by hash: `#home` (the front page: what LimitLab is,
how a run works, which challenge track each part answers, live leaderboard),
`#drive`, `#engineer`, `#garage`, `#compare`.

**Driver safety report + leaderboard:** the Drive screen times the real
driver's reaction to every BRAKE warning (warning shown -> brake past 30 %),
flags warnings ignored or anticipated, and tracks the closest call, walls,
off-tracks, best lap, top speed and peak g. A chip under the BRAKE banner
shows each reaction as it happens; **Safety report** (and End session) opens
the full report: a 0-100 safety score, every reaction charted against the
0.25-0.40 s the stress suite's scripted driver assumes, and what a slower
reaction costs in metres. Scores can be posted to a per-track leaderboard
(`GET/POST /leaderboard`, stored in `backend/.data/leaderboard.json`,
git-ignored; `rm` it to reset before a demo).
Health check: `curl localhost:8000/health`.

## Controls

| Action | Keyboard | Wheel / gamepad | ESP32 wheel |
| --- | --- | --- | --- |
| Throttle / brake | W / ↑, S / ↓ / Space | right / left trigger | joystick forward / back |
| Steer | A / ←, D / → | axis 0 | turn the wheel |
| Shift up / down (manual) | E / Q | RB / LB (paddles) | — |
| DRS / active aero (manual) | F | A | — |
| Reverse (when stopped) | R | X | — |
| Cycle battery mode | B | Y | — |
| Reset to grid | dock button | dock button | press the joystick down |
| Force feedback | — | rumble motors | 2x SG90 servos |

A wheel/gamepad is used automatically if the browser sees one (calibrate
centre and dead-zone in the Controls panel of the Drive screen). The view
button cycles cockpit, chase and overview cameras. **Graphics: Quality /
Performance** (Drive screen dock) is remembered per machine and applies to
every 3D view: Performance renders at 1x with no bloom/anti-aliasing effects,
for integrated GPUs such as Intel Iris Xe.

**ESP32 wheel** (`embedded-firmware/`): flash `steering-wheel/steering-wheel.ino`,
plug the ESP32 into the driver laptop, and run the serial-to-WebSocket bridge
alongside the app (`pip install pyserial websockets` once):

```bash
cd embedded-firmware && python bridge.py   # auto-detects the port; --list / --port to choose
```

Its live readout shows the steering, pedal and reset values it forwards, so
the hardware can be checked on its own. The Drive screen picks the wheel up
automatically (Controls panel: `Input: ESP32 wheel`); a plugged-in gamepad
takes priority. On Linux, reading the port needs the `dialout` group.
**Leave the joystick untouched while the wheel powers up:** the firmware
measures its rest point at boot (the Serial Monitor shows
`# joystick centre ...`), so a stick held during boot reads as drift.

**Wheel screen** (1.69" 240x280 ST7789V2, 4-wire SPI): GND→GND, VCC→3V3,
SCL→D18, SDA→D23, RES→D4, DC→D2, CS→D5, BLK→3V3. Needs the *Adafruit ST7735
and ST7789* and *Adafruit GFX* libraries; `testing/display_test` is a quick
bring-up sketch for the screen alone. It shows steering (a centre-zero bar and
the raw g value), throttle and brake, the live BRAKE / STALE warning or the
speed, and the actual send rate and packet number. The game's side of that
reaches the ESP32 back through the bridge. The top banner says where the chain
is broken:

| Banner | Meaning | Fix |
| --- | --- | --- |
| LIVE | in a session, driving with this wheel | — |
| NO BRIDGE | nothing from `bridge.py` for 1.5 s | start the bridge (and close the Serial Monitor) |
| NO GAME | bridge up, no Drive screen connected | open `#drive` on the laptop |
| NO SESSION | Drive screen open, no session | press Start |
| CONNECTING | session (re)connecting to the backend | check the backend is running |
| WHEEL NOT IN USE | in a session, but another input is driving | unplug the gamepad, or check the wheel's data reaches the browser |

**Force feedback** (like a console pad's rumble): kerbs drum at the rate the
stripes pass under the wheels, run-off shakes irregularly, locked or spinning
wheels fizz, a barrier hit knocks hard and a new BRAKE warning taps twice. It
goes to whichever input is driving: the ESP32 wheel's two SG90 servos (below)
or an Xbox-style gamepad's motors (Chrome/Edge). The same signal drives what
you see: camera shake, sparks from the floor (kerbs, bottoming out at top
speed, heavy braking, barrier hits), tyre smoke and skid marks from locked or
spinning wheels, dust off the track, a red flash round the screen on impact,
and red chevrons painted down the road into the corner while BRAKE is shown.

**Wheel servos** (2x SG90, rumble): both signal wires -> D12, V+ -> **5 V**
(not 3V3), GND -> GND. Each can pull ~0.6 A when it reverses, which browns
out the ESP32 and its screen from 3V3: use a separate 5 V supply (or the
ESP32's 5V/VIN pin off a good USB port for short demos), with a 470-1000 uF
capacitor across the servos' V+ and GND. D12 is a boot strapping pin: if the
board won't boot with the servos attached, move the signal to D13/D14/D26/D27
and change `PIN_RUMBLE_SERVO` in `rumble.cpp`. The servos stop on their own
0.5 s after the game stops sending, and go limp (silent) when still.

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
