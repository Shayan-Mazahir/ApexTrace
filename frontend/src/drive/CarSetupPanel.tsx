import type { CarSetupConfig } from '../types/schemas'
import './CarSetupPanel.css'

interface Option<T> {
  value: T
  label: string
}

interface Row<K extends keyof CarSetupConfig> {
  key: K
  label: string
  hint: string
  options: Option<CarSetupConfig[K]>[]
}

const ROWS = [
  {
    key: 'traction_control',
    label: 'Traction control',
    hint: 'Limits wheelspin under power. Off lets the rear step out.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'medium', label: 'Medium' },
      { value: 'full', label: 'Full' },
    ],
  },
  {
    key: 'abs',
    label: 'ABS',
    hint: 'Real F1 cars have none: without it, too much brake locks the tyres.',
    options: [
      { value: false, label: 'Off' },
      { value: true, label: 'On' },
    ],
  },
  {
    key: 'gearbox',
    label: 'Transmission',
    hint: 'Manual: E / RB up, Q / LB down. Downshifts that would over-rev are refused.',
    options: [
      { value: 'automatic', label: 'Automatic' },
      { value: 'manual', label: 'Manual' },
    ],
  },
  {
    key: 'drs_mode',
    label: 'DRS / active aero',
    hint: 'X-mode opens the wings on straights for top speed; braking closes them. Manual: F / A.',
    options: [
      { value: 'off', label: 'Off' },
      { value: 'auto', label: 'Auto' },
      { value: 'manual', label: 'Manual' },
    ],
  },
  {
    key: 'ers_mode',
    label: 'Battery power',
    hint: '350 kW MGU-K. Harvest recharges, Overtake keeps full power to 337 km/h. Cycle: B / Y.',
    options: [
      { value: 'harvest', label: 'Harvest' },
      { value: 'balanced', label: 'Balanced' },
      { value: 'overtake', label: 'Overtake' },
    ],
  },
] as const satisfies readonly Row<keyof CarSetupConfig>[]

interface CarSetupPanelProps {
  setup: CarSetupConfig
  onChange: (next: CarSetupConfig) => void
  onClose?: () => void
}

// Assists and modes for the 2026 car. Changes apply immediately, also mid-run.
export function CarSetupPanel({ setup, onChange, onClose }: CarSetupPanelProps) {
  return (
    <section className="car-setup" aria-label="Car setup">
      <header className="car-setup__header">
        <h2>Car setup</h2>
        {onClose && (
          <button type="button" onClick={onClose} aria-label="Close car setup">
            ✕
          </button>
        )}
      </header>
      {ROWS.map((row) => (
        <div className="car-setup__row" key={row.key}>
          <div className="car-setup__label">
            <span>{row.label}</span>
            <small>{row.hint}</small>
          </div>
          <div className="car-setup__options" role="radiogroup" aria-label={row.label}>
            {row.options.map((o) => (
              <button
                key={String(o.value)}
                type="button"
                role="radio"
                aria-checked={setup[row.key] === o.value}
                className={setup[row.key] === o.value ? 'on' : ''}
                onClick={() => onChange({ ...setup, [row.key]: o.value })}
              >
                {o.label}
              </button>
            ))}
          </div>
        </div>
      ))}
      <p className="car-setup__keys">
        Keys: W/S throttle-brake · A/D steer · E/Q shift · F DRS · R reverse · B battery mode
      </p>
    </section>
  )
}
