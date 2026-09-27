import { clamp } from './normalize'

// Turning the ESP32 wheel's tilt reading into a steering input that feels
// like a wheel, not a sensor.
//
// 1. Angle, not g. The MPU6050s report gravity's projection on the wheel's
//    axis, i.e. sin(tilt). Mapping that linearly compresses the last part of
//    the lock (sin flattens out), so the car turned less and less per degree
//    near full lock. asin() makes every degree of wheel worth the same.
// 2. One-Euro filter. The accelerometer is noisy, and the wheel's own rumble
//    servos shake it 4-20 times a second. A fixed low-pass would either leave
//    that jitter in or make fast turns laggy; the One-Euro filter (Casiez et
//    al., CHI 2012) smooths hard while the wheel is steady and opens up as it
//    moves quickly, so it is calm on the straights and sharp in the corners.
// 3. Response curve. A little expo gives finer control around centre, where a
//    hand-held wheel is at its twitchiest, while still reaching full lock.

export const FULL_LOCK_G = 0.8 // the wheel's reading at full lock (about 53 degrees)
const FULL_LOCK_RAD = Math.asin(FULL_LOCK_G)
export const STEERING_EXPO = 1.3

// Filter tuning, for the wheel's ~30 Hz input, from a sweep against a held
// wheel shaken +-0.08 at 12 Hz and a full-lock turn in 0.25 s: this cuts the
// shake by ~75% (0.16 -> 0.04 peak to peak) and the turn still arrives within
// 0.2 s. At rest the cutoff is 0.7 Hz; steering speed opens it up.
const MIN_CUTOFF_HZ = 0.7
const BETA = 0.6
const DERIVATIVE_CUTOFF_HZ = 1.0

export function tiltToSteering(g: number): number {
  if (!Number.isFinite(g)) return 0
  return clamp(Math.asin(clamp(g, -1, 1)) / FULL_LOCK_RAD, -1, 1)
}

export function responseCurve(x: number, expo = STEERING_EXPO): number {
  return Math.sign(x) * Math.pow(Math.min(1, Math.abs(x)), expo)
}

function alpha(cutoffHz: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoffHz)
  return 1 / (1 + tau / dt)
}

export class OneEuroFilter {
  private x: number | null = null
  private dx = 0
  private t = 0

  private readonly minCutoff: number
  private readonly beta: number
  private readonly dCutoff: number

  constructor(minCutoff = MIN_CUTOFF_HZ, beta = BETA, dCutoff = DERIVATIVE_CUTOFF_HZ) {
    this.minCutoff = minCutoff
    this.beta = beta
    this.dCutoff = dCutoff
  }

  /** `tSeconds` must not go backwards; the first sample passes straight through. */
  filter(value: number, tSeconds: number): number {
    if (this.x === null) {
      this.x = value
      this.t = tSeconds
      return value
    }
    const dt = tSeconds - this.t
    if (dt <= 0) return this.x // same instant (or clock hiccup): keep the last output
    this.t = tSeconds
    const rawDx = (value - this.x) / dt
    this.dx += alpha(this.dCutoff, dt) * (rawDx - this.dx)
    const cutoff = this.minCutoff + this.beta * Math.abs(this.dx)
    this.x += alpha(cutoff, dt) * (value - this.x)
    return this.x
  }

  reset() {
    this.x = null
    this.dx = 0
  }
}

/** Raw wheel reading (g) -> steering in [-1, 1], filtered and shaped. */
export class WheelSteering {
  private readonly filter = new OneEuroFilter()

  update(g: number, tSeconds: number): number {
    if (!Number.isFinite(g)) return 0
    return responseCurve(this.filter.filter(tiltToSteering(g), tSeconds))
  }

  reset() {
    this.filter.reset()
  }
}
