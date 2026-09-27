import { useEffect, useMemo, useRef, useState } from 'react'
import type { TrackProfile, VehicleStateMessage } from '../types/schemas'
import { HapticsTracker, NO_RUMBLE, type HapticEvent, type Rumble } from './haptics'
import { createHapticSignal } from './signal'

interface Options {
  vehicleState: VehicleStateMessage | null
  profile: TrackProfile | null
  warningActive: boolean
  live: boolean // connected and driving; otherwise everything is still
  reportHaptics: (rumble: Rumble, events: HapticEvent[]) => void
}

// Runs the rumble logic on every vehicle state and fans it out: to the input
// device (servos / gamepad motors) and to the scene via the returned signal.
// `impacts` counts barrier hits, for the screen-edge flash.
export function useHaptics({ vehicleState, profile, warningActive, live, reportHaptics }: Options) {
  const tracker = useMemo(() => new HapticsTracker(), [])
  const signal = useRef(createHapticSignal())
  const [impacts, setImpacts] = useState(0)

  useEffect(() => {
    const s = signal.current
    if (!vehicleState || !profile || !live) {
      tracker.reset()
      s.rumble = NO_RUMBLE
      s.surface = 'track'
      s.lockup = s.wheelspin = false
      s.speed = s.gLong = s.gLat = 0
      reportHaptics(NO_RUMBLE, [])
      return
    }
    const frame = tracker.update(vehicleState, profile, warningActive)
    s.rumble = frame.rumble
    s.surface = frame.surface
    s.lockup = vehicleState.lockup ?? false
    s.wheelspin = vehicleState.wheelspin ?? false
    s.speed = Math.abs(vehicleState.speed)
    s.gLong = vehicleState.g_long ?? 0
    s.gLat = vehicleState.g_lat ?? 0
    for (const event of frame.events) {
      if (event.kind !== 'impact') continue
      s.impactAt = performance.now()
      s.impactStrength = event.strength
      setImpacts((n) => n + 1)
    }
    reportHaptics(frame.rumble, frame.events)
  }, [vehicleState, profile, warningActive, live, reportHaptics, tracker])

  // leaving the Drive screen mid-rumble must not leave a device buzzing
  useEffect(() => () => reportHaptics(NO_RUMBLE, []), [reportHaptics])

  return { signal, impacts }
}
