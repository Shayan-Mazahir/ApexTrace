import type { NormalizedControls } from '../input/useInputAdapter'
import './DriveHud.css'

interface DriveHudProps {
  normalized: NormalizedControls
  speed: number
}

export function DriveHud({ normalized, speed }: DriveHudProps) {
  return (
    <div className="drive-hud">
      <div className="drive-hud__speed">{speed.toFixed(1)} m/s</div>
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
