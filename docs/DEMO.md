# Demo guide

## Fresh-launch checklist

Do this on a cold start, before the judge arrives.

**Automated (recommended):** open the app → **Demo mode** → **Run fresh-launch
checklist**. It verifies, against the live backend:

| Check | What it proves |
|---|---|
| Backend reachable | `/health` answers |
| Saved scenarios loaded | both presets (Monza high-speed braking, Azerbaijan stale telemetry) exist |
| Upgrade catalog and 8 combinations | 3 upgrades, 8 combinations enumerated |
| Fixed evaluation suite ready | 36 tests × 8 configurations complete (also warms the cache) |
| Live session streams telemetry | Monza **and** Baku sessions each open a WebSocket and stream `vehicle_state` |
| Steering input | wheel detected — or a *warning* that keyboard fallback will be used |
| Backup replay recording present | `frontend/public/backup-replay.json` has frames |

Green or "warning" (keyboard only) = ready. Any **Failed** = fix first.

**By hand:**

1. `scripts/start.sh` (or the two manual commands in the README).
2. Open `http://localhost:5173/#drive` on the driver laptop; note the LAN URL it prints.
3. On the second device open `http://<laptop-ip>:5173/#engineer`.
4. Wheel plugged in? Move it, confirm the raw axes react; press *Set steering centre*.
5. If you changed the simulator or suite, re-record the backup:
   `cd backend && source venv/bin/activate && python ../scripts/record_backup_replay.py`
6. Optional full check: `cd frontend && npm run e2e`.

## The three-minute script

**Demo mode** runs this on a timer (Esc stops; Back / Skip / Pause on the bar).

| # | Step | Time | What happens | What to say |
|---|------|------|--------------|-------------|
| 1 | Brief | 15 s | Garage: CAD 12,000 cash, 6,000 committed, 2,000 reserve → **CAD 4,000 available** | "Four events left. Can we improve the warning system without touching money already committed?" |
| 2 | Drive | 30 s | Drive screen auto-starts; a hidden engineer joins and launches the saved scenario | "The judge drives. The outcome is whatever really happens — we don't force a crash." |
| 3 | Inspect | 30 s | Compare: baseline vs upgraded automated replay with timelines | "This is an *automated scripted driver*, not you. Fault onset, warning, braking, clearance." |
| 4 | Choose | 30 s | Garage: an upgrade is picked; available budget changes immediately | "Three upgrades, each with an exact simulated effect." |
| 5 | Retest | 45 s | Every combination re-runs the same 36-test suite; synchronized replays | "Same scripted controller responds to the warnings in both runs. It may brake differently." |
| 6 | Decide | 30 s | Verdict, cost, and cash remaining after commitments, reserve and upgrade | "Passed *this test suite* — not certified safe." |

The judge can also drive the upgraded configuration (Garage → **Drive this
configuration**). A human second attempt is an experience, not controlled proof.

**If the judge avoids a failure** in step 2, the Compare screen still shows the
authentic recorded automated failure. **If the backend dies**, Compare falls
back to `backup-replay.json` (a real recording, labelled as such).

## What the evidence is — and isn't

Read this before claiming anything from the numbers.

- **Tracks:** Monza (5.793 km) and Baku (6.003 km) are traced from real
  circuit maps, spline-smoothed and scaled to the real lap length. Corners are
  detected from curvature and named after the real turns; Baku's castle section
  (T8–T12) narrows to 7.6 m. Simplified, not survey-accurate.
- **Car model:** a toy, F1-ish point-mass: ~317 km/h top speed, ~4 g braking,
  ~3.5 g lateral grip, quadratic drag, and **combined grip** — hard braking eats
  into cornering grip, and grip loss limits braking too. Leaving the track is
  recorded but does not stop the car (runoff slows it; you can rejoin). Not real
  tyre or aero physics.
- **Suite (`suite-v3`):** 36 tests (both tracks; 6 fault types × 3 seeded stress
  replicates varying entry speed 80–88 m/s, reaction 0.25–0.40 s and starting
  line). Single faults at the worst end of the declared ranges; pairs at 75%.
  Acceptance, declared before comparing: 0 track exits, lap completed, minimum
  clearance ≥ 0.50 m. The scripted driver follows the line (pure pursuit) and
  brakes **only** in response to warnings; the evaluation stops a run at its
  first track exit.
- **Calibration, disclosed:** the baseline warning padding (0.35 s reaction
  allowance + 7 m margin) was chosen once, on the *unupgraded baseline only*, as
  the most generous padding at which the baseline still fails some test (at
  ≥ 8 m it passed everything, so the suite could not discriminate). It is a model
  assumption. Model flaws found on the way were fixed rather than tuned around:
  an abrupt width step into Baku's castle section, and a scripted driver whose
  proportional steering ran wide in long corners.
- **Results at freeze:**

  | Configuration | Cost | Passed | Worst clearance |
  |---|---|---|---|
  | Baseline | 0 | no — **track exit** in `monza_grip_and_delay_1` | −0.15 m |
  | Local warning fallback | 1,000 | **yes** | 2.00 m |
  | Brake servicing | 1,500 | no (same test, same exit) | −0.15 m |
  | Communication improvement | 2,500 | **yes** | 2.00 m |
  | Brake servicing + Local fallback | 2,500 | **yes** | 2.00 m |
  | Comms + Local fallback | 3,500 | **yes** | 2.00 m |
  | Brake servicing + Comms | 4,000 | **yes** | 2.00 m |
  | All three | 5,000 | **yes** | 2.00 m |

  With the sample budget the cheapest configuration that passed and fits is the
  **local warning fallback, CAD 1,000**, leaving CAD 3,000 after commitments and
  reserve. The failure is a stale-telemetry problem (grip patch + 300 ms delay):
  fixing the warning path fixes it; better brakes alone do not.
- **Limits:** one failing test out of 36 decides the ranking — that is thin
  evidence, and it comes from one scripted driver on a toy model. No fabricated
  ROI, crash probability, bank transfer or sponsor integration. Delay injection
  is a controlled test condition, not a measurement of any real network.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Backend unreachable" | start the backend; check `curl localhost:8000/health` |
| Engineer device can't join | same Wi-Fi? use the laptop's LAN IP, not `localhost`; firewall allowing :8000 and :5173 |
| "Session lost" after a backend restart | sessions are in memory; the app returns to the circuit picker — press Start |
| Stale-telemetry banner while idle | the browser throttles background tabs; keep the Drive tab in front |
| First evaluation is slow | the backend warms it at start-up (~4 s); the checklist also triggers it |
