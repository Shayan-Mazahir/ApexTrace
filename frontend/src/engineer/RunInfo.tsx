import type { SessionInfoMessage } from '../types/schemas'
import './RunInfo.css'

export function RunInfo({ info }: { info: SessionInfoMessage | null }) {
  return (
    <dl className="run-info">
      <dt>Run ID</dt>
      <dd>{info?.run_id ?? '—'}</dd>
      <dt>Seed</dt>
      <dd>{info?.seed ?? '—'}</dd>
      <dt>Session</dt>
      <dd>{info?.session_id ?? '—'}</dd>
      <dt>Track</dt>
      <dd>{info?.track ?? '—'}</dd>
      <dt>Scenario</dt>
      <dd>{info?.scenario_id ?? 'none'}</dd>
      <dt>Driver</dt>
      <dd>{info ? (info.driver_connected ? 'connected' : 'disconnected') : '—'}</dd>
    </dl>
  )
}
