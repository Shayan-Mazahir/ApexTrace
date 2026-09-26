import { useEffect, useState } from 'react'
import { getMlStatus, type MlStatus } from '../api/evaluation'
import './ModelsPanel.css'

type Metrics = {
  windows: number
  positives: number
  base_rate: number
  tcn: { pr_auc: number; brier: number; clearance_mae_m: number; mean_ensemble_spread: number }
  baselines: Record<string, { pr_auc?: number; brier?: number; clearance_mae_m?: number }>
  reliability: { bin: string; n: number; mean_predicted: number; observed_rate: number }[]
}

type SacResult = {
  method: string
  seeds: number
  seeds_with_a_failure: number
  first_failure_step_per_seed: (number | null)[]
  median_first_failure_step: number | null
  failures_found_total: number
  worst_min_clearance_m: number | null
  distinct_failure_bins: number
  bins: string[]
  wall_seconds_total: number
}

function MetricsTable({ title, m }: { title: string; m: Metrics }) {
  return (
    <div className="models__block">
      <h3>
        {title} <small>({m.windows.toLocaleString()} windows, {m.positives.toLocaleString()} positive)</small>
      </h3>
      <table>
        <thead>
          <tr>
            <th>Model</th>
            <th>PR-AUC ↑</th>
            <th>Brier ↓</th>
            <th>Clearance MAE ↓</th>
          </tr>
        </thead>
        <tbody>
          <tr className="models__tcn">
            <td>TCN ensemble</td>
            <td>{m.tcn.pr_auc}</td>
            <td>{m.tcn.brier}</td>
            <td>{m.tcn.clearance_mae_m} m</td>
          </tr>
          {Object.entries(m.baselines).map(([name, b]) => (
            <tr key={name}>
              <td>{name}</td>
              <td>{b.pr_auc ?? '—'}</td>
              <td>{b.brier ?? '—'}</td>
              <td>{b.clearance_mae_m === undefined ? '—' : `${b.clearance_mae_m} m`}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function ModelsPanel() {
  const [status, setStatus] = useState<MlStatus | null>(null)
  useEffect(() => {
    getMlStatus().then(setStatus).catch(() => undefined)
  }, [])
  if (!status) return null
  const tcn = status.tcn as MlStatus['tcn'] & { metrics?: Record<string, Metrics> }
  const sac = status.sac as null | {
    results: SacResult[]
    exported_schedules: { scenario_id: string; segment_min_clearance: number; full_lap_track_exit: boolean; full_lap_exit_location: string | null }[]
    budget_decision_steps_per_seed: number
    note: string
  }
  return (
    <section className="models">
      <h2>AI models</h2>
      {!tcn.available && <p className="models__muted">TCN risk observer unavailable: {tcn.reason}</p>}
      {tcn.metrics && (
        <>
          <p className="models__muted">
            Causal TCN ensemble ({tcn.ensemble_size} seeds) predicting simulated track exit within {tcn.horizon_s} s and
            minimum clearance, from {tcn.window_s} s of observed telemetry only. Runs were split into train / val / test
            before windowing. {tcn.role}.
          </p>
          <div className="models__grid">
            <MetricsTable title="Test split (unseen runs)" m={tcn.metrics.test} />
            <MetricsTable title="Held-out stress suite (different scenario mix)" m={tcn.metrics.suite_out_of_distribution} />
          </div>
          <details>
            <summary>Calibration (test split)</summary>
            <table className="models__rel">
              <thead>
                <tr>
                  <th>Predicted</th>
                  <th>n</th>
                  <th>Mean predicted</th>
                  <th>Observed rate</th>
                </tr>
              </thead>
              <tbody>
                {tcn.metrics.test.reliability.map((r) => (
                  <tr key={r.bin}>
                    <td>{r.bin}</td>
                    <td>{r.n}</td>
                    <td>{r.mean_predicted}</td>
                    <td>{r.observed_rate}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </details>
        </>
      )}
      {sac ? (
        <div className="models__block">
          <h3>SAC fault adversary vs random search (same {sac.budget_decision_steps_per_seed.toLocaleString()}-step budget per seed)</h3>
          <table>
            <thead>
              <tr>
                <th>Method</th>
                <th>Seeds that found a failure</th>
                <th>First failure step (per seed)</th>
                <th>Failures found</th>
                <th>Worst clearance</th>
                <th>Distinct failure bins</th>
                <th>Time</th>
              </tr>
            </thead>
            <tbody>
              {sac.results.map((r) => (
                <tr key={r.method}>
                  <td>{r.method}</td>
                  <td>{r.seeds_with_a_failure} / {r.seeds}</td>
                  <td>{r.first_failure_step_per_seed.map((x) => x ?? 'none').join(', ')}</td>
                  <td>{r.failures_found_total}</td>
                  <td>{r.worst_min_clearance_m === null ? '—' : `${r.worst_min_clearance_m.toFixed(2)} m`}</td>
                  <td title={r.bins.join('\n')}>{r.distinct_failure_bins}</td>
                  <td>{r.wall_seconds_total}s</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="models__muted">{sac.note}</p>
          {sac.exported_schedules.length > 0 && (
            <ul className="models__muted">
              {sac.exported_schedules.map((e) => (
                <li key={e.scenario_id}>
                  <code>{e.scenario_id}</code>: full-lap re-run {e.full_lap_track_exit ? `reproduced an exit (${e.full_lap_exit_location})` : 'did not reproduce an exit'}
                </li>
              ))}
            </ul>
          )}
        </div>
      ) : (
        <p className="models__muted">SAC search not run yet (python -m app.ml.train_sac).</p>
      )}
    </section>
  )
}
