import { useCallback, useEffect, useRef, useState } from 'react'
import { useErrorContext } from '../app/ErrorContext'
import { createSession, driverWebSocketUrl } from '../api/session'
import type { NormalizedControls } from '../input/useInputAdapter'
import type { TrackId, TrackProfile, VehicleStateMessage } from '../types/schemas'

export type ConnectionState = 'idle' | 'connecting' | 'connected' | 'error'

const SEND_INTERVAL_MS = 50 // 20Hz, matches the backend tick rate
const MAX_TRAIL_POINTS = 400

// Owns the session lifecycle: create -> connect WS -> stream controls up,
// vehicle_state down. All actual state (position, track_exit, completed)
// is server-authoritative — this hook never computes physics locally.
export function useDriveSession(normalizedControls: NormalizedControls) {
  const { reportError } = useErrorContext()
  const [selectedTrack, setSelectedTrack] = useState<TrackId>('monza')
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle')
  const [trackProfile, setTrackProfile] = useState<TrackProfile | null>(null)
  const [vehicleState, setVehicleState] = useState<VehicleStateMessage | null>(null)
  const [running, setRunning] = useState(true)
  const [trail, setTrail] = useState<[number, number][]>([])

  const wsRef = useRef<WebSocket | null>(null)
  const seqRef = useRef(0)
  const controlsRef = useRef(normalizedControls)
  controlsRef.current = normalizedControls

  const start = useCallback(async () => {
    if (connectionState === 'connecting' || connectionState === 'connected') return
    setConnectionState('connecting')
    try {
      const { session_id, track_profile } = await createSession(selectedTrack)
      setTrackProfile(track_profile)
      setVehicleState(null)
      setTrail([])
      seqRef.current = 0

      const ws = new WebSocket(driverWebSocketUrl(session_id))
      wsRef.current = ws

      ws.onopen = () => setConnectionState('connected')

      ws.onmessage = (event) => {
        const message = JSON.parse(event.data) as VehicleStateMessage
        if (message.type !== 'vehicle_state') return
        setVehicleState(message)
        setTrail((prev) => {
          const next: [number, number][] = [...prev, [message.x, message.y]]
          return next.length > MAX_TRAIL_POINTS ? next.slice(next.length - MAX_TRAIL_POINTS) : next
        })
      }

      ws.onerror = () => {
        setConnectionState('error')
        reportError('Drive session WebSocket error')
      }

      ws.onclose = () => setConnectionState((prev) => (prev === 'error' ? prev : 'idle'))

      setRunning(true)
    } catch (err) {
      setConnectionState('error')
      reportError(err instanceof Error ? err.message : 'Failed to start session')
    }
  }, [connectionState, selectedTrack, reportError])

  const togglePause = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    const next = !running
    ws.send(JSON.stringify({ type: next ? 'resume' : 'pause' }))
    setRunning(next)
  }, [running])

  const reset = useCallback(() => {
    const ws = wsRef.current
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    ws.send(JSON.stringify({ type: 'reset' }))
    setTrail([])
    setRunning(true)
  }, [])

  const selectTrack = useCallback((track: TrackId) => setSelectedTrack(track), [])

  useEffect(() => {
    return () => {
      wsRef.current?.close()
      wsRef.current = null
    }
  }, [])

  useEffect(() => {
    if (connectionState !== 'connected') return
    const interval = setInterval(() => {
      const ws = wsRef.current
      if (!ws || ws.readyState !== WebSocket.OPEN) return
      seqRef.current += 1
      ws.send(
        JSON.stringify({
          type: 'control_input',
          seq: seqRef.current,
          steering: controlsRef.current.steering,
          throttle: controlsRef.current.throttle,
          brake: controlsRef.current.brake,
        }),
      )
    }, SEND_INTERVAL_MS)
    return () => clearInterval(interval)
  }, [connectionState])

  return {
    selectedTrack,
    selectTrack,
    connectionState,
    trackProfile,
    vehicleState,
    trail,
    running,
    start,
    togglePause,
    reset,
  }
}
