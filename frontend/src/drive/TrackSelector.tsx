import type { TrackId } from '../types/schemas'
import './TrackSelector.css'

const OPTIONS: { id: TrackId; label: string }[] = [
  { id: 'monza', label: 'Monza/T1' },
  { id: 'baku', label: 'Baku' },
]

interface TrackSelectorProps {
  value: TrackId
  onChange: (track: TrackId) => void
  disabled?: boolean
}

export function TrackSelector({ value, onChange, disabled }: TrackSelectorProps) {
  return (
    <div className="track-selector">
      {OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          disabled={disabled}
          className={`track-selector__button ${
            value === option.id ? 'track-selector__button--active' : ''
          }`}
          onClick={() => onChange(option.id)}
        >
          {option.label}
        </button>
      ))}
    </div>
  )
}
