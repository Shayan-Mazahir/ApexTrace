import type { NormalizedControls } from '../input/useInputAdapter'
import type { VehicleStateMessage } from '../types/schemas'
import './DriveHud.css'

interface DriveHudProps {
  normalized: NormalizedControls
  vehicleState: VehicleStateMessage | null
}

export function DriveHud({ normalized, vehicleState }: DriveHudProps) {
  return (
    <div className="drive-hud">
      <div className="drive-hud__speed">{(vehicleState?.speed ?? 0).toFixed(1)} m/s</div>

      <div className="drive-hud__row">
        <span>Lap</span>
        <span>{((vehicleState?.lap_progress ?? 0) * 100).toFixed(0)}%</span>
      </div>
      <div className="drive-hud__row">
        <span>Sector</span>
        <span>{vehicleState?.sector_name ?? '—'}</span>
      </div>
      <div className="drive-hud__row">
        <span>Next hazard</span>
        <span>
          {vehicleState?.next_hazard_distance != null
            ? `${vehicleState.next_hazard_distance.toFixed(0)}m`
            : '—'}
        </span>
      </div>

      <div className="drive-hud__row">
        <span>Steer</span>
        <Bar value={(normalized.steering + 1) / 2} />
      </div>
      <div className="drive-hud__row">
        <span>Throttle</span>
        <Bar value={normalized.throttle} />
      </div>
      <div className="drive-hud__row">
        <span>Brake</span>
        <Bar value={normalized.brake} />
      </div>
    </div>
  )
}

function Bar({ value }: { value: number }) {
  return (
    <div className="drive-hud__bar">
      <div className="drive-hud__bar-fill" style={{ width: `${Math.round(value * 100)}%` }} />
    </div>
  )
}
