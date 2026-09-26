import { Canvas } from '@react-three/fiber'
import { useEffect, useRef, useState } from 'react'
import { getTrack } from '../api/session'
import { useDemo } from '../app/DemoContext'
import { CalibrationPanel } from '../components/CalibrationPanel'
import { SimulatedFaultLabel } from '../components/SimulatedFaultLabel'
import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { BrakeWarning } from '../drive/BrakeWarning'
import { DriveHud } from '../drive/DriveHud'
import { Minimap } from '../drive/Minimap'
import { RunStateBanner } from '../drive/RunStateBanner'
import { TrackPicker } from '../drive/TrackPicker'
import { useDriveSession } from '../drive/useDriveSession'
import { useInputAdapter } from '../input/useInputAdapter'
import { Scene, type SceneView } from '../scene/Scene'
import { UPGRADE_IDS, type TrackId, type TrackProfile, type UpgradeConfig } from '../types/schemas'
import { useGarage } from '../app/GarageContext'
import './DriveScreen.css'

function carLabel(upgrades: UpgradeConfig): string {
  const names = { brake_servicing: 'serviced brakes', comms_improvement: 'improved comms', local_fallback: 'local fallback' }
  const on = UPGRADE_IDS.filter((id) => upgrades[id]).map((id) => names[id])
  return on.length ? on.join(' + ') : 'baseline (worn brakes)'
}

export function DriveScreen() {
  const input = useInputAdapter()
  const session = useDriveSession(input.normalized)
  const demo = useDemo()
  const { selection } = useGarage()
  const { start, connectionState } = session

  const [profiles, setProfiles] = useState<Partial<Record<TrackId, TrackProfile>>>({})
  const [viewOverride, setViewOverride] = useState<SceneView | null>(null)
  const [showControls, setShowControls] = useState(false)
  const steeringRef = useRef(0)
  steeringRef.current = input.normalized.steering

  useEffect(() => {
    let cancelled = false
    for (const id of ['monza', 'baku'] as TrackId[]) {
      getTrack(id)
        .then((p) => !cancelled && setProfiles((prev) => ({ ...prev, [id]: p })))
        .catch(() => undefined)
    }
    return () => {
      cancelled = true
    }
  }, [])

  const profile = session.trackProfile ?? profiles[session.selectedTrack] ?? null
  const inSession = session.sessionId !== null
  const view: SceneView = viewOverride ?? (inSession ? 'follow' : 'overview')

  // The wheel's reset button does what "Reset to grid" does. Kept in a ref so
  // the effect runs on a new press only, not whenever `reset` is re-created.
  const resetRef = useRef(session.reset)
  resetRef.current = session.reset
  useEffect(() => {
    if (input.resetRequests > 0) resetRef.current()
  }, [input.resetRequests])

  useEffect(() => {
    if (demo.active && demo.step.id === 'drive' && connectionState === 'idle') void start()
  }, [demo.active, demo.step.id, connectionState, start])

  const info = session.sessionInfo
  const engineer: { label: string; tone: StatusTone } | null = !info
    ? null
    : info.engineer_connected
      ? { label: 'Engineer connected', tone: 'success' }
      : info.engineer_ever_connected
        ? { label: 'Engineer disconnected', tone: 'danger' }
        : null
  const v = session.vehicleState

  return (
    <div className="drive-screen" data-connection={connectionState}>
      <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 8000 }} dpr={[1, 2]}>
        <Scene
          view={view}
          trackProfile={profile}
          vehicleState={v ? { x: v.x, y: v.y, heading: v.heading, speed: v.speed } : null}
          trail={session.trail}
          previousLapTrail={session.previousLapTrail}
          steering={steeringRef}
        />
      </Canvas>

      {!inSession && (
        <TrackPicker
          profiles={profiles}
          value={session.selectedTrack}
          onChange={session.selectTrack}
          onStart={session.start}
          starting={connectionState === 'connecting'}
          carLabel={carLabel(selection)}
        />
      )}

      {inSession && (
        <>
          <div className="drive-screen__brand">
            <strong>{profile?.name}</strong>
            <span>
              Engineer code <code>{session.sessionId}</code>
            </span>
          </div>

          <div className="drive-screen__chips">
            {connectionState === 'reconnecting' && <StatusBadge label="Reconnecting…" tone="warning" />}
            {engineer && <StatusBadge label={engineer.label} tone={engineer.tone} />}
            <SimulatedFaultLabel delayMs={v?.injected_delay_ms ?? 0} />
            {v?.local_fallback_active && <StatusBadge tone="info" label="Local warning fallback active" />}
            {info && <StatusBadge tone="neutral" label={`Car: ${carLabel(info.upgrades)}`} />}
          </div>

          {profile && (
            <div className="drive-screen__minimap">
              <Minimap profile={profile} car={v ? { x: v.x, y: v.y } : null} />
            </div>
          )}

          <BrakeWarning warning={session.warning} />
          <RunStateBanner vehicleState={v} />
          <DriveHud normalized={input.normalized} vehicleState={v} profile={profile} />

          <div className="drive-screen__dock">
            <button type="button" onClick={session.togglePause} disabled={connectionState !== 'connected'}>
              {session.running ? 'Pause' : 'Resume'}
            </button>
            <button type="button" onClick={session.reset} disabled={connectionState !== 'connected'}>
              Reset to grid
            </button>
            <button type="button" onClick={() => setViewOverride(view === 'follow' ? 'overview' : 'follow')}>
              {view === 'follow' ? 'Overview' : 'Chase cam'}
            </button>
            <button type="button" onClick={() => setShowControls((s) => !s)} aria-pressed={showControls}>
              Controls
            </button>
            <button type="button" className="drive-screen__end" onClick={session.endSession}>
              End session
            </button>
          </div>
        </>
      )}

      {showControls && (
        <CalibrationPanel
          source={input.source}
          raw={input.raw}
          normalized={input.normalized}
          calibration={input.calibration}
          setCenter={input.setCenter}
          setDeadzone={input.setDeadzone}
        />
      )}
    </div>
  )
}
