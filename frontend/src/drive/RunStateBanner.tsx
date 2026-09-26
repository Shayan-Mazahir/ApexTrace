import { useEffect, useRef, useState } from 'react'
import { StatusBadge } from '../components/StatusBadge'
import type { VehicleStateMessage } from '../types/schemas'
import './RunStateBanner.css'

const STALE_THRESHOLD_MS = 500
const SECTOR_FLASH_MS = 1500

// "Disconnected engineer station" (task 102) isn't renderable yet — there's
// no engineer WebSocket connection to observe until that lands. Rendering a
// fake status here would be worse than omitting it.
export function RunStateBanner({ vehicleState }: { vehicleState: VehicleStateMessage | null }) {
  const [sectorFlash, setSectorFlash] = useState<string | null>(null)
  const prevSectorRef = useRef<number | null>(null)

  useEffect(() => {
    if (!vehicleState) return
    const prev = prevSectorRef.current
    prevSectorRef.current = vehicleState.sector_index
    if (prev !== null && prev !== vehicleState.sector_index) {
      setSectorFlash(vehicleState.sector_name)
      const timeout = setTimeout(() => setSectorFlash(null), SECTOR_FLASH_MS)
      return () => clearTimeout(timeout)
    }
  }, [vehicleState?.sector_index, vehicleState?.sector_name])

  if (!vehicleState) return null

  if (vehicleState.track_exit) {
    return (
      <div className="run-state-banner">
        <StatusBadge label="Track exit" tone="danger" />
      </div>
    )
  }

  if (vehicleState.lap_complete) {
    return (
      <div className="run-state-banner">
        <StatusBadge label="Lap complete" tone="success" />
      </div>
    )
  }

  if (sectorFlash) {
    return (
      <div className="run-state-banner">
        <StatusBadge label={sectorFlash} tone="info" />
      </div>
    )
  }

  if (vehicleState.packet_age_ms > STALE_THRESHOLD_MS) {
    return (
      <div className="run-state-banner">
        <StatusBadge label="Stale telemetry" tone="warning" />
      </div>
    )
  }

  return null
}
