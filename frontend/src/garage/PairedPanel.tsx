import { useEffect, useState } from 'react'
import { getPaired } from '../api/evaluation'
import { listScenarios } from '../api/session'
import { StatusBadge } from '../components/StatusBadge'
import type { PairedResponse, StressScenario, UpgradeConfig } from '../types/schemas'
import './PairedPanel.css'

// Clean / A / B / A+B / A+B+upgrade on identical track, seed, start, driver
// and disturbance schedule — the controlled way to see what each fault and
// the upgrade contribute.
export function PairedPanel({ upgrade }: { upgrade: UpgradeConfig }) {
  const [scenarios, setScenarios] = useState<StressScenario[]>([])
  const [scenarioId, setScenarioId] = useState('combined_moderate')
  const [result, setResult] = useState<PairedResponse | null>(null)
  const [running, setRunning] = useState(false)

  useEffect(() => {
    listScenarios()
      .then((all) => setScenarios(all.filter((s) => s.faults.length >= 1 && s.source !== 'sac')))
      .catch(() => undefined)
  }, [])

  const run = async () => {
    setRunning(true)
    try {
      setResult(await getPaired(scenarioId, upgrade))
    } finally {
      setRunning(false)
    }
  }

  const noUpgrade = !Object.values(upgrade).some(Boolean)
  return (
    <section className="paired">
      <div className="paired__controls">
        <label>
          <span>Paired experiment</span>
          <select value={scenarioId} onChange={(e) => setScenarioId(e.target.value)}>
            {scenarios.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} ({s.faults.length} fault{s.faults.length > 1 ? 's' : ''})
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={run} disabled={running || noUpgrade}>
          {running ? 'Running…' : 'Run clean / A / B / A+B / +upgrade'}
        </button>
        {noUpgrade && <small>Select an upgrade above to compare against.</small>}
      </div>
      {result && (
        <div className="paired__scroll">
          <table>
            <thead>
              <tr>
                <th>Run (seed {result.seed})</th>
                <th>Outcome</th>
                <th>Min clearance</th>
                <th>Worst warning margin</th>
                <th>Stale time</th>
                <th>Exit at</th>
              </tr>
            </thead>
            <tbody>
              {result.rows.map((r) => (
                <tr key={r.key}>
                  <td>{r.label}</td>
                  <td>
                    <StatusBadge tone={r.result.passed ? 'info' : 'danger'} label={r.result.passed ? 'passed' : r.result.track_exit ? 'track exit' : 'failed'} />
                  </td>
                  <td>{r.result.min_clearance_m.toFixed(2)} m</td>
                  <td>{r.result.min_warning_margin_m === null ? '—' : `${r.result.min_warning_margin_m.toFixed(1)} m`}</td>
                  <td>{r.result.stale_time_s.toFixed(1)} s</td>
                  <td>{r.result.exit_location ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
