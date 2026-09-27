# About LimitLab

**LimitLab is a motorsport safety test bench.** You drive an F1-style car round
Monza or Baku. Meanwhile an engineer deliberately breaks the car's
**corner-entry BRAKE warning**: the system that tells the driver "brake now, a
corner is coming". LimitLab then measures whether that warning still arrived
in time, which upgrade fixes the failures, and whether the team can afford it.

It is an F1-*inspired* prototype: a simplified vehicle model and scripted test
drivers, not real F1 physics, not certification, and no real team money.

---

## The problem it models

A modern race car's safety warnings depend on a chain:

```
sensors on the car  ->  radio link to the pit wall  ->  warning logic  ->  radio back  ->  screen in front of the driver  ->  the driver's reaction
```

Every link can fail under stress:
- telemetry arrives late, or is lost in a burst
- a sensor freezes or reads wrong
- the brakes fade, or the track is wet
- the driver reacts slowly

A warning that is correct but arrives 0.4 s late is a car in the wall at
300 km/h. LimitLab lets you break each link on purpose and measure the result.

---

## What happens in a session

1. **Drive** (`#drive`). Pick Monza (5.8 km, 7 corners) or Baku (6.0 km, 10
   corners) and drive with any of:
   - the keyboard
   - a gamepad or steering wheel
   - the team's ESP32 steering wheel

   The physics runs on the server at 20 Hz. The browser only sends your
   inputs and draws what the server says happened.
2. **Break it** (`#engineer`, on a phone or a second laptop). The engineer
   joins with the session code and arms a saved fault scenario, or injects
   single faults mid-lap:
   - delay
   - packet loss or blackout
   - frozen or wrong sensors
   - brake fade
   - wet grip
   - slow reactions

   The driver sees the BRAKE warning late, stale, or not at all.
3. **Measure.** For every warning the game records:
   - **Warning margin:** how many metres of margin the warning left.
   - **Clearance:** how close the car came to the track edge.
   - **Track exits:** whether the car left the track or hit a wall.
   - **AI risk:** a trained AI (a TCN ensemble) predicts the car's 1-second
     track-exit risk live.
   - **Driver reaction:** the Drive screen times *your* reaction to every
     BRAKE warning.
4. **Fund the fix** (`#garage`, `#compare`). Three upgrades, each with a
   price. Every combination of them (8 in total) is run on the same fixed
   **held-out stress suite of 42 tests**: same laps, same seeds, same faults,
   only the upgrade changes. The garage shows what each one fixes and what the
   season budget can afford. Compare replays a failing test side by side,
   without the fix and with it.

| Upgrade | Price (CAD) | What it changes |
| --- | --- | --- |
| Brake servicing | 1,500 | worn brakes (75% stopping power) back to 100% |
| Communication improvement | 2,500 | the warning path's delay is multiplied by 0.4 |
| Local warning fallback | 1,000 | the car warns the driver itself when pit-wall data is older than 150 ms |

   On the held-out suite the car passes 14/42 tests with no upgrades, and
   31/42 with brake servicing plus the local fallback (CAD 2,500). That is
   every test any upgrade can fix. 11 tests fail whatever is bought (sensor
   faults and wet braking).

5. **Safety report and leaderboard.** End a session to get:
   - a 0-100 safety score
   - every reaction time, charted against the 0.25-0.40 s the stress suite
     assumes a driver takes
   - the extra metres a slower reaction costs

   Scores can be posted to a per-track leaderboard.

---

## The parts

```
 ESP32 wheel --USB serial--> bridge.py --WebSocket :8765--+
 (tilt steering, joystick,   (and back: game state          |
  LCD, 2 rumble servos)       and rumble for the wheel)     v
                                                   Browser (React + three.js)
 Engineer phone --------------WebSocket-------------> FastAPI backend :8000
                                                   (sessions, physics at 20 Hz,
                                                    faults, warnings, stress
                                                    suite, AI models, cache)
```

### Backend (`backend/`, Python 3.11, FastAPI)
- **Car model** (`app/f1_car.py`): a simplified 2026-regulation car.
  - tyres: slip, load-sensitive tyres and a friction circle, so braking or
    wheelspin costs cornering grip
  - aero: downforce and drag, with Z/X-mode active aero
  - power unit: 400 kW engine, 8-speed gearbox, 350 kW MGU-K on a 4 MJ
    battery
  - performance: 0-100 km/h in ~2.6 s; 325-343 km/h top speed
- **Surfaces:** the car drives differently on what's drawn beside the track:
  - kerbs: 93% grip
  - paved run-off: 80% grip
  - grass: 50% grip, low power and heavy drag
- **Walls:** solid, with swept collision checks against the whole car. An
  impact stops it.
- **Stress framework** (`app/stress/`): a seeded fault scheduler, a simulated
  telemetry and warning pipeline, a scripted test driver, and the
  dev/held-out suites (14 scenario families; 42 held-out tests).
- **AI** (`app/ml`, `app/ai`, `models/`):
  - **TCN ensemble:** three temporal convolutional networks that read 2.5 s of
    telemetry and predict the risk of leaving the track in the next second,
    plus the clearance. Held-out test: PR-AUC 0.94, against 0.08 for a simple
    stopping-distance rule and 0.20 for the true clearance alone. It is an
    observer: it never drives the warnings.
  - **SAC agent** (reinforcement learning): a fault adversary that learns to
    schedule faults that break the warning system. It is compared against
    random search on the same budget.
- **Result cache:** the evaluation and every replay are stored on disk, keyed
  to the code. Restarts are instant, and any code change starts a fresh cache.
- **Leaderboard:** a small JSON file (`backend/.data/`).

### Frontend (`frontend/`, React 19, Vite, React Three Fiber)
- **Pages:** Home, Drive, Engineer, Garage and Compare.
- **Force feedback:** kerbs, run-off, wheel slip, barrier hits and the BRAKE
  warning drive three things:
  - the ESP32 wheel's servos
  - a gamepad's rumble motors
  - the scene: camera shake, sparks, tyre smoke, skid marks, dust, a red
    flash on impact, and red chevrons painted into the braking zone
- **Scenery:**
  - a gradient sky and clouds, a following sun shadow, mown grass and
    asphalt texture
  - raised striped kerbs, tyre walls, braking-marker boards, grandstands
    and a gantry
- **Quality / Performance** graphics switch, for integrated GPUs.
- **Wheel steering filter:** the ESP32 tilt reading is converted to an angle,
  filtered with a One-Euro filter (smooths rumble and hand shake without
  lag), and given a gentle response curve.
- **Best-lap ghost:** a see-through car replays your best valid lap.
- **Engine sound:** generated live in the browser (Web Audio, no audio
  files). The pitch follows the server's rpm, and the loudness and tone follow
  your throttle. It includes cuts on each gear shift, crackle when you lift off
  and tyre squeal on lock-ups or wheelspin. There's a **Sound: On/Off**
  button in the Drive panel, and the setting is remembered.

### The ESP32 wheel (`embedded-firmware/`)
- **Steering:** two MPU6050s, averaged tilt.
- **Joystick (HW-504):** forward is throttle, back is brake, pressing it
  resets the car to the grid. Its rest point is calibrated at boot.
- **1.69" ST7789 screen:**
  - the link state (NO BRIDGE / NO GAME / NO SESSION / CONNECTING / LIVE)
  - steering and pedals
  - the live BRAKE warning or speed
  - the send rate
- **Two SG90 servos on D12:** rumble for kerbs, hits and warnings. They stop
  by themselves 0.5 s after the game goes quiet.
- **`bridge.py`:** turns USB serial into a WebSocket for the browser, and
  sends game state and rumble back to the wheel.

---

## Running it

```bash
scripts/start.sh                       # backend :8000 + frontend :5173
cd embedded-firmware && python bridge.py   # only with the ESP32 wheel
```

- Driver: `http://localhost:5173/#drive`
- Engineer, on the same Wi-Fi: `http://<laptop-ip>:5173/#engineer`

The first start after a code change takes about 1.5 min to evaluate the
suite, then fills the replay cache in the background (about 5 min). Later
starts are instant. See `README.md` for setup, wiring and tests.

**Tests:**
- backend: 309 passed, 5 skipped
- frontend: 132 passed
- firmware: compiled with no warnings
