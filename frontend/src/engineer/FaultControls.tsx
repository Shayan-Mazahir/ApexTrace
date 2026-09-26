import { FAULT_LIMITS, NO_FAULTS, type FaultState } from '../types/schemas'
import { describeFaults } from '../stream/faultTimeline'
import './FaultControls.css'

interface SliderSpec {
  key: keyof FaultState
  label: string
  step: number
  format: (value: number) => string
}

const SLIDERS: SliderSpec[] = [
  { key: 'grip_multiplier', label: 'Grip loss (friction multiplier)', step: 0.01, format: (v) => v.toFixed(2) },
  { key: 'telemetry_delay_ms', label: 'Telemetry delay (simulated)', step: 10, format: (v) => `${v.toFixed(0)} ms` },
  { key: 'brake_wear', label: 'Brake degradation (wear factor)', step: 0.01, format: (v) => v.toFixed(2) },
]

interface FaultControlsProps {
  value: FaultState
  applied: FaultState | null
  disabled: boolean
  onChange: (value: FaultState) => void
  onApply: (value: FaultState) => void
}

export function FaultControls({ value, applied, disabled, onChange, onApply }: FaultControlsProps) {
  return (
    <div className="fault-controls">
      {SLIDERS.map(({ key, label, step, format }) => (
        <label key={key} className="fault-controls__row">
          <span className="fault-controls__label">
            {label} <strong>{format(value[key])}</strong>
          </span>
          <input
            type="range"
            min={FAULT_LIMITS[key].min}
            max={FAULT_LIMITS[key].max}
            step={step}
            value={value[key]}
            disabled={disabled}
            onChange={(e) => onChange({ ...value, [key]: Number(e.target.value) })}
          />
        </label>
      ))}
      <div className="fault-controls__actions">
        <button type="button" disabled={disabled} onClick={() => onApply(value)}>
          Apply faults
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => {
            onChange(NO_FAULTS)
            onApply(NO_FAULTS)
          }}
        >
          Clear faults
        </button>
      </div>
      <div className="fault-controls__applied">
        Applied: {applied ? describeFaults(applied) : '—'}
      </div>
    </div>
  )
}
