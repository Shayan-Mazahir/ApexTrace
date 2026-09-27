import { NO_RUMBLE, type Rumble, type Surface } from './haptics'

// The latest force-feedback state, written at 20 Hz by useHaptics and read
// every frame by the scene (camera shake, sparks, smoke, skid marks). A ref,
// not React state: the scene must not re-render 20 times a second for it.
export interface HapticSignal {
  rumble: Rumble
  surface: Surface
  lockup: boolean
  wheelspin: boolean
  speed: number // m/s, unsigned
  gLong: number // + accelerating, - braking
  gLat: number
  impactAt: number // performance.now() of the last barrier hit; -Infinity = none
  impactStrength: number // 0..1
}

export function createHapticSignal(): HapticSignal {
  return {
    rumble: NO_RUMBLE,
    surface: 'track',
    lockup: false,
    wheelspin: false,
    speed: 0,
    gLong: 0,
    gLat: 0,
    impactAt: Number.NEGATIVE_INFINITY,
    impactStrength: 0,
  }
}
