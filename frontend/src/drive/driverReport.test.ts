import { describe, expect, it } from 'vitest'
import { IGNORED_AFTER_S, newReport, stepReport, summarise, type ReportInput } from './driverReport'

const car = (over: Partial<NonNullable<ReportInput['vehicle']>> = {}) => ({
  speed: 80,
  signed_clearance: 4,
  barrier_contacts: 0,
  track_exits: 0,
  laps_completed: 0,
  best_lap_s: null,
  session_best_lap_s: null,
  g_lat: 0,
  g_long: 0,
  ...over,
})

const step = (r: ReturnType<typeof newReport>, now: number, over: Partial<ReportInput> = {}) =>
  stepReport(r, { now, warningActive: false, warningSince: null, hazard: null, brake: 0, vehicle: car(), ...over })

describe('reaction time', () => {
  it('times from the warning appearing to the brake going on', () => {
    let r = newReport(0)
    r = step(r, 1000, { warningActive: true, warningSince: 1000, hazard: 'T1' })
    r = step(r, 1200, { warningActive: true, warningSince: 1000, brake: 0.1 }) // resting foot: not yet
    r = step(r, 1450, { warningActive: true, warningSince: 1000, brake: 0.8 })
    expect(r.responses).toEqual([{ hazard: 'T1', shownAt: 1000, outcome: 'reacted', reactionS: 0.45, speedKmh: 288 }])
    r = step(r, 1600, { warningActive: true, warningSince: 1000, brake: 1 }) // same warning: counted once
    expect(r.responses).toHaveLength(1)
  })

  it('counts braking before the warning as anticipation, not a 0 s reaction', () => {
    const r = step(newReport(0), 1000, { warningActive: true, warningSince: 1000, hazard: 'T1', brake: 1 })
    expect(r.responses[0]).toMatchObject({ outcome: 'anticipated', reactionS: 0 })
    expect(summarise(r).reactionAvgS).toBeNull()
  })

  it('marks a warning ignored when it clears, or after a few seconds, without braking', () => {
    let r = step(newReport(0), 1000, { warningActive: true, warningSince: 1000, hazard: 'T1' })
    r = step(r, 1500) // warning gone
    expect(r.responses[0].outcome).toBe('ignored')
    r = step(r, 2000, { warningActive: true, warningSince: 2000, hazard: 'T2' })
    r = step(r, 2000 + IGNORED_AFTER_S * 1000 + 1, { warningActive: true, warningSince: 2000 })
    expect(r.responses.map((x) => x.outcome)).toEqual(['ignored', 'ignored'])
  })
})

describe('incidents and laps', () => {
  it('counts rises only, so a reset to grid does not undo or double them', () => {
    let r = step(newReport(0), 0)
    r = step(r, 50, { vehicle: car({ barrier_contacts: 1, track_exits: 1 }) })
    r = step(r, 100, { vehicle: car({ barrier_contacts: 0, track_exits: 0 }) }) // reset
    r = step(r, 150, { vehicle: car({ barrier_contacts: 1 }) })
    expect(r.barrierHits).toBe(2)
    expect(r.trackExits).toBe(1)
  })

  it('keeps the closest call, best lap, top speed and peak g', () => {
    let r = step(newReport(0), 0, { vehicle: car({ signed_clearance: 2, best_lap_s: 95 }) })
    r = step(r, 50, { vehicle: car({ signed_clearance: 0.4, session_best_lap_s: 91, speed: 90, g_long: -4, g_lat: 3 }) })
    r = step(r, 100, { vehicle: car({ signed_clearance: 3, speed: 1, best_lap_s: 99 }) })
    expect(r.minClearanceM).toBe(0.4)
    expect(r.bestLapS).toBe(91)
    expect(r.topSpeedKmh).toBeCloseTo(324)
    expect(r.maxG).toBeCloseTo(5)
  })
})

describe('summary', () => {
  it('scores a clean, quick driver highly and says the suite holds', () => {
    let r = newReport(0)
    for (const t of [1000, 5000]) {
      r = step(r, t, { warningActive: true, warningSince: t, hazard: 'T' })
      r = step(r, t + 300, { warningActive: true, warningSince: t, brake: 1 })
    }
    const s = summarise(r)
    expect(s).toMatchObject({ warnings: 2, heeded: 2, ignored: 0, grade: 'A', extraBrakingM: null })
    expect(s.reactionAvgS).toBeCloseTo(0.3)
    expect(s.verdict).toMatch(/margins hold/)
  })

  it('turns a slow reaction into extra metres travelled before braking', () => {
    let r = step(newReport(0), 1000, { warningActive: true, warningSince: 1000, hazard: 'T', vehicle: car({ speed: 50 }) })
    r = step(r, 1900, { warningActive: true, warningSince: 1000, brake: 1 })
    const s = summarise(r)
    expect(s.extraBrakingM).toBeCloseTo(50 * 0.5) // 0.9 s vs 0.4 s at 50 m/s
    expect(s.verdict).toMatch(/25 m further/)
  })

  it('penalises ignored warnings and crashes', () => {
    let r = step(newReport(0), 1000, { warningActive: true, warningSince: 1000, hazard: 'T' })
    r = step(r, 1500)
    r = step(r, 1550, { vehicle: car({ barrier_contacts: 3 }) })
    const s = summarise(r)
    expect(s.ignored).toBe(1)
    expect(s.score).toBe(0)
    expect(s.grade).toBe('D')
  })
})
