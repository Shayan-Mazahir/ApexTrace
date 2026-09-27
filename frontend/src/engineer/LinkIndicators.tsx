import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { useNow } from '../hooks/useNow'
import { classifyConnection, type ConnectionLevel } from '../stream/connectionQuality'
import type { StreamConnection } from '../stream/useSessionStream'
import type { VehicleStateMessage } from '../types/schemas'
import './LinkIndicators.css'

const LEVEL_TONE: Record<ConnectionLevel, StatusTone> = {
  good: 'success',
  degraded: 'warning',
  poor: 'danger',
  offline: 'danger',
}

const CONNECTION_LABEL: Record<StreamConnection, string> = {
  idle: 'Not joined',
  connecting: 'Connecting…',
  connected: 'Connected',
  reconnecting: 'Reconnecting…',
  closed: 'Session ended',
}

interface LinkIndicatorsProps {
  connection: StreamConnection
  vehicleState: VehicleStateMessage | null
  lastMessageAt: number | null
  driverOffline?: boolean
}

const ms = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${v.toFixed(0)} ms`)

// Real link (this device <-> server, heartbeat-driven) and the SIMULATED
// warning-data path are shown separately: only the first is a network.
export function LinkIndicators({ connection, vehicleState: v, lastMessageAt, driverOffline }: LinkIndicatorsProps) {
  const now = useNow(500)
  const msSince = lastMessageAt === null ? null : Math.max(0, now - lastMessageAt)
  const quality = classifyConnection({ connected: connection === 'connected', msSinceLastMessage: msSince, packetAgeMs: v?.packet_age_ms ?? null })

  return (
    <div className="link-indicators">
      <div className="link-indicators__badges">
        <StatusBadge label={CONNECTION_LABEL[connection]} tone={connection === 'connected' ? 'success' : connection === 'idle' ? 'neutral' : 'warning'} />
        <StatusBadge label={`Real link: ${quality.label}`} tone={LEVEL_TONE[quality.level]} />
        {v?.blackout && <StatusBadge label="Simulated blackout" tone="danger" />}
        {v?.local_fallback_active && <StatusBadge label="Local fallback active" tone="info" />}
      </div>
      <p className="link-indicators__key">
        <b>Real</b> rows measure the actual connection between this browser and the server. <b>Sim</b> rows are artificial:
        they show the faults we are injecting into the warning system (the network itself is fine).
        {driverOffline && ' The driver tab is closed or not sending (leaving the Drive tab disconnects the driver), so "driver control age" keeps growing. That is expected.'}
      </p>
      <dl className="link-indicators__grid">
        <dt>Real: last data received</dt>
        <dd>{msSince === null ? '—' : `${msSince.toFixed(0)} ms ago`}</dd>
        <dt>Real: driver control age</dt>
        <dd>{ms(v?.packet_age_ms)}</dd>
        <dt>Sim: warning-data sample age</dt>
        <dd>{ms(v?.sample_age_ms)}</dd>
        <dt>Sim: injected uplink delay</dt>
        <dd>{v ? `+${v.injected_delay_ms.toFixed(0)} ms` : '—'}</dd>
        <dt>Sim: warning delivery delay</dt>
        <dd>{v ? `+${v.warning_delivery_delay_ms.toFixed(0)} ms` : '—'}</dd>
        <dt>Sim: grip actual / estimated</dt>
        <dd>{v ? `${v.true_grip.toFixed(2)} / ${v.estimated_grip.toFixed(2)}` : '—'}</dd>
      </dl>
    </div>
  )
}
