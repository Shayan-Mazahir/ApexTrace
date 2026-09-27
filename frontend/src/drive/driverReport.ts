import type { VehicleStateMessage } from '../types/schemas'

// The human side of the safety test. The stress suite's scripted driver
// assumes a 0.25-0.40 s reaction to the BRAKE warning; this measures what a
// real person at the wheel actually does: how long from the warning appearing
// until the brake goes on, how often it is ignored, and how close they came.
//
// A pure reducer over (time, warning, brake, vehicle state) so it is testable
// and costs nothing per frame.

export const BRAKE_ON = 0.3 // a deliberate press, not a resting foot or joystick noise
export const IGNORED_AFTER_S = 3 // no brake within this long of the warning: ignored
// What the stress suite's scripted driver is given (evaluation.build_suite).
export const ASSUMED_REACTION_S: [number, number] = [0.25, 0.4]

export type Outcome = 'reacted' | 'anticipated' | 'ignored'

export interface WarningResponse {
  hazard: string
  shownAt: number // Date.now() when BRAKE appeared
  outcome: Outcome
  reactionS: number | null // null when ignored; 0 when already braking
  speedKmh: number // when the warning appeared
}

export interface DriverReport {
  startedAt: number
  responses: WarningResponse[]
  pending: { hazard: string; shownAt: number; speedKmh: number } | null
  lastShownAt: number | null // de-duplicates the same warning across updates
  minClearanceM: number | null // closest the car's centre came to the track edge
  barrierHits: number
  trackExits: number
  bestLapS: number | null
  laps: number
  topSpeedKmh: number
  maxG: number
  prevContacts: number | null
  prevExits: number | null
  prevLaps: number | null
}

export function newReport(now: number): DriverReport {
  return {
    startedAt: now,
    responses: [],
    pending: null,
    lastShownAt: null,
    minClearanceM: null,
    barrierHits: 0,
    trackExits: 0,
    bestLapS: null,
    laps: 0,
    topSpeedKmh: 0,
    maxG: 0,
    prevContacts: null,
    prevExits: null,
    prevLaps: null,
  }
}

export interface ReportInput {
  now: number
  warningActive: boolean
  warningSince: number | null
  hazard: string | null
  brake: number // 0..1, the driver's own input
  vehicle: Pick<
    VehicleStateMessage,
    'speed' | 'signed_clearance' | 'barrier_contacts' | 'track_exits' | 'laps_completed' | 'best_lap_s' | 'session_best_lap_s' | 'g_lat' | 'g_long'
  > | null
}

// Counters that the car's reset puts back to zero: count only the rises.
function rises(prev: number | null, cur: number): number {
  return prev !== null && cur > prev ? cur - prev : 0
}

export function stepReport(r: DriverReport, input: ReportInput): DriverReport {
  const { now, vehicle } = input
  const next: DriverReport = { ...r }
  const speedKmh = vehicle ? Math.abs(vehicle.speed) * 3.6 : 0
  const braking = input.brake >= BRAKE_ON

  // a new BRAKE warning
  if (input.warningActive && input.warningSince !== null && input.warningSince !== r.lastShownAt) {
    next.lastShownAt = input.warningSince
    if (r.pending) next.responses = [...next.responses, { ...r.pending, outcome: 'ignored', reactionS: null }]
    const hazard = input.hazard ?? 'corner'
    if (braking) {
      // already on the brakes before being told: good anticipation, not a reaction time
      next.responses = [...next.responses, { hazard, shownAt: input.warningSince, outcome: 'anticipated', reactionS: 0, speedKmh }]
      next.pending = null
    } else {
      next.pending = { hazard, shownAt: input.warningSince, speedKmh }
    }
  } else if (next.pending) {
    const p = next.pending
    if (braking) {
      const reactionS = Math.max(0, (now - p.shownAt) / 1000)
      next.responses = [...next.responses, { ...p, outcome: 'reacted', reactionS }]
      next.pending = null
    } else if (!input.warningActive || now - p.shownAt > IGNORED_AFTER_S * 1000) {
      next.responses = [...next.responses, { ...p, outcome: 'ignored', reactionS: null }]
      next.pending = null
    }
  }

  if (vehicle) {
    next.barrierHits += rises(r.prevContacts, vehicle.barrier_contacts)
    next.trackExits += rises(r.prevExits, vehicle.track_exits)
    next.laps += rises(r.prevLaps, vehicle.laps_completed)
    next.prevContacts = vehicle.barrier_contacts
    next.prevExits = vehicle.track_exits
    next.prevLaps = vehicle.laps_completed
    if (Math.abs(vehicle.speed) > 5 && Number.isFinite(vehicle.signed_clearance)) {
      next.minClearanceM = r.minClearanceM === null ? vehicle.signed_clearance : Math.min(r.minClearanceM, vehicle.signed_clearance)
    }
    const best = vehicle.session_best_lap_s ?? vehicle.best_lap_s
    if (best != null && (next.bestLapS === null || best < next.bestLapS)) next.bestLapS = best
    next.topSpeedKmh = Math.max(r.topSpeedKmh, speedKmh)
    next.maxG = Math.max(r.maxG, Math.hypot(vehicle.g_lat ?? 0, vehicle.g_long ?? 0))
  }
  return next
}

export interface ReportSummary {
  warnings: number
  heeded: number
  ignored: number
  reactionAvgS: number | null // over measured reactions (anticipated excluded)
  reactionBestS: number | null
  score: number // 0..100
  grade: 'A' | 'B' | 'C' | 'D'
  verdict: string
  extraBrakingM: number | null // extra travel vs the suite's slowest assumed driver, at the average warning speed
}

const clamp01 = (v: number) => Math.min(1, Math.max(0, v))

// Score = reactions (40) + heeding the warnings (30) + no incidents (30).
export function summarise(r: DriverReport): ReportSummary {
  const all = r.pending ? [...r.responses, { ...r.pending, outcome: 'ignored' as const, reactionS: null }] : r.responses
  const warnings = all.length
  const ignored = all.filter((x) => x.outcome === 'ignored').length
  const heeded = warnings - ignored
  const measured = all.filter((x) => x.outcome === 'reacted').map((x) => x.reactionS as number)
  const reactionAvgS = measured.length ? measured.reduce((a, b) => a + b, 0) / measured.length : null
  const reactionBestS = measured.length ? Math.min(...measured) : null

  const [fast, slow] = ASSUMED_REACTION_S
  const reactionPart = warnings === 0 ? 20 : reactionAvgS === null ? (heeded ? 40 : 0) : 40 * clamp01((1.0 - reactionAvgS) / (1.0 - fast))
  const heedPart = warnings === 0 ? 30 : 30 * (heeded / warnings)
  const incidentPart = Math.max(0, 30 - 10 * r.barrierHits - 5 * r.trackExits)
  const score = Math.round(reactionPart + heedPart + incidentPart)
  const grade = score >= 85 ? 'A' : score >= 70 ? 'B' : score >= 50 ? 'C' : 'D'

  let verdict: string
  let extraBrakingM: number | null = null
  if (warnings === 0) {
    verdict = 'No BRAKE warnings yet: drive into a corner at speed to be tested.'
  } else if (reactionAvgS === null) {
    verdict = heeded ? 'You braked before every warning: nothing left to measure.' : 'Every warning was ignored.'
  } else {
    const speeds = all.map((x) => x.speedKmh)
    const avgSpeedMs = speeds.reduce((a, b) => a + b, 0) / speeds.length / 3.6
    if (reactionAvgS <= slow) {
      verdict = `Within the ${fast.toFixed(2)}-${slow.toFixed(2)} s the stress suite assumes: its warning margins hold for you.`
    } else {
      extraBrakingM = avgSpeedMs * (reactionAvgS - slow)
      verdict = `Slower than the ${slow.toFixed(2)} s the stress suite assumes: at your warning speeds you travel ${Math.round(extraBrakingM)} m further before braking than it tests for.`
    }
  }
  return { warnings, heeded, ignored, reactionAvgS, reactionBestS, score, grade, verdict, extraBrakingM }
}
