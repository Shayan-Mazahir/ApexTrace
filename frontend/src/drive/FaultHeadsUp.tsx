import type { FaultSummary, TrackProfile } from '../types/schemas'
import './FaultHeadsUp.css'

const WARN_AHEAD_M = 500

const PLAIN: Record<string, string> = {
  grip_loss: 'Slippery road',
  brake_fade: 'Brake fade',
  brake_actuation_delay: 'Slow brakes',
  brake_saturation: 'Weak brakes',
  steering_delay: 'Slow steering',
  steering_limit: 'Limited steering',
  grip_estimate_lag: 'Grip estimate lagging',
  grip_estimate_bias: 'Grip estimate wrong',
  speed_bias: 'Speed sensor wrong',
  speed_noise: 'Speed sensor noisy',
  sensor_freeze: 'Sensor frozen',
  position_offset: 'Position sensor off',
  sample_rate: 'Sensor slow',
  uplink_delay: 'Telemetry delayed',
  uplink_loss: 'Telemetry packets lost',
  uplink_blackout: 'Telemetry blackout',
  warning_compute_delay: 'Warning computed late',
  downlink_delay: 'Warning delivered late',
  downlink_loss: 'Warnings dropped',
  driver_reaction_delay: 'Slow driver reaction',
  driver_weak_braking: 'Weak driver braking',
  driver_ignore_warning: 'Driver ignores a warning',
}

export function upcomingFaults(faults: FaultSummary[], totalLength: number, distanceAlongLap: number, within = WARN_AHEAD_M) {
  const lap = distanceAlongLap % totalLength
  return faults
    .filter((f) => (f.state === 'pending' || f.state === 'waiting') && f.starts_at_m != null)
    .map((f) => ({ f, ahead: ((f.starts_at_m as number) - lap + totalLength) % totalLength }))
    .filter((x) => x.ahead <= within)
    .sort((a, b) => a.ahead - b.ahead)
}

// Test-operator view of the armed scenario: what is on now and what switches
// on shortly. The car's warning system does NOT get this information.
export function FaultHeadsUp({ faults, profile, distanceAlongLap }: { faults: FaultSummary[]; profile: TrackProfile | null; distanceAlongLap: number }) {
  if (!profile || faults.length === 0) return null
  const active = faults.filter((f) => f.state === 'active')
  const soon = upcomingFaults(faults, profile.total_length, distanceAlongLap)
  if (active.length === 0 && soon.length === 0) return null
  return (
    <div className="fault-headsup" aria-live="polite">
      <span className="fault-headsup__tag">Test info</span>
      {soon.map(({ f, ahead }) => (
        <span key={f.id} className="fault-headsup__item fault-headsup__item--soon">
          {PLAIN[f.type] ?? f.type} in <b>{Math.round(ahead)} m</b>
        </span>
      ))}
      {active.map((f) => (
        <span key={f.id} className="fault-headsup__item fault-headsup__item--on">
          {PLAIN[f.type] ?? f.type} <b>ON</b>
        </span>
      ))}
    </div>
  )
}
