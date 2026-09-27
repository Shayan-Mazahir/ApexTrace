import { useEffect, useRef, useState } from 'react'
import type { WarningState } from '../stream/warningState'
import type { VehicleStateMessage } from '../types/schemas'
import { BRAKE_ON, newReport, stepReport, type DriverReport } from './driverReport'

// Runs the driver report over a session: re-stepped when the car's state,
// the warning or whether the brake is on changes (not every frame). Starts
// afresh with each new session.
export function useDriverReport(sessionId: string | null, vehicleState: VehicleStateMessage | null, warning: WarningState, brake: number) {
  const [report, setReport] = useState<DriverReport>(() => newReport(Date.now()))
  const brakeRef = useRef(brake)
  brakeRef.current = brake
  const braking = brake >= BRAKE_ON

  useEffect(() => {
    setReport(newReport(Date.now()))
  }, [sessionId])

  useEffect(() => {
    if (!sessionId) return
    setReport((r) =>
      stepReport(r, {
        now: Date.now(),
        warningActive: warning.active,
        warningSince: warning.since,
        hazard: warning.hazardZone,
        brake: brakeRef.current,
        vehicle: vehicleState,
      }),
    )
  }, [sessionId, vehicleState, warning.active, warning.since, warning.hazardZone, braking])

  return report
}
