import { useCallback, useEffect, useRef, useState } from 'react'
import { sessionExists, sessionWebSocketUrl } from '../api/session'
import { useErrorContext } from '../app/ErrorContext'
import type {
  ClientCommand,
  FaultStateMessage,
  ServerMessage,
  SessionInfoMessage,
  SessionRole,
  VehicleStateMessage,
} from '../types/schemas'
import { appendFaultEvent, type FaultEvent } from './faultTimeline'
import { openSessionConnection, type StreamConnection } from './connection'
import { applyWarningEvent, INITIAL_WARNING, type WarningState } from './warningState'

export type { StreamConnection }

const MAX_TRAIL_POINTS = 2000

type Point = [number, number]

// One live connection to a session as either role. Reconnects with backoff
// (the server keeps the session alive and resends current state on connect),
// and applies warning events only if they are newer than the last one seen.
export function useSessionStream(role: SessionRole, sessionId: string | null) {
  const { reportError } = useErrorContext()
  const [connection, setConnection] = useState<StreamConnection>('idle')
  const [vehicleState, setVehicleState] = useState<VehicleStateMessage | null>(null)
  const [warning, setWarning] = useState<WarningState>(INITIAL_WARNING)
  const [faultState, setFaultState] = useState<FaultStateMessage | null>(null)
  const [faultEvents, setFaultEvents] = useState<FaultEvent[]>([])
  const [sessionInfo, setSessionInfo] = useState<SessionInfoMessage | null>(null)
  const [trail, setTrail] = useState<Point[]>([])
  const [previousLapTrail, setPreviousLapTrail] = useState<Point[]>([])
  const [lastMessageAt, setLastMessageAt] = useState<number | null>(null)

  const connectionRef = useRef<ReturnType<typeof openSessionConnection> | null>(null)
  const trailRef = useRef<Point[]>([])
  const runIdRef = useRef<string | null>(null)
  const reportErrorRef = useRef(reportError)
  reportErrorRef.current = reportError

  useEffect(() => {
    trailRef.current = []
    runIdRef.current = null
    setVehicleState(null)
    setWarning(INITIAL_WARNING)
    setFaultState(null)
    setFaultEvents([])
    setSessionInfo(null)
    setTrail([])
    setPreviousLapTrail([])
    setLastMessageAt(null)

    if (!sessionId) {
      setConnection('idle')
      return
    }

    const handleMessage = (message: ServerMessage) => {
      setLastMessageAt(Date.now())
      switch (message.type) {
        case 'vehicle_state': {
          setVehicleState(message)
          const next: Point[] = [...trailRef.current, [message.x, message.y]]
          trailRef.current =
            next.length > MAX_TRAIL_POINTS ? next.slice(next.length - MAX_TRAIL_POINTS) : next
          setTrail(trailRef.current)
          break
        }
        case 'warning_event':
          setWarning((prev) => applyWarningEvent(prev, message, Date.now()))
          break
        case 'fault_state':
          setFaultState(message)
          setFaultEvents((prev) => appendFaultEvent(prev, message))
          break
        case 'session_info':
          if (runIdRef.current !== null && runIdRef.current !== message.run_id) {
            if (trailRef.current.length > 1) setPreviousLapTrail(trailRef.current)
            trailRef.current = []
            setTrail([])
          }
          runIdRef.current = message.run_id
          setSessionInfo(message)
          break
        case 'error':
          reportErrorRef.current(`Server rejected a message (${message.code}): ${message.message}`)
          break
        case 'heartbeat':
          break
      }
    }

    const connection = openSessionConnection({
      url: sessionWebSocketUrl(role, sessionId),
      sessionId,
      createSocket: (url) => new WebSocket(url),
      sessionExists,
      onStatus: setConnection,
      onMessage: (data) => {
        try {
          handleMessage(JSON.parse(data) as ServerMessage)
        } catch {
          // a malformed frame from the server must not take the UI down
        }
      },
    })
    connectionRef.current = connection

    return () => {
      connection.close()
      connectionRef.current = null
    }
  }, [role, sessionId])

  const send = useCallback(
    (command: ClientCommand): boolean => connectionRef.current?.send(JSON.stringify(command)) ?? false,
    [],
  )

  return {
    connection,
    vehicleState,
    warning,
    faultState,
    faultEvents,
    sessionInfo,
    trail,
    previousLapTrail,
    lastMessageAt,
    send,
  }
}
