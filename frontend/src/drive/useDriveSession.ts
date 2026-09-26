import { useCallback, useEffect, useRef, useState } from 'react'
import { createSession } from '../api/session'
import { useActiveSession } from '../app/ActiveSessionContext'
import { useErrorContext } from '../app/ErrorContext'
import type { NormalizedControls } from '../input/useInputAdapter'
import { useSessionStream } from '../stream/useSessionStream'
import type { TrackId } from '../types/schemas'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'closed'

const SEND_INTERVAL_MS = 50 // 20Hz, matches the backend tick rate

// Creates/attaches the driver's session and streams controls up. All state
// (position, faults, warnings, lap progress) is server-authoritative — this
// hook never computes physics locally.
export function useDriveSession(normalizedControls: NormalizedControls) {
  const { reportError } = useErrorContext()
  const { driverSession, setDriverSession } = useActiveSession()
  const [selectedTrack, setSelectedTrack] = useState<TrackId>(driverSession?.track ?? 'monza')
  const [creating, setCreating] = useState(false)
  const [running, setRunning] = useState(true)

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
      const created = await createSession(selectedTrack)
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
  }, [creating, driverSession, stream.connection, selectedTrack, setDriverSession, reportError])

  const endSession = useCallback(() => setDriverSession(null), [setDriverSession])

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
      })
    }, SEND_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [stream.connection, driverSession, send])

  return {
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
