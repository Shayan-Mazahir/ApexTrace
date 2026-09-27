import { useEffect, useRef, useState } from 'react'
import type { WarningState } from '../stream/warningState'
import type { VehicleStateMessage } from '../types/schemas'
import { BRAKE_ON, newReport, stepReport, type DriverReport } from './driverReport'

// Runs the driver report over a session, re-stepped when the car's state, the
// warning or whether the brake is on changes. Starts afresh with each session.
//
// The report lives in a ref, not state: stepping it at the 20 Hz state rate
// with setState-in-an-effect queued a render per step, and on a starved frame
// those stacked up into React's "maximum update depth" guard. The Drive screen
// already re-renders on every vehicle state, so reading the ref there is always
// current; a render is only forced when a new warning response lands (the
// reaction chip must appear even if the car has stopped).
export function useDriverReport(sessionId: string | null, vehicleState: VehicleStateMessage | null, warning: WarningState, brake: number) {
  const report = useRef<DriverReport>(newReport(Date.now()))
  const [, setResponses] = useState(0)
  const brakeRef = useRef(brake)
  brakeRef.current = brake
  const braking = brake >= BRAKE_ON

  useEffect(() => {
    report.current = newReport(Date.now())
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    const prev = report.current
    const next = stepReport(prev, {
      now: Date.now(),
      warningActive: warning.active,
      warningSince: warning.since,
      hazard: warning.hazardZone,
      brake: brakeRef.current,
      vehicle: vehicleState,
    })
    report.current = next
    if (next.responses.length !== prev.responses.length) setResponses(next.responses.length)
  }, [sessionId, vehicleState, warning.active, warning.since, warning.hazardZone, braking])

  return report.current
}
