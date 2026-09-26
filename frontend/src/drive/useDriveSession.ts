import { useCallback, useEffect, useRef, useState } from 'react'
import { createSession } from '../api/session'
import { useActiveSession } from '../app/ActiveSessionContext'
import { useErrorContext } from '../app/ErrorContext'
import { useGarage } from '../app/GarageContext'
import type { ButtonCounts, NormalizedControls } from '../input/useInputAdapter'
import { useSessionStream } from '../stream/useSessionStream'
import { DEFAULT_CAR_SETUP, type CarSetupConfig, type ErsMode, type TrackId } from '../types/schemas'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

const SEND_INTERVAL_MS = 50 // 20Hz, matches the backend tick rate
const SETUP_KEY = 'limitlab.carSetup'
const ERS_ORDER: ErsMode[] = ['harvest', 'balanced', 'overtake']

function loadSetup(): CarSetupConfig {
  try {
    const saved = JSON.parse(localStorage.getItem(SETUP_KEY) ?? 'null')
    return saved ? { ...DEFAULT_CAR_SETUP, ...saved } : DEFAULT_CAR_SETUP
  } catch {
    return DEFAULT_CAR_SETUP
  }
}

// Creates/attaches the driver's session and streams controls up. All state
// (position, faults, warnings, lap progress) is server-authoritative — this
// hook never computes physics locally.
export function useDriveSession(
  normalizedControls: NormalizedControls,
  buttonCounts?: React.MutableRefObject<ButtonCounts>,
  ersPresses = 0,
) {
  const { reportError } = useErrorContext()
  const { driverSession, setDriverSession } = useActiveSession()
  const { selection } = useGarage()
  const [selectedTrack, setSelectedTrack] = useState<TrackId>(driverSession?.track ?? 'monza')
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState(true)
  const [setup, setSetupState] = useState<CarSetupConfig>(loadSetup)

  const stream = useSessionStream('driver', driverSession?.id ?? null)
  const { send } = stream

  const seqRef = useRef(0)
  const controlsRef = useRef(normalizedControls)
  controlsRef.current = normalizedControls

  const connectionState: ConnectionState = creating ? 'connecting' : stream.connection

  const start = useCallback(async () => {
    if (creating || (driverSession && stream.connection !== 'closed')) return
    setCreating(true)
    try {
      const created = await createSession(selectedTrack, 'driver', undefined, selection, setup)
      seqRef.current = 0
      setRunning(true)
      setDriverSession({
        id: created.session_id,
        track: selectedTrack,
        seed: created.seed,
        profile: created.track_profile,
      })
    } catch (err) {
      reportError(err instanceof Error ? err.message : 'Failed to start session')
    } finally {
      setCreating(false)
    }
  }, [creating, driverSession, stream.connection, selectedTrack, selection, setup, setDriverSession, reportError])

  // Setup changes apply live: saved locally and sent to the running session.
  const setSetup = useCallback(
    (next: CarSetupConfig) => {
      setSetupState(next)
      try {
        localStorage.setItem(SETUP_KEY, JSON.stringify(next))
      } catch {
        /* storage unavailable: setting still applies to this session */
      }
      send({ type: 'car_setup', setup: next })
    },
    [send],
  )

  // Re-send the setup whenever the stream (re)connects, so the server always has it.
  const setupRef = useRef(setup)
  setupRef.current = setup
  useEffect(() => {
    if (stream.connection === 'connected') send({ type: 'car_setup', setup: setupRef.current })
  }, [stream.connection, send])

  // Battery-mode button cycles Harvest -> Balanced -> Overtake.
  const ersSeen = useRef(ersPresses)
  useEffect(() => {
    if (ersPresses === ersSeen.current) return
    ersSeen.current = ersPresses
    const current = setupRef.current
    const next = ERS_ORDER[(ERS_ORDER.indexOf(current.ers_mode) + 1) % ERS_ORDER.length]
    setSetup({ ...current, ers_mode: next })
  }, [ersPresses, setSetup])

  const endSession = useCallback(() => setDriverSession(null), [setDriverSession])

  // The server no longer knows this session (e.g. the backend restarted):
  // drop it so Start works straight away, and say what happened.
  useEffect(() => {
    if (stream.connection === 'closed' && driverSession) {
      setDriverSession(null)
      reportError('Session lost — the backend restarted. Press Start for a new run.')
    }
  }, [stream.connection, driverSession, setDriverSession, reportError])

  const togglePause = useCallback(() => {
    const next = !running
    if (send({ type: next ? 'resume' : 'pause' })) setRunning(next)
  }, [running, send])

  const reset = useCallback(() => {
    if (send({ type: 'reset' })) setRunning(true)
  }, [send])

  useEffect(() => {
    if (stream.connection !== 'connected' || !driverSession) return
    const interval = setInterval(() => {
      seqRef.current += 1
      send({
        type: 'control_input',
        seq: seqRef.current,
        session_id: driverSession.id,
        track: driverSession.track,
        seed: driverSession.seed,
        t_client: Date.now(),
        steering: controlsRef.current.steering,
        throttle: controlsRef.current.throttle,
        brake: controlsRef.current.brake,
        shift_up_count: buttonCounts?.current.shiftUp ?? 0,
        shift_down_count: buttonCounts?.current.shiftDown ?? 0,
        drs_toggle_count: buttonCounts?.current.drs ?? 0,
        reverse_toggle_count: buttonCounts?.current.reverse ?? 0,
      })
    }, SEND_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [stream.connection, driverSession, send, buttonCounts])

  return {
    setup,
    setSetup,
    selectedTrack,
    selectTrack: setSelectedTrack,
    connectionState,
    sessionId: driverSession?.id ?? null,
    trackProfile: driverSession?.profile ?? null,
    vehicleState: stream.vehicleState,
    warning: stream.warning,
    faultState: stream.faultState,
    sessionInfo: stream.sessionInfo,
    trail: stream.trail,
    previousLapTrail: stream.previousLapTrail,
    running,
    start,
    endSession,
    togglePause,
    reset,
  }
}
