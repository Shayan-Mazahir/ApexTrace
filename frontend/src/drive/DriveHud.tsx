import { useEffect, useMemo } from 'react'
import type { NormalizedControls } from '../input/useInputAdapter'
import { formatLapTime } from '../scene/trackGeometry'
import type { TrackProfile, VehicleStateMessage } from '../types/schemas'
import { LapDeltaTracker } from './lapDelta'
import './DriveHud.css'

interface DriveHudProps {
  normalized: NormalizedControls
  vehicleState: VehicleStateMessage | null
  profile: TrackProfile | null
  sessionId: string | null
}

// Rev lights: 15 LEDs from RPM_START to the shift point, then blue flash.
const LEDS = 15
const RPM_START = 8_000
const RPM_SHIFT = 12_000
const ERS_LABEL = { harvest: 'HARVEST', balanced: 'BALANCED', overtake: 'OVERTAKE' } as const
const TC_LABEL = { off: 'OFF', medium: 'MED', full: 'FULL' } as const

function gearLabel(gear: number | undefined): string {
  if (gear === -1) return 'R'
  if (!gear) return 'N'
  return String(gear)
}

function formatDelta(delta: number | null): string {
  if (delta == null) return '—'
  const sign = delta < 0 ? '−' : '+'
  return `${sign}${Math.abs(delta).toFixed(3)}`
}

// Steering-wheel display in the style of an F1 dash: shift lights, gear and
// speed in the middle, timing either side, car systems along the bottom.
export function DriveHud({ normalized, vehicleState: v, profile, sessionId }: DriveHudProps) {
  const kmh = Math.round(Math.abs(v?.speed ?? 0) * 3.6)
  const sectors = profile?.sectors ?? []
  const current = v?.sector_index ?? -1
  const rpm = v?.rpm ?? 0
  const lit = Math.max(0, Math.min(LEDS, Math.round(((rpm - RPM_START) / (RPM_SHIFT - RPM_START)) * LEDS)))
  const shiftNow = rpm >= RPM_SHIFT * 0.985 && (v?.gear ?? 0) > 0 && (v?.gear ?? 0) < 8
  const setup = v?.setup

  const tracker = useMemo(() => new LapDeltaTracker(), [])
  useEffect(() => tracker.reset(), [sessionId, tracker])
  const length = profile?.total_length ?? 1
  const intoLap = v ? v.distance_along_lap - (v.lap - 1) * length : 0
  // idempotent per sample (distance must advance), so a repeated render is harmless
  if (v) tracker.update(v.lap, intoLap, v.lap_time_s, v.last_lap_s, v.last_lap_valid)
  const delta = v ? tracker.delta(intoLap, v.lap_time_s) : null
  const lapValid = v?.lap_valid ?? true
  const battery = Math.max(0, Math.min(100, v?.battery_pct ?? 100))
  const deploy = v?.ers_deploy_kw ?? 0

  const throttle = Math.round(normalized.throttle * 100)
  const brake = Math.round(normalized.brake * 100)
  const rpmFrac = Math.max(0, Math.min(1, (rpm - 4_000) / (RPM_SHIFT - 4_000)))

  return (
    <div className="f1-hud" aria-label="Driver display">
      <div className="f1-timing">
        <div className="f1-timing__head">
          <b>LAP {v?.lap ?? 1}</b>
          {!lapValid && <em className="f1-hud__flag">INVALID</em>}
        </div>
        <div className="f1-timing__row">
          <span>Time</span>
          <strong className={lapValid ? '' : 'f1-hud__invalid'}>{formatLapTime(v?.lap_time_s ?? 0)}</strong>
        </div>
        <div className="f1-timing__row">
          <span>Delta</span>
          <strong className={delta == null ? '' : delta < 0 ? 'f1-hud__ahead' : 'f1-hud__behind'}>{formatDelta(delta)}</strong>
        </div>
        <div className="f1-timing__row">
          <span>Last</span>
          <strong className={v?.last_lap_valid === false ? 'f1-hud__invalid' : ''}>{formatLapTime(v?.last_lap_s)}</strong>
        </div>
      </div>

      <div className="f1-best">
        <span>BEST</span>
        <strong>{formatLapTime(v?.session_best_lap_s ?? v?.best_lap_s)}</strong>
      </div>

      <div className="f1-dash">
        <div className="f1-dash__pedal" title="Brake">
          <div className="f1-dash__pedal-fill f1-dash__pedal-fill--brake" style={{ height: `${brake}%` }} />
        </div>
        <div className="f1-dash__core">
          <div className={`f1-dash__rev ${shiftNow ? 'f1-dash__rev--shift' : ''}`} aria-label={`${Math.round(rpm)} rpm`}>
            <div className="f1-dash__rev-fill" style={{ width: `${rpmFrac * 100}%` }} />
            {Array.from({ length: LEDS }, (_, i) => (
              <span key={i} className={`f1-dash__tick ${i < lit ? 'on' : ''} f1-dash__tick--${i < 5 ? 'g' : i < 10 ? 'r' : 'b'}`} />
            ))}
          </div>
          <div className="f1-dash__lapline">
            <b>LAP {v?.lap ?? 1}</b>
            <span>{formatLapTime(v?.lap_time_s ?? 0)}</span>
            {(v?.laps_completed ?? 0) > 0 && <span>{v?.laps_completed} done</span>}
          </div>
          <div className="f1-dash__main">
            <div className="f1-dash__side">
              <div className={`f1-dash__battery ${battery < 15 ? 'low' : ''}`} title="Battery state of charge">
                <b>{Math.round(battery)}%</b>
                <span>{setup ? ERS_LABEL[setup.ers_mode] : 'ERS'} {deploy > 5 ? '▲' : deploy < -5 ? '▼' : ''}</span>
              </div>
            </div>
            <div className="f1-dash__gear" aria-label="Gear">{gearLabel(v?.gear)}</div>
            <div className="f1-dash__side f1-dash__side--right">
              <div className="f1-dash__speed">
                <strong>{kmh}</strong>
                <span>km/h</span>
              </div>
            </div>
          </div>
          <div className="f1-dash__chips">
            <span className={`f1-dash__chip ${v?.drs_open ? 'is-drs' : v?.drs_available ? 'is-avail' : ''}`}>
              {v?.drs_open ? 'X-MODE' : 'Z-MODE'}
            </span>
            <span className={`f1-dash__chip ${v?.tc_active ? 'is-act' : ''} ${v?.wheelspin ? 'is-warn' : ''}`}>
              TC {setup ? TC_LABEL[setup.traction_control] : ''}{v?.wheelspin ? ' · SPIN' : ''}
            </span>
            <span className={`f1-dash__chip ${v?.lockup ? 'is-warn' : ''}`}>ABS {setup?.abs === false ? 'OFF' : 'ON'}{v?.lockup ? ' · LOCK' : ''}</span>
            <span className="f1-dash__chip">{setup?.gearbox === 'manual' ? 'MANUAL' : 'AUTO'}</span>
            <span className="f1-dash__chip f1-dash__chip--rpm">{Math.round(rpm).toLocaleString('en-US')} rpm</span>
          </div>
          <div className="f1-dash__footer">
            <div className="f1-hud__sectors">
              {sectors.map((s) => (
                <div key={s.index} className={`f1-hud__sector ${s.index === current ? 'f1-hud__sector--on' : ''} ${s.index < current ? 'f1-hud__sector--done' : ''}`}>
                  S{s.index + 1}
                </div>
              ))}
            </div>
            <div className="f1-hud__next">
              {v?.next_hazard_zone ? (
                <>Next <strong>{v.next_hazard_zone}</strong> {Math.round(v.next_hazard_distance ?? 0)} m</>
              ) : (
                'Next —'
              )}
            </div>
          </div>
        </div>
        <div className="f1-dash__pedal" title="Throttle">
          <div className="f1-dash__pedal-fill f1-dash__pedal-fill--throttle" style={{ height: `${throttle}%` }} />
        </div>
      </div>

      <span className="f1-hud__sr-only">
        Throttle {Math.round(normalized.throttle * 100)}%, brake {Math.round(normalized.brake * 100)}%
      </span>
    </div>
  )
}
