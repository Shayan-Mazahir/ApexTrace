import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import type { FaultLifecycle, FaultSummary } from '../types/schemas'
import './ActiveFaults.css'

const TONE: Record<FaultLifecycle, StatusTone> = {
  pending: 'neutral',
  active: 'danger',
  waiting: 'info',
  completed: 'success',
  cancelled: 'neutral',
}

interface ActiveFaultsProps {
  faults: FaultSummary[]
  disabled: boolean
  onCancel: (id: string) => void
}

export function ActiveFaults({ faults, disabled, onCancel }: ActiveFaultsProps) {
  if (faults.length === 0) return <p className="active-faults__empty">No faults armed.</p>
  return (
    <ul className="active-faults">
      {faults.map((f) => (
        <li key={f.id} className={`active-faults__row active-faults__row--${f.state}`}>
          <div className="active-faults__head">
            <StatusBadge tone={TONE[f.state]} label={f.state} />
            <code>{f.id}</code>
            <span className="active-faults__meta">
              {f.target} · {f.source}
            </span>
            {f.state !== 'completed' && f.state !== 'cancelled' && (
              <button type="button" disabled={disabled} onClick={() => onCancel(f.id)}>
                Cancel
              </button>
            )}
          </div>
          <div className="active-faults__desc">{f.description}</div>
          {f.state === 'active' && (
            <div className="active-faults__level">
              <div style={{ width: `${Math.round(f.level * 100)}%` }} />
              <span>
                level {Math.round(f.level * 100)}%{f.remaining_m !== null ? ` · ${f.remaining_m.toFixed(0)} m left in zone` : ''}
              </span>
            </div>
          )}
        </li>
      ))}
    </ul>
  )
}
