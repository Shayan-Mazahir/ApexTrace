import type { FaultState, FaultStateMessage } from '../types/schemas'

export interface FaultEvent {
  distance: number
  effective: FaultState
  scenarioActive: boolean
}

export const MAX_FAULT_EVENTS = 50

export function appendFaultEvent(events: FaultEvent[], message: FaultStateMessage): FaultEvent[] {
  const next = [
    ...events,
    {
      distance: message.distance_along_lap,
      effective: message.effective,
      scenarioActive: message.scenario_active,
    },
  ]
  return next.length > MAX_FAULT_EVENTS ? next.slice(next.length - MAX_FAULT_EVENTS) : next
}

export function describeFaults(faults: FaultState): string {
  return `grip ${faults.grip_multiplier.toFixed(2)} · delay ${faults.telemetry_delay_ms.toFixed(
    0,
  )} ms · brake wear ${faults.brake_wear.toFixed(2)}`
}
