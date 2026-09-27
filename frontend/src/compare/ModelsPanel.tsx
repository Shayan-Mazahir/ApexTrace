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
  'naive_stopping_margin (observed speed & corner distance)': 'Simple speed rule',
  'current_true_clearance (not available to the TCN)': 'Knows true edge distance',
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
          <p>Predicts, 1 second ahead, whether the car will leave the track, using only what the car reports.</p>
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
                <h4>Spotting crashes <small>(score, 1 = perfect)</small></h4>
                <Bars
                  max={1}
                  fmt={(v) => v.toFixed(2)}
                  rows={[
                    { label: 'Crash predictor', value: m.tcn.pr_auc, hero: true },
                    ...Object.entries(m.baselines)
                      .filter(([, b]) => b.pr_auc !== undefined)
                      .map(([k, b]) => ({ label: BASELINE_NAME[k] ?? k, value: b.pr_auc as number })),
                  ]}
                />
                <p className="ml-foot">{m.windows.toLocaleString()} unseen moments · edge distance off by {m.tcn.clearance_mae_m.toFixed(2)} m on average</p>
              </div>
              <div className="ml-calwrap">
                <h4>Honest percentages?</h4>
                <Calibration bins={m.reliability} />
                <p className="ml-foot">On the dashed line = yes.</p>
              </div>
            </div>
          </>
        )}
      </article>

      <article className="ml-card">
        <header>
          <span className="ml-card__kicker">AI model 2 · reinforcement learning</span>
          <h3>Fault-finding AI vs random search</h3>
          <p>Learns which faults make the car crash. Same limits and number of attempts as random search.</p>
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
                <h4>Attempts to first crash <small>(fewer = better)</small></h4>
                {sacRows('median_first_failure_step', (v) => Math.round(v).toLocaleString(), true)}
              </div>
              <div>
                <h4>Different kinds of crash</h4>
                {sacRows('distinct_failure_bins', (v) => String(v))}
              </div>
            </div>
            <h4 className="ml-h4">Its crashes, re-run on a full lap</h4>
            <div className="ml-chips">
              {sac.exported_schedules.map((e) => (
                <span key={e.scenario_id} className={`ml-chip ${e.full_lap_track_exit ? 'is-crash' : ''}`}>
                  {e.scenario_id.replace(/^sac_monza_/, '').replace(/__t\d+_/, ' · ').replace(/_/g, ' ')}
                  <b>{e.full_lap_track_exit ? 'crashes again' : 'no crash'}</b>
                </span>
              ))}
            </div>

          </>
        )}
      </article>
    </div>
  )
}
