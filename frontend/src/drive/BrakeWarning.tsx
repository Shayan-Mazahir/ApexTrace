import { useEffect, useRef } from 'react'
import './BrakeWarning.css'

interface BrakeWarningProps {
  reason: string | null
  hazardZone: string | null
}

// Reason/zone come straight from the backend's warning_reason /
// next_hazard_zone fields — still Person A's demo-only placeholder
// trigger (not the real grip/braking-distance warning system), but now
// server-computed rather than guessed on the frontend.
export function BrakeWarning({ reason, hazardZone }: BrakeWarningProps) {
  const startedAtRef = useRef<number | null>(null)

  useEffect(() => {
    if (reason && startedAtRef.current === null) {
      startedAtRef.current = Date.now()
    } else if (!reason) {
      startedAtRef.current = null
    }
  }, [reason])

  if (!reason) return null

  const ageSeconds = startedAtRef.current ? (Date.now() - startedAtRef.current) / 1000 : 0

  return (
    <div className="brake-warning" role="alert">
      <div className="brake-warning__label">BRAKE</div>
      <div className="brake-warning__reason">{reason}</div>
      <div className="brake-warning__meta">
        {hazardZone ? `${hazardZone} · ` : ''}
        {ageSeconds.toFixed(1)}s
      </div>
    </div>
  )
}
