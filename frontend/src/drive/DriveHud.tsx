import type { NormalizedControls } from '../input/useInputAdapter'
import { formatLapTime } from '../scene/trackGeometry'
import type { TrackProfile, VehicleStateMessage } from '../types/schemas'
import './DriveHud.css'

interface DriveHudProps {
  normalized: NormalizedControls
  vehicleState: VehicleStateMessage | null
  profile: TrackProfile | null
}

// F1-broadcast style cluster: speed in km/h, pedal bars either side, lap and
// timing above, sector strip and next corner below.
export function DriveHud({ normalized, vehicleState: v, profile }: DriveHudProps) {
  const kmh = Math.round((v?.speed ?? 0) * 3.6)
  const sectors = profile?.sectors ?? []
  const current = v?.sector_index ?? -1
  return (
    <div className="f1-hud" aria-label="Driver display">
      <div className="f1-hud__timing">
        <div>
          <span>Lap</span>
          <strong>{v?.lap ?? 1}</strong>
        </div>
        <div>
          <span>Time</span>
          <strong>{formatLapTime(v?.lap_time_s ?? 0)}</strong>
        </div>
        <div>
          <span>Last</span>
          <strong>{formatLapTime(v?.last_lap_s)}</strong>
        </div>
        <div className="f1-hud__best">
          <span>Best</span>
          <strong>{formatLapTime(v?.best_lap_s)}</strong>
        </div>
      </div>

      <div className="f1-hud__main">
        <div className="f1-hud__pedal" aria-label={`Brake ${Math.round(normalized.brake * 100)}%`}>
          <div className="f1-hud__pedal-fill f1-hud__pedal-fill--brake" style={{ height: `${normalized.brake * 100}%` }} />
          <span>BRK</span>
        </div>
        <div className="f1-hud__speed">
          <strong>{kmh}</strong>
          <span>km/h</span>
          <div className="f1-hud__steer" aria-label="Steering">
            <div className="f1-hud__steer-dot" style={{ left: `${50 + normalized.steering * 50}%` }} />
          </div>
        </div>
        <div className="f1-hud__pedal" aria-label={`Throttle ${Math.round(normalized.throttle * 100)}%`}>
          <div className="f1-hud__pedal-fill f1-hud__pedal-fill--throttle" style={{ height: `${normalized.throttle * 100}%` }} />
          <span>THR</span>
        </div>
      </div>

      <div className="f1-hud__sectors">
        {sectors.map((s) => (
          <div key={s.index} className={`f1-hud__sector ${s.index === current ? 'f1-hud__sector--on' : ''} ${s.index < current ? 'f1-hud__sector--done' : ''}`}>
            S{s.index + 1}
          </div>
        ))}
      </div>

      <div className="f1-hud__next">
        {v?.next_hazard_zone ? (
          <>
            Next: <strong>{v.next_hazard_zone}</strong> in {Math.round(v.next_hazard_distance ?? 0)} m
          </>
        ) : (
          '—'
        )}
        <span className="f1-hud__progress">{Math.round((v?.lap_progress ?? 0) * 100)}% lap</span>
      </div>
    </div>
  )
}
