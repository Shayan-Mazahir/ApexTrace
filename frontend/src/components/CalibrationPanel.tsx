import type { RawInputSample } from '../input/InputAdapter'
import type { Calibration } from '../input/useCalibration'
import type { NormalizedControls } from '../input/useInputAdapter'
import './CalibrationPanel.css'

interface CalibrationPanelProps {
  source: string
  raw: RawInputSample
  normalized: NormalizedControls
  calibration: Calibration
  setCenter: () => void
  setDeadzone: (value: number) => void
}

export function CalibrationPanel({
  source,
  raw,
  normalized,
  calibration,
  setCenter,
  setDeadzone,
}: CalibrationPanelProps) {
  return (
    <div className="calibration-panel">
      <div className="calibration-panel__source">Input: {source}</div>

      <div className="calibration-panel__row">
        <span>Steering</span>
        <span>{raw.steeringRaw.toFixed(3)}</span>
        <span>→ {normalized.steering.toFixed(3)}</span>
      </div>
      <div className="calibration-panel__row">
        <span>Throttle</span>
        <span>{raw.throttleRaw.toFixed(3)}</span>
        <span>→ {normalized.throttle.toFixed(3)}</span>
      </div>
      <div className="calibration-panel__row">
        <span>Brake</span>
        <span>{raw.brakeRaw.toFixed(3)}</span>
        <span>→ {normalized.brake.toFixed(3)}</span>
      </div>

      {raw.resetPressed !== undefined && (
        <div className="calibration-panel__row">
          <span>Reset button</span>
          <span>{raw.resetPressed ? 'pressed' : '—'}</span>
          <span>→ resets to grid</span>
        </div>
      )}

      <div className="calibration-panel__row">
        <button type="button" onClick={setCenter}>
          Set steering center
        </button>
        <span>center: {calibration.center.toFixed(3)}</span>
      </div>

      <div className="calibration-panel__row">
        <label htmlFor="deadzone-slider">Deadzone {calibration.deadzone.toFixed(2)}</label>
        <input
          id="deadzone-slider"
          type="range"
          min={0}
          max={0.5}
          step={0.01}
          value={calibration.deadzone}
          onChange={(e) => setDeadzone(Number(e.target.value))}
        />
      </div>
    </div>
  )
}
