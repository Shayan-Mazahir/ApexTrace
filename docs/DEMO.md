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

- The fixed suite is **36 tests** (both tracks; 6 fault types × 3 seeded stress
  replicates). Acceptance was declared before any comparison: 0 track exits,
  lap completed, minimum clearance ≥ 0.50 m. Single faults sit at the worst end
  of the declared ranges; paired faults use 75% of each worst case.
- The vehicle is a toy model (speed-limited cornering, a lagged grip estimate,
  a warning that advises a corner speed). The driver is scripted and brakes
  only in response to warnings.
- **Calibration, disclosed:** the baseline warning padding (0.35 s + 10 m) was
  chosen once, on the *unupgraded baseline only*, as the most generous padding at
  which the baseline still fails some test (at ≥ 11 m it passed everything, so
  the suite could not discriminate). It is a model assumption. Two model flaws
  found on the way were fixed rather than tuned around: a heading kink at the
  start/finish seam, and a 2% dead band in the warning rule.
- **Results at freeze** (`suite-v2`):

  | Configuration | Cost | Passed | Worst clearance |
  |---|---|---|---|
  | Baseline | 0 | no (`monza_grip_and_delay_2`) | 0.46 m |
  | Local warning fallback | 1,000 | **yes** | 0.54 m |
  | Brake servicing | 1,500 | no (`monza_brake_fade_1`) | 0.48 m |
  | Communication improvement | 2,500 | **yes** | 0.54 m |
  | Brake servicing + Local fallback | 2,500 | no (same test) | 0.48 m |
  | Comms + Local fallback | 3,500 | **yes** | 0.54 m |
  | Brake servicing + Comms | 4,000 | no (same test) | 0.48 m |
  | All three | 5,000 | no (same test) | 0.48 m |

  With the sample budget the cheapest configuration that passed and fits is the
  **local warning fallback, CAD 1,000**, leaving CAD 3,000 after commitments and
  reserve.

- **Treat these as thin.** Every worst clearance is within ~0.05 m of the 0.50 m
  threshold. Notably, every configuration *with* brake servicing "fails" one test
  by 0.02 m that the baseline passes — better brakes made one scripted-driver run
  marginally worse. That is model/driver noise, not a real effect, and it is
  exactly why the UI shows the failing test and its margin. No configuration
  produced a track exit in this suite; the differences are clearance margins.
- No fabricated ROI, crash probability, bank transfer or sponsor integration.
  Delay injection is a controlled test condition, not a measurement of any
  real network.

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Backend unreachable" | start the backend; check `curl localhost:8000/health` |
| Engineer device can't join | same Wi-Fi? use the laptop's LAN IP, not `localhost`; firewall allowing :8000 and :5173 |
| "Session ended" after a backend restart | sessions are in memory; press Start for a new one |
| Stale-telemetry banner while idle | the browser throttles background tabs; keep the Drive tab in front |
| First evaluation is slow | the backend warms it at start-up (~4 s); the checklist also triggers it |
