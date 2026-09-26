import { useEffect, useState } from 'react'
import type { WarningState } from '../stream/warningState'
import './BrakeWarning.css'

// Rendered from sequenced warning events (out-of-order ones are dropped
// upstream). The trigger itself is still the backend's placeholder rule,
// pending Person A's real grip/braking-distance warning system.
export function BrakeWarning({ warning }: { warning: WarningState }) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (!warning.active) return
    const interval = setInterval(() => setNow(Date.now()), 100)
    return () => clearInterval(interval)
  }, [warning.active])

  if (!warning.active) return null

  const ageSeconds = warning.since === null ? 0 : Math.max(0, now - warning.since) / 1000

  return (
    <div className="brake-warning" role="alert">
      <div className="brake-warning__label">BRAKE</div>
      <div className="brake-warning__reason">{warning.reason}</div>
      <div className="brake-warning__meta">
        {warning.hazardZone ? `${warning.hazardZone} · ` : ''}
        warning age {ageSeconds.toFixed(1)}s
      </div>
    </div>
  )
}
