import { Canvas } from '@react-three/fiber'
import { PerformanceMonitor } from '@react-three/drei'
import { useEffect, useRef, useState } from 'react'
import { getTrack } from '../api/session'
import { useDemo } from '../app/DemoContext'
import { CalibrationPanel } from '../components/CalibrationPanel'
import { SimulatedFaultLabel } from '../components/SimulatedFaultLabel'
import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { BrakeWarning } from '../drive/BrakeWarning'
import { CarSetupPanel } from '../drive/CarSetupPanel'
import { DriveHud } from '../drive/DriveHud'
import { FaultHeadsUp } from '../drive/FaultHeadsUp'
import { RunStateBanner } from '../drive/RunStateBanner'
import { TelemetryPanel } from '../drive/TelemetryPanel'
import { TrackPicker } from '../drive/TrackPicker'
import { useDriveSession } from '../drive/useDriveSession'
import { useInputAdapter, type GameState } from '../input/useInputAdapter'
import { Scene, type SceneView } from '../scene/Scene'
import { UPGRADE_IDS, type TrackId, type TrackProfile, type UpgradeConfig } from '../types/schemas'
import { useGarage } from '../app/GarageContext'
import './DriveScreen.css'

function carLabel(upgrades: UpgradeConfig): string {
  const names = { brake_servicing: 'serviced brakes', comms_improvement: 'improved comms', local_fallback: 'local fallback' }
  const on = UPGRADE_IDS.filter((id) => upgrades[id]).map((id) => names[id])
  return on.length ? on.join(' + ') : 'none'
}

// The view button cycles cockpit -> chase -> overview -> cockpit; its label names the next view.
const NEXT_VIEW: Record<SceneView, SceneView> = { cockpit: 'follow', follow: 'overview', overview: 'cockpit' }
const VIEW_BUTTON_LABEL: Record<SceneView, string> = {
  cockpit: 'Chase cam',
  follow: 'Overview',
  overview: 'Cockpit',
}

export function DriveScreen() {
  const input = useInputAdapter()
  const session = useDriveSession(input.normalized, input.buttonCounts, input.presses.ersCycle, input.presses.reset)
  const demo = useDemo()
  // Retina screens: start at 1.5x, drop to 1x if the frame rate can't keep up
  const [dpr, setDpr] = useState(1.5)
  const { selection } = useGarage()
  const { start, connectionState } = session

  const [profiles, setProfiles] = useState<Partial<Record<TrackId, TrackProfile>>>({})
  const [viewOverride, setViewOverride] = useState<SceneView | null>(null)
  const [showControls, setShowControls] = useState(false)
  const [showRacingLine, setShowRacingLine] = useState(true)
  const [showSetup, setShowSetup] = useState(false)
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
  const view: SceneView = viewOverride ?? (inSession ? 'cockpit' : 'overview')

  useEffect(() => {
    if (demo.active && demo.step.id === 'drive' && connectionState === 'idle') void start()
  }, [demo.active, demo.step.id, connectionState, start])

  const info = session.sessionInfo
  // only while someone is watching; "disconnected" was just noise on screen
  const engineer: { label: string; tone: StatusTone } | null = info?.engineer_connected ? { label: 'Engineer connected', tone: 'success' } : null
  const v = session.vehicleState

  // Tell the ESP32 wheel's screen what the game is doing: its connection
  // banner, BRAKE light and speed. `input.source` is a dependency so the
  // "is this wheel the one driving?" flag is re-sent whenever the input in use
  // changes (e.g. a gamepad is plugged in).
  const gameSession: GameState['session'] =
    connectionState === 'idle' || connectionState === 'closed' ? 'none' : connectionState
  const gameWarning: GameState['warning'] = session.warning.active
    ? 'brake'
    : session.warning.stale
      ? 'stale'
      : 'clear'
  const speedKmh = v ? Math.round(Math.abs(v.speed) * 3.6) : null // |v|: reverse is negative
  const { reportGameState, source: inputSource } = input
  useEffect(() => {
    reportGameState({ session: gameSession, warning: gameWarning, speedKmh })
  }, [reportGameState, gameSession, gameWarning, speedKmh, inputSource])

  return (
    <div className="drive-screen" data-connection={connectionState}>
      <Canvas camera={{ position: [400, 500, 400], fov: 50, near: 0.5, far: 8000 }} dpr={dpr}>
        <PerformanceMonitor onDecline={() => setDpr(1)} onIncline={() => setDpr(1.5)} />
        <Scene
          view={view}
          trackProfile={profile}
          vehicleState={v ? { x: v.x, y: v.y, heading: v.heading, speed: v.speed, drsOpen: v.drs_open, t: v.t } : null}
          trail={session.trail}
          previousLapTrail={session.previousLapTrail}
          steering={steeringRef}
          showRacingLine={showRacingLine && inSession}
          effects={dpr > 1}
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
          onOpenSetup={() => setShowSetup(true)}
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
            {info && (
              <StatusBadge
                tone={info.scenario_name ? 'warning' : 'neutral'}
                label={info.scenario_name ? `Scenario armed: ${info.scenario_name}` : 'No scenario armed'}
              />
            )}
            {info && <StatusBadge tone="neutral" label={`Upgrades: ${carLabel(info.upgrades)}`} />}
            {/* stacked under the badges (not floating over them) */}
            <FaultHeadsUp faults={session.faultState?.faults ?? []} profile={profile} distanceAlongLap={v?.distance_along_lap ?? 0} />
          </div>
          <BrakeWarning warning={session.warning} />
          <RunStateBanner vehicleState={v} />
          <DriveHud normalized={input.normalized} vehicleState={v} profile={profile} sessionId={session.sessionId} />
          <TelemetryPanel normalized={input.normalized} vehicleState={v} />

          <div className="drive-screen__dock">
            <button type="button" onClick={session.togglePause} disabled={connectionState !== 'connected'}>
              {session.running ? 'Pause' : 'Resume'}
            </button>
            <button type="button" onClick={session.reset} disabled={connectionState !== 'connected'}>
              Reset to grid
            </button>
            <button type="button" onClick={() => setViewOverride(NEXT_VIEW[view])}>
              {VIEW_BUTTON_LABEL[view]}
            </button>
            <button type="button" onClick={() => setShowSetup((s) => !s)} aria-pressed={showSetup}>
              Car setup
            </button>
            <button type="button" onClick={() => setShowRacingLine((s) => !s)} aria-pressed={showRacingLine}>
              Racing line
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

      {showSetup && (
        <div className="drive-screen__setup">
          <CarSetupPanel setup={session.setup} onChange={session.setSetup} onClose={() => setShowSetup(false)} />
        </div>
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
