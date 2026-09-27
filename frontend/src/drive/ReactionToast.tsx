import { useEffect, useState } from 'react'
import { ASSUMED_REACTION_S, type WarningResponse } from './driverReport'
import './ReactionToast.css'

const SHOW_MS = 2600

// After each BRAKE warning, how the driver responded: their reaction time,
// coloured against what the stress suite assumes a driver manages.
export function ReactionToast({ latest }: { latest: WarningResponse | undefined }) {
  const [shown, setShown] = useState<WarningResponse | null>(null)
  useEffect(() => {
    if (!latest) return
    setShown(latest)
    const t = setTimeout(() => setShown(null), SHOW_MS)
    return () => clearTimeout(t)
  }, [latest])
  if (!shown) return null

  const [, slow] = ASSUMED_REACTION_S
  let tone: 'good' | 'ok' | 'bad'
  let value: string
  let note: string
  if (shown.outcome === 'anticipated') {
    tone = 'good'
    value = 'Early'
    note = 'already braking'
  } else if (shown.outcome === 'ignored') {
    tone = 'bad'
    value = 'Ignored'
    note = `no brake for ${shown.hazard}`
  } else {
    const s = shown.reactionS as number
    tone = s <= slow ? 'good' : s <= 0.7 ? 'ok' : 'bad'
    value = `${s.toFixed(2)} s`
    note = s <= slow ? 'within the suite’s assumption' : `+${((s - slow) * (shown.speedKmh / 3.6)).toFixed(0)} m before braking`
  }
  return (
    <div key={shown.shownAt} className={`reaction-toast reaction-toast--${tone}`} role="status">
      <span className="reaction-toast__label">Reaction</span>
      <strong>{value}</strong>
      <span className="reaction-toast__note">{note}</span>
    </div>
  )
}
