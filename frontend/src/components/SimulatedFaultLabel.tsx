import { StatusBadge } from './StatusBadge'

// Injected delay is a controlled test condition on the warning-data path, not
// a measurement of the real network — so it is always labelled as simulated.
export function SimulatedFaultLabel({ delayMs }: { delayMs: number }) {
  if (delayMs <= 0) return null
  return (
    <StatusBadge
      tone="warning"
      label={`Simulated connection fault · +${delayMs.toFixed(0)} ms injected`}
    />
  )
}
