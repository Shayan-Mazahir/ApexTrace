import { useEffect, useState } from 'react'
import { getMlStatus, type MlStatus } from '../api/evaluation'
import './ModelsPanel.css'

type Split = {
  windows: number
  positives: number
  base_rate: number
  tcn: { pr_auc: number; brier: number; clearance_mae_m: number }
  baselines: Record<string, { pr_auc?: number; clearance_mae_m?: number }>
  reliability: { bin: string; n: number; mean_predicted: number; observed_rate: number }[]
}
type SacSummary = {
  method: string
  seeds: number
  seeds_with_a_failure: number
  median_first_failure_step: number | null
  failures_found_total: number
  distinct_failure_bins: number
  wall_seconds_total: number
}
type Sac = {
  results: SacSummary[]
  exported_schedules: { scenario_id: string; full_lap_track_exit: boolean; full_lap_exit_location: string | null }[]
  budget_decision_steps_per_seed?: number
}

const BASELINE_NAME: Record<string, string> = {
  constant_base_rate: 'Guessing the average',
  'naive_stopping_margin (observed speed & corner distance)': 'Simple rule: speed vs distance to corner',
  'current_true_clearance (not available to the TCN)': 'Cheat: knows the true distance to the edge now',
}

function Bars({ rows, max, fmt }: { rows: { label: string; value: number; hero?: boolean; note?: string }[]; max: number; fmt: (v: number) => string }) {
  return (
    <div className="ml-bars">
      {rows.map((r) => (
        <div key={r.label} className={`ml-bar ${r.hero ? 'is-hero' : ''}`}>
          <span className="ml-bar__label">
            {r.label}
            {r.note && <small>{r.note}</small>}
          </span>
          <div className="ml-bar__track">
            <div className="ml-bar__fill" style={{ width: `${Math.max(1.5, (r.value / max) * 100)}%` }} />
          </div>
          <b className="ml-bar__value">{fmt(r.value)}</b>
        </div>
      ))}
    </div>
  )
}

function Calibration({ bins }: { bins: Split['reliability'] }) {
  const S = 150
  const pts = bins.filter((b) => b.n >= 50)
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="ml-cal" role="img" aria-label="Predicted versus actual crash rate">
      <rect x="0" y="0" width={S} height={S} rx="10" className="ml-cal__bg" />
      <line x1="12" y1={S - 12} x2={S - 12} y2="12" className="ml-cal__ideal" />
      <polyline className="ml-cal__line" points={pts.map((b) => `${12 + b.mean_predicted * (S - 24)},${S - 12 - b.observed_rate * (S - 24)}`).join(' ')} />
      {pts.map((b) => (
        <circle key={b.bin} cx={12 + b.mean_predicted * (S - 24)} cy={S - 12 - b.observed_rate * (S - 24)} r="3.2" className="ml-cal__dot" />
      ))}
    </svg>
  )
}

export function ModelsPanel() {
  const [status, setStatus] = useState<MlStatus | null>(null)
  const [split, setSplit] = useState<'test' | 'suite_out_of_distribution'>('test')
  useEffect(() => {
    getMlStatus().then(setStatus).catch(() => undefined)
  }, [])
  if (!status) return null
  const tcn = status.tcn as MlStatus['tcn'] & { metrics?: Record<string, Split>; ensemble_size?: number }
  const sac = status.sac as Sac | null
  const m = tcn.metrics?.[split]

  const sacRows = (key: keyof SacSummary, fmt: (v: number) => string, lowerIsBetter = false) => {
    const rs = sac?.results ?? []
    const vals = rs.map((r) => Number(r[key] ?? 0))
    const max = Math.max(...vals, 1e-6)
    return (
      <Bars
        rows={rs.map((r, i) => ({ label: r.method === 'SAC' ? 'SAC (learning AI)' : 'Random search', value: vals[i], hero: r.method === 'SAC' }))}
        max={max}
        fmt={(v) => fmt(v) + (lowerIsBetter ? '' : '')}
      />
    )
  }

  return (
    <div className="ml">
      <article className="ml-card">
        <header>
          <span className="ml-card__kicker">AI model 1 · neural network</span>
          <h3>Crash predictor</h3>
          <p>
            Watches the last 2.5 s of what the car reports (speed, pedals, steering, warnings, but never the hidden true grip) and
            predicts the chance of leaving the track in the next second. It only observes; it never triggers warnings.
          </p>
        </header>
        {!tcn.available || !m ? (
          <p className="ml-muted">Not available: {tcn.reason ?? 'no trained model'}.</p>
        ) : (
          <>
            <div className="ml-tabs" role="tablist">
              <button type="button" className={split === 'test' ? 'on' : ''} onClick={() => setSplit('test')}>Unseen runs</button>
              <button type="button" className={split !== 'test' ? 'on' : ''} onClick={() => setSplit('suite_out_of_distribution')}>New scenario mix</button>
            </div>
            <div className="ml-grid">
              <div>
                <h4>How well it spots crashes coming <small>(PR-AUC: 1 is perfect)</small></h4>
                <Bars
                  max={1}
                  fmt={(v) => v.toFixed(2)}
                  rows={[
                    { label: `Crash predictor (${tcn.ensemble_size ?? 1} models averaged)`, value: m.tcn.pr_auc, hero: true },
                    ...Object.entries(m.baselines)
                      .filter(([, b]) => b.pr_auc !== undefined)
                      .map(([k, b]) => ({ label: BASELINE_NAME[k] ?? k, value: b.pr_auc as number })),
                  ]}
                />
                <p className="ml-foot">
                  Tested on {m.windows.toLocaleString()} moments it never trained on, {m.positives.toLocaleString()} of them just before a crash.
                  Its distance-to-edge guess is off by {m.tcn.clearance_mae_m.toFixed(2)} m on average.
                </p>
              </div>
              <div className="ml-calwrap">
                <h4>Are its percentages honest?</h4>
                <Calibration bins={m.reliability} />
                <p className="ml-foot">Dots on the diagonal mean &quot;when it says 70%, it happens about 70% of the time&quot;.</p>
              </div>
            </div>
          </>
        )}
      </article>

      <article className="ml-card">
        <header>
          <span className="ml-card__kicker">AI model 2 · reinforcement learning</span>
          <h3>Fault-finding AI vs random search</h3>
          <p>
            An AI (SAC) learns to switch on grip loss, telemetry delay and brake fade, within fixed limits, to make the car crash. We
            compare it with trying random faults, both given the same number of attempts{sac?.budget_decision_steps_per_seed ? ` (${sac.budget_decision_steps_per_seed.toLocaleString()} per seed)` : ''}.
          </p>
        </header>
        {!sac ? (
          <p className="ml-muted">Not run yet (python -m app.ml.train_sac).</p>
        ) : (
          <>
            <div className="ml-grid ml-grid--3">
              <div>
                <h4>Crashes found</h4>
                {sacRows('failures_found_total', (v) => String(v))}
              </div>
              <div>
                <h4>Attempts before the first crash <small>(fewer is better)</small></h4>
                {sacRows('median_first_failure_step', (v) => Math.round(v).toLocaleString(), true)}
              </div>
              <div>
                <h4>Different kinds of crash</h4>
                {sacRows('distinct_failure_bins', (v) => String(v))}
              </div>
            </div>
            <h4 className="ml-h4">Crashes it discovered, replayed on a full lap</h4>
            <div className="ml-chips">
              {sac.exported_schedules.map((e) => (
                <span key={e.scenario_id} className={`ml-chip ${e.full_lap_track_exit ? 'is-crash' : ''}`}>
                  {e.scenario_id.replace(/^sac_monza_/, '').replace(/__t\d+_/, ' · ').replace(/_/g, ' ')}
                  <b>{e.full_lap_track_exit ? `crashes again (${e.full_lap_exit_location})` : 'did not crash on a full lap'}</b>
                </span>
              ))}
            </div>
            <p className="ml-foot">A crash found on a short test stretch may not repeat on a full lap, where the car arrives at a different speed. You can arm these from the Engineer tab.</p>
          </>
        )}
      </article>
    </div>
  )
}
