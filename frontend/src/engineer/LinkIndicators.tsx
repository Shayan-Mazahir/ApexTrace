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
}

// Connection status, measured message age and injected delay are three
// different things and are shown separately: only the first two describe the
// real link; injected delay is a simulated fault.
export function LinkIndicators({ connection, vehicleState, lastMessageAt }: LinkIndicatorsProps) {
  const now = useNow(500)
  const msSince = lastMessageAt === null ? null : Math.max(0, now - lastMessageAt)
  const quality = classifyConnection({
    connected: connection === 'connected',
    msSinceLastMessage: msSince,
    packetAgeMs: vehicleState?.packet_age_ms ?? null,
  })
  const injected = vehicleState?.injected_delay_ms ?? 0

  return (
    <div className="link-indicators">
      <div className="link-indicators__badges">
        <StatusBadge
          label={CONNECTION_LABEL[connection]}
          tone={connection === 'connected' ? 'success' : connection === 'idle' ? 'neutral' : 'warning'}
        />
        <StatusBadge label={`Link quality: ${quality.label}`} tone={LEVEL_TONE[quality.level]} />
      </div>
      <dl className="link-indicators__grid">
        <dt>Measured packet age</dt>
        <dd>{vehicleState ? `${vehicleState.packet_age_ms.toFixed(0)} ms` : '—'}</dd>
        <dt>Injected delay (simulated)</dt>
        <dd>{vehicleState ? `+${injected.toFixed(0)} ms` : '—'}</dd>
        <dt>Last data received</dt>
        <dd>{msSince === null ? '—' : `${msSince.toFixed(0)} ms ago`}</dd>
      </dl>
    </div>
  )
}
