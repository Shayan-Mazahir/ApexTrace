import { Canvas } from '@react-three/fiber'
import { CalibrationPanel } from '../components/CalibrationPanel'
import { StatusBadge, type StatusTone } from '../components/StatusBadge'
import { BrakeWarning } from '../drive/BrakeWarning'
import { DriveHud } from '../drive/DriveHud'
import { RunStateBanner } from '../drive/RunStateBanner'
import { TrackSelector } from '../drive/TrackSelector'
import { useDriveSession } from '../drive/useDriveSession'
import { useInputAdapter } from '../input/useInputAdapter'
import { Scene } from '../scene/Scene'
import './DriveScreen.css'

const CONNECTION_LABEL: Record<string, string> = {
  idle: 'Session idle',
  connecting: 'Connecting…',
  connected: 'Session connected',
  error: 'Session error',
}

const CONNECTION_TONE: Record<string, StatusTone> = {
  idle: 'neutral',
  connecting: 'neutral',
  connected: 'success',
  error: 'danger',
}

export function DriveScreen() {
  const input = useInputAdapter()
  const session = useDriveSession(input.normalized)

  return (
    <div className="drive-screen">
      <Canvas shadows camera={{ position: [400, 500, 400], fov: 50 }}>
        <Scene
          trackProfile={session.trackProfile}
          vehicleState={session.vehicleState}
          trail={session.trail}
          previousLapTrail={session.previousLapTrail}
        />
      </Canvas>

      <BrakeWarning
        reason={session.vehicleState?.warning_reason ?? null}
        hazardZone={session.vehicleState?.next_hazard_zone ?? null}
      />
      <RunStateBanner vehicleState={session.vehicleState} />

      <div className="drive-screen__top-controls">
        <TrackSelector
          value={session.selectedTrack}
          onChange={session.selectTrack}
          disabled={session.connectionState !== 'idle'}
        />
        <StatusBadge
          label={CONNECTION_LABEL[session.connectionState]}
          tone={CONNECTION_TONE[session.connectionState]}
        />
      </div>

      <div className="drive-screen__run-controls">
        <button
          type="button"
          onClick={session.start}
          disabled={session.connectionState === 'connecting' || session.connectionState === 'connected'}
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
