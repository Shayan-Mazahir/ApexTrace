import { StatusBadge } from '../components/StatusBadge'
import type { VehicleStateMessage } from '../types/schemas'
import './RunStateBanner.css'

export function RunStateBanner({ vehicleState }: { vehicleState: VehicleStateMessage | null }) {
  if (!vehicleState) return null

  if (vehicleState.track_exit) {
    return (
      <div className="run-state-banner">
        <StatusBadge label="Track exit" tone="danger" />
      </div>
    )
  }

  if (vehicleState.completed) {
    return (
      <div className="run-state-banner">
        <StatusBadge label="Run complete" tone="success" />
      </div>
    )
  }

  return null
}
