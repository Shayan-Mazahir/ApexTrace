# LimitLab at Formula Tech Hacks 2026: your briefing

Your cheat sheet: what the project is, how it fits the brief, what to show,
and what judges will ask. **Submissions close Sunday 11:00 AM.** Judging runs
12:30-3:00.

---

## 1. The pitch

- **30 seconds:** "Safety systems in motorsport are only as good as the
  conditions they were tested in. LimitLab is a test bench for one of them: the
  warning that tells a driver to brake for a corner. You drive a lap, an
  engineer on a phone breaks the warning in real time (late telemetry, frozen
  sensors, fading brakes), and we measure whether it still arrives in time.
  Then we prove, on a fixed 42-test stress suite, which upgrade fixes the
  failures and whether a small team's budget can pay for it. And we measure
  the one thing simulations usually assume: how fast a real human reacts."
- **One line:** *Test the limit. Fund the fix.*

---

## 2. The theme: Safety in Motorsports

The slides give three main tracks: **pick only one**. The sponsor tracks can
be stacked on top.

| Track | Our fit | What to point at |
| --- | --- | --- |
| **Track 2: Safety Testing** (enter this one) | **Primary.** "A tool that tests or simulates a safety system under stress and failure conditions" is literally what we built. | Engineer injects faults live; the seeded 42-test held-out suite; acceptance declared up front (0 exits, ≥0.5 m clearance, lap complete) |
| Track 1: Safety Diagnosis | Strong secondary | Live AI exit-risk prediction; per-driver reaction measurement |
| Track 3: Safety Fixing | Strong secondary | Upgrades proven on side-by-side replays |
| **Tangerine: Orange Flag** (stack) | "Go from R&D to the end of the season with money left in the bank" | The garage: cash, commitments and reserve decide what's spendable (CAD 4,000); the cheapest combination that passes wins |
| **Ampere: AI for Motorsport Safety** (stack) | AI that "detects, predicts, or prevents safety risks" | TCN ensemble predicts 1-s exit risk (PR-AUC 0.94 vs 0.08 for a stopping-distance rule); SAC agent hunts for failure scenarios |
| **Ollon: Data-Driven Safety** (stack) | "Uses data to identify patterns, predict risks" | ~2,500 simulated laps and 1M+ labelled telemetry windows train the model; real drivers' reaction times collected on the leaderboard |
| **TELUS: Best Connected Solution** (stack) | "Smarter, safer, or more useful because it's connected" | Laptop, engineer phone and ESP32 wheel share one live session; the wheel's screen shows the BRAKE warning and its servos rumble |

**Recommendation:** enter **Track 2**, and stack **Tangerine, Ampere, Ollon
and TELUS**. All four are genuinely covered.

---

## 3. What's in it

### The core loop (Safety Testing)
- **Circuits:** Monza and Baku, real layouts, simplified, with kerbs, run-off,
  grass and solid walls.
- **Car:** a simplified 2026-rules car.
  - tyre grip limits, downforce and active aero
  - hybrid battery and energy recovery, 8-speed gearbox
  - roughly 0-100 km/h in 2.6 s and 340 km/h
- **The system under test:** a corner-entry BRAKE warning, computed on the
  "pit wall" and delivered over a simulated radio link.
- **Faults an engineer can inject from a phone:**
  - telemetry delay or loss, and radio blackouts
  - stale data after a reconnect
  - a frozen sensor, position error, or speed over-read
  - wet grip, brake fade, or slow brake response
  - slow driver reaction
- **Stress suite:** 14 scenario families, 3 seeds each = **42 held-out
  tests**, plus a separate dev suite so no tuning leaks into the results.
  Every upgrade combination runs the exact same tests.

### Fixing it, and paying for it (Track 3, Tangerine)
- **Upgrades:**
  - brake servicing, CAD 1,500
  - faster comms, CAD 2,500
  - a local warning fallback (the car warns itself when pit data is older
    than 150 ms), CAD 1,000
- **Budget:** CAD 12,000 cash, minus 6,000 already owed, minus a 2,000
  reserve = **CAD 4,000 to spend**.
- **Garage:** shows what each upgrade fixes and doesn't fix, and the cheapest
  combination that passes.
- **Compare:** replays the same failing test with and without the fix, side
  by side, with a speed chart and the AI risk overlay.

### AI (Ampere)
- **TCN ensemble (3 models):** reads 2.5 s of telemetry and predicts the
  1-second exit risk and clearance.
  - Held-out test PR-AUC **0.94**.
  - Baselines: 0.08 for a stopping-distance rule, 0.20 for the true
    clearance, 0.02 for chance.
  - It's an observer only: it never drives the warnings. This is a
    deliberate safety design choice.
- **SAC agent:** learns to schedule faults that break the warnings.
  - Against random search on the same budget, over 3 seeds: first failure
    found in a median of 410 steps vs 2,174, and 14 failures vs 8.
  - Honest caveat: only 3 seeds.

### Humans vs the simulation (Diagnosis, Ollon)
- **Live reaction chip:** the Drive screen times your reaction to every BRAKE
  warning, for example "0.68 s, +25 m before braking".
- **Safety report:**
  - a 0-100 score and grade
  - every reaction charted against the **0.25-0.40 s the stress suite
    assumes**
  - the closest call, walls, off-tracks, best lap and peak g
  - a plain verdict, for example "you travel 39 m further before braking than
    it tests for"
- **Leaderboard:** per track, including the average reaction of everyone who
  has driven. **If real people are slower than 0.40 s, the suite's warning
  margins are optimistic: a genuine safety finding.** Get judges to drive and
  post a score.

### Hardware (TELUS, and the wow factor)
- **ESP32 steering wheel:**
  - tilt steering from 2 accelerometers, smoothed so rumble and hand shake
    don't twitch the car
  - a joystick for throttle and brake; pressing it resets to the grid
  - a 1.69" screen showing the link state, steering, pedals, the live BRAKE
    warning and speed
  - **two servos that rumble** on kerbs, run-off, locked wheels and barrier
    hits, with a double-tap on each new BRAKE warning
- **Gamepads:** an Xbox-style pad rumbles the same way.

### Polish
- **Home page:** made for judges, mapping each feature to a track.
- **Visual effects:** sparks, tyre smoke, skid marks and camera shake, plus
  glowing chevrons painted into the braking zone when BRAKE shows.
- **Scenery:** raised striped kerbs, tyre walls, braking boards, clouds and
  sun shadows.
- **Best-lap ghost car.**
- **3-minute Demo mode:** runs the whole story on a timer.
- **Graphics: Performance mode** for weak laptops.

---

## 3b. The headline result (held-out suite, 42 tests)

These come from the stored evaluation (`POST /evaluation/run`), the same
numbers the Garage shows.

| Car | Cost (CAD) | Tests passed | Fits the CAD 4,000 budget? |
| --- | --- | --- | --- |
| No upgrades | 0 | 14 / 42 | yes |
| Local warning fallback | 1,000 | 23 / 42 | yes |
| Brake servicing | 1,500 | 21 / 42 | yes |
| Communication improvement | 2,500 | 18 / 42 | yes |
| **Brake servicing + local fallback** | **2,500** | **31 / 42** | **yes: the best buy** |
| Comms + local fallback | 3,500 | 22 / 42 | yes |
| Brake servicing + comms | 4,000 | 27 / 42 | yes |
| All three | 5,000 | 31 / 42 | **no**, and no better than the 2,500 pair |

- **Best buy:** brake servicing plus the local fallback passes **every test
  that any upgrade can fix**, for CAD 2,500. It leaves CAD 1,500 of the
  season's spendable money untouched.
- **The expensive option:** comms improvement is the priciest single upgrade
  and the weakest. Buying everything costs more than the team can afford,
  for no extra safety.
- **Unsolved:** 11 tests fail whatever you buy. They are Baku position error
  and sensor freeze, Monza wet braking, and the shared sensor failure. The
  garage flags them as "unsolved", honestly: fixing them needs better
  sensors, which isn't on offer.
- **The demo test:** Monza high-speed blackout fails 3/3 without upgrades and
  passes 3/3 with the local fallback alone.

---

## 4. Demo script (about 3 minutes)

1. **Home page (20 s).** The problem in one breath: warnings depend on a
   chain of sensors, radio and logic, and each link can fail.
2. **Drive (60 s).** A judge drives Monza on the ESP32 wheel. Point out:
   - the rumble on kerbs
   - the BRAKE warning on the laptop, the wheel's screen and the painted
     chevrons at once
   - the reaction-time chip after it
3. **Break it (40 s).** On your phone, arm the *Monza high-speed blackout*
   scenario. The warning goes stale, the car runs wide, and the AI risk
   climbs.
4. **Fund the fix (40 s).** In the Garage, the budget shows CAD 4,000
   available. With no upgrades, 14 of 42 tests pass. Brake servicing plus
   the local fallback (CAD 2,500) passes 31: every fixable test, with money
   left. In Compare, the blackout test crashes without the fallback and holds
   with it, side by side.
5. **Close (20 s).** Open the safety report: "the suite assumes 0.25-0.40 s;
   you took 0.7. That's the gap simulations hide." Post the score to the
   leaderboard.

**Plan B:** Demo mode (top right) runs the story automatically. Compare falls
back to a recorded replay if the backend is down.

---

## 5. Before judging: checklist

- [ ] Start the app once **at least 5 minutes before** judging, so the replay
      cache fills (`scripts/start.sh`).
- [ ] Flash `steering-wheel.ino` (keep your hands off the joystick at boot:
      it calibrates). Close the Arduino Serial Monitor. Run
      `python embedded-firmware/bridge.py`.
- [ ] **Power the servos from 5 V, not 3V3,** with grounds joined. If the
      ESP32 won't boot with the servos attached, move their signal wire off
      D12 (see `rumble.h`).
- [ ] Clear the leaderboard: `rm backend/.data/leaderboard.json`.
- [ ] Engineer device on the same Wi-Fi: `http://<laptop-ip>:5173/#engineer`.
- [ ] On a weak GPU: Drive → Graphics: Performance.
- [ ] Commit and push to the submission repo before 11:00.

---

## 6. Questions judges will likely ask

- **"Is this real F1 physics?"** No, and we say so up front. It's a simplified
  model built to be plausible and *repeatable*: the same seed gives the same
  lap. That's what makes it a test bench. The acceptance rules are declared
  before any comparison.
- **"How do you know the upgrade really helps, and it isn't luck?"**
  - Paired experiments: same track, seed, start, driver and fault schedule;
    only the upgrade changes.
  - The final numbers come only from the held-out suite, never the dev suite
    we tuned on.
  - Tests that no upgrade can pass are flagged as "unsolved" rather than
    hidden.
- **"Why doesn't the AI drive the warnings?"** Because it's a learned model
  with failure modes of its own. It watches and flags risk; the deterministic
  warning logic stays in charge. We compared it against baselines, not just a
  headline number.
- **"What does the hardware add?"** The wheel is the driver's side of the
  safety loop. It shows the same BRAKE warning, and its rumble makes kerbs and
  hits felt. It turns "connected" into something you can hold.
- **"What would you do next?"**
  - Calibrate the reaction model on the leaderboard data.
  - Add more circuits.
  - Feed the SAC-discovered failures back into the fixed suite, reviewed by a
    person.
  - Make the local fallback smarter, using the TCN risk as a second opinion.

---

## 7. Honest limits

- A simplified vehicle model and scripted test drivers; not certification.
- Prices and budgets are made-up numbers for a fictional team.
- The SAC-vs-random comparison is 3 seeds.
- The AI was trained on this simulator only.
- Riding a kerb with the car's centre past the white line counts as a track
  exit. It's the suite's safety rule, stricter than F1's four-wheels rule.
