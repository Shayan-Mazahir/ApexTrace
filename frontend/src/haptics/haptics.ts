import type { HazardZone, TrackProfile, VehicleStateMessage } from '../types/schemas'

// Force feedback, the way a console racing game rumbles the pad: kerbs, run-off,
// locked or spinning wheels, barrier hits and the BRAKE warning. One signal
// drives every output — the ESP32 wheel's servos, a gamepad's motors and the
// camera shake / sparks / smoke in the 3D scene — so what you feel always
// matches what you see.

// Continuous rumble: held while the condition lasts, re-sent while it does.
export type RumbleEffect = 'none' | 'kerb' | 'rough' | 'slip'
export interface Rumble {
  effect: RumbleEffect
  strength: number // 0..1
  rateHz: number // bumps per second (kerb stripes passing under the wheels)
}
export const NO_RUMBLE: Rumble = { effect: 'none', strength: 0, rateHz: 0 }

// One-shot jolts, fired on the rising edge of the thing that caused them.
export type HapticEventKind = 'impact' | 'warning'
export interface HapticEvent {
  kind: HapticEventKind
  strength: number // 0..1
}

export type Surface = 'track' | 'kerb' | 'runoff' | 'rough' // rough = grass

// Wheel centre to the car's centreline (F1Car: 0.95 m to the tyre's outer wall).
export const CAR_HALF_WIDTH = 0.95
// Must match TrackScenery: kerbs are 1.4 m wide, just outside each edge line,
// and only drawn within cornerMask's 20 m of a corner.
export const KERB_WIDTH_M = 1.4
export const KERB_PAD_M = 20
// Below this the car is creeping; nothing to feel.
const MIN_SPEED_MS = 2
const SLIP_RATE_HZ = 20
const RATE_MIN_HZ = 4
const RATE_MAX_HZ = 18
// Scraping along a wall ticks the contact counter every few states; one knock
// per hit, not a burst (a harder hit inside the window still gets through).
export const IMPACT_REPEAT_MS = 400

export function kerbZoneAt(profile: TrackProfile, distanceAlongLap: number): boolean {
  const d = ((distanceAlongLap % profile.total_length) + profile.total_length) % profile.total_length
  return profile.hazard_zones.some((h) => d >= h.start_distance - KERB_PAD_M && d <= h.end_distance + KERB_PAD_M)
}

// What the wheels are on, from the car centre's clearance to the track edge
// (positive = inside). The wheels span clearance ± half width, so a wheel is
// over the edge once clearance < half width, and still on a kerb while the
// innermost wheel hasn't gone past its outer side.
export function surfaceUnder(clearance: number, distanceAlongLap: number, profile: TrackProfile): Surface {
  if (!Number.isFinite(clearance) || clearance >= CAR_HALF_WIDTH) return 'track'
  const overEdge = -clearance - CAR_HALF_WIDTH // how far past the edge the inner wheels are
  if (kerbZoneAt(profile, distanceAlongLap) && overEdge < KERB_WIDTH_M) return 'kerb'
  return 'rough'
}

// Kerb stripes are one centreline sample long (TrackScenery alternates colour
// per sample), so that is the spacing of the bumps.
export function stripeLength(profile: TrackProfile): number {
  return profile.total_length / Math.max(profile.centerline.length - 1, 1)
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))
const clampRate = (v: number) => Math.min(RATE_MAX_HZ, Math.max(RATE_MIN_HZ, v))

type HapticInput = Pick<
  VehicleStateMessage,
  'speed' | 'signed_clearance' | 'distance_along_lap' | 'barrier_contacts' | 'lockup' | 'wheelspin' | 'surface'
>

export interface HapticFrame {
  rumble: Rumble
  events: HapticEvent[]
  surface: Surface
}

// Turns 20 Hz vehicle states into rumble. Stateful only for the edges (a new
// barrier contact, a new BRAKE warning); everything else is read off the
// current state, so a dropped message costs nothing.
export class HapticsTracker {
  private contacts: number | null = null
  private warning = false
  private lastSpeed = 0 // the wall stops the car dead: the hit is felt at the speed before it
  private lastImpact = { at: Number.NEGATIVE_INFINITY, strength: 0 }

  update(v: HapticInput, profile: TrackProfile, warningActive: boolean, now = performance.now()): HapticFrame {
    const speed = Math.abs(v.speed)
    const events: HapticEvent[] = []
    // A reset puts the counter back to 0: a drop is not a hit.
    if (this.contacts !== null && v.barrier_contacts > this.contacts) {
      const strength = clamp01(0.4 + Math.max(speed, this.lastSpeed) / 50)
      if (now - this.lastImpact.at >= IMPACT_REPEAT_MS || strength > this.lastImpact.strength) {
        events.push({ kind: 'impact', strength })
        this.lastImpact = { at: now, strength }
      }
    }
    this.contacts = v.barrier_contacts
    this.lastSpeed = speed
    if (warningActive && !this.warning) events.push({ kind: 'warning', strength: 0.8 })
    this.warning = warningActive

    // The local estimate catches a wheel touching the kerb while the car's
    // centre is still on the track; past the line, the server's surface model
    // (the one the physics uses) knows paved runoff from grass.
    let surface = surfaceUnder(v.signed_clearance, v.distance_along_lap, profile)
    if (v.surface === 'kerb') surface = 'kerb'
    else if (v.surface === 'runoff' && surface !== 'kerb') surface = 'runoff'
    else if (v.surface === 'grass') surface = 'rough'
    let rumble = NO_RUMBLE
    if (speed >= MIN_SPEED_MS) {
      const pace = clamp01(speed / 60)
      if (surface === 'kerb') {
        rumble = { effect: 'kerb', strength: 0.45 + 0.55 * pace, rateHz: clampRate(speed / stripeLength(profile)) }
      } else if (surface === 'runoff') {
        rumble = { effect: 'rough', strength: 0.15 + 0.25 * pace, rateHz: clampRate(speed / 4) }
      } else if (surface === 'rough') {
        rumble = { effect: 'rough', strength: 0.3 + 0.5 * pace, rateHz: clampRate(speed / 3) }
      } else if (v.lockup || v.wheelspin) {
        rumble = { effect: 'slip', strength: v.lockup ? 0.7 : 0.5, rateHz: SLIP_RATE_HZ }
      }
    }
    return { rumble, events, surface }
  }

  reset() {
    this.contacts = null
    this.warning = false
    this.lastSpeed = 0
    this.lastImpact = { at: Number.NEGATIVE_INFINITY, strength: 0 }
  }
}

// The hazard a BRAKE warning refers to. Events name it by label or id,
// depending on the warning path; fall back to the car's next hazard.
export function warnedHazard(profile: TrackProfile, hazardZone: string | null, nextHazard: string | null): HazardZone | null {
  const byName = (name: string | null) =>
    name === null ? undefined : profile.hazard_zones.find((h) => h.id === name || h.label === name)
  return byName(hazardZone) ?? byName(nextHazard) ?? null
}
