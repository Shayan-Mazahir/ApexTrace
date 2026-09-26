import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import { getTrack } from '../api/session'
import { useDemo } from '../app/DemoContext'
import { CalibrationPanel } from '../components/CalibrationPanel'
import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { BrakeWarning } from '../drive/BrakeWarning'
import { DriveHud } from '../drive/DriveHud'
import { RunStateBanner } from '../drive/RunStateBanner'
import { TrackSelector } from '../drive/TrackSelector'
import { useDriveSession, type ConnectionState } from '../drive/useDriveSession'
import { SimulatedFaultLabel } from '../components/SimulatedFaultLabel'
import { useInputAdapter } from '../input/useInputAdapter'
import { Scene, type SceneView } from '../scene/Scene'
import { UPGRADE_IDS, type TrackProfile, type UpgradeConfig } from '../types/schemas'
import './DriveScreen.css'

const CONNECTION_LABEL: Record<ConnectionState, string> = {
  idle: 'Session idle',
  connecting: 'Connecting…',
  connected: 'Session connected',
  reconnecting: 'Reconnecting…',
  closed: 'Session ended',
}

const CONNECTION_TONE: Record<ConnectionState, StatusTone> = {
  idle: 'neutral',
  connecting: 'neutral',
  connected: 'success',
  reconnecting: 'warning',
  closed: 'danger',
}

function carLabel(upgrades: UpgradeConfig): string {
  const names = { brake_servicing: 'serviced brakes', comms_improvement: 'improved comms', local_fallback: 'local fallback' }
  const on = UPGRADE_IDS.filter((id) => upgrades[id]).map((id) => names[id])
  return on.length ? on.join(' + ') : 'baseline (worn brakes)'
}

export function DriveScreen() {
  const input = useInputAdapter()
  const session = useDriveSession(input.normalized)
  const demo = useDemo()
  const { start, connectionState } = session

  // Show the selected lap before Start, so the track is never a blank screen.
  const [previewProfile, setPreviewProfile] = useState<TrackProfile | null>(null)
  const [viewOverride, setViewOverride] = useState<SceneView | null>(null)
  const selectedTrack = session.selectedTrack
  const hasSessionProfile = session.trackProfile !== null
  useEffect(() => {
    if (hasSessionProfile) return
    let cancelled = false
    getTrack(selectedTrack)
      .then((p) => !cancelled && setPreviewProfile(p))
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [selectedTrack, hasSessionProfile])
  const profile = session.trackProfile ?? previewProfile
  const view: SceneView = viewOverride ?? (session.sessionId && session.vehicleState ? 'follow' : 'overview')

  useEffect(() => {
    if (demo.active && demo.step.id === 'drive' && connectionState === 'idle') void start()
  }, [demo.active, demo.step.id, connectionState, start])

  const info = session.sessionInfo
  const engineerLabel = info?.engineer_connected
    ? 'Engineer station connected'
    : info?.engineer_ever_connected
      ? 'Engineer station disconnected'
      : 'No engineer station'
  const engineerTone: StatusTone = info?.engineer_connected
    ? 'success'
    : info?.engineer_ever_connected
      ? 'danger'
      : 'neutral'

  return (
    <div className="drive-screen">
      <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 6000 }}>
        <Scene
          view={view}
          trackProfile={profile}
          vehicleState={session.vehicleState}
          trail={session.trail}
          previousLapTrail={session.previousLapTrail}
        />
      </Canvas>

      <BrakeWarning warning={session.warning} />
      <RunStateBanner vehicleState={session.vehicleState} />

      <div className="drive-screen__top">
      <div className="drive-screen__top-controls">
        <TrackSelector
          value={session.selectedTrack}
          onChange={session.selectTrack}
          disabled={session.sessionId !== null && session.connectionState !== 'closed'}
        />
        <StatusBadge
          label={CONNECTION_LABEL[session.connectionState]}
          tone={CONNECTION_TONE[session.connectionState]}
        />
        <StatusBadge label={engineerLabel} tone={engineerTone} />
        <SimulatedFaultLabel delayMs={session.vehicleState?.injected_delay_ms ?? 0} />
        {session.sessionInfo && (
          <StatusBadge tone="neutral" label={`Car: ${carLabel(session.sessionInfo.upgrades)}`} />
        )}
        {session.vehicleState?.local_fallback_active && (
          <StatusBadge tone="info" label="Local warning fallback active" />
        )}
      </div>
      {session.sessionId && (
        <div className="drive-screen__session-id">
          Session ID <strong>{session.sessionId}</strong> · Run {session.sessionInfo?.run_id ?? '—'}
        </div>
      )}
      </div>

      <div className="drive-screen__run-controls">
        <button
          type="button"
          onClick={session.start}
          disabled={session.connectionState !== 'idle' && session.connectionState !== 'closed'}
        >
          Start
        </button>
        <button
          type="button"
          onClick={session.togglePause}
          disabled={session.connectionState !== 'connected'}
        >
          {session.running ? 'Pause' : 'Resume'}
        </button>
        <button type="button" onClick={session.reset} disabled={session.connectionState !== 'connected'}>
          Reset
        </button>
        <button type="button" onClick={session.endSession} disabled={session.sessionId === null}>
          End session
        </button>
        <button type="button" onClick={() => setViewOverride(view === 'follow' ? 'overview' : 'follow')}>
          View: {view === 'follow' ? 'Chase' : 'Overview'}
        </button>
      </div>

      <DriveHud normalized={input.normalized} vehicleState={session.vehicleState} />
      <CalibrationPanel
        source={input.source}
        raw={input.raw}
        normalized={input.normalized}
        calibration={input.calibration}
        setCenter={input.setCenter}
        setDeadzone={input.setDeadzone}
      />
    </div>
  )
}
