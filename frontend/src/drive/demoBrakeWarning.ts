import type { TrackProfile, VehicleStateMessage } from '../types/schemas'

const WARNING_DISTANCE = 30 // meters, arbitrary demo threshold

// Placeholder trigger, not the real warning system: Person A's baseline
// warning (estimated corner speed vs. braking distance, tasks 39-44) will
// eventually broadcast real WarningEvents (task 114) for the frontend to
// render instead of computing this itself.
export function computeDemoBrakeWarning(
  vehicleState: VehicleStateMessage | null,
  trackProfile: TrackProfile | null,
): boolean {
  if (!vehicleState || !trackProfile) return false
  if (vehicleState.completed || vehicleState.track_exit) return false
  const distanceToCorner = trackProfile.approach_length - vehicleState.x
  return distanceToCorner > 0 && distanceToCorner < WARNING_DISTANCE
}
