import { describe, expect, it } from 'vitest'
import type { TrackProfile } from '../types/schemas'
import { CAR_HALF_WIDTH, HapticsTracker, IMPACT_REPEAT_MS, KERB_WIDTH_M, surfaceUnder, warnedHazard } from './haptics'

// 1 km straight, 101 samples (10 m kerb stripes), one corner at 400-500 m.
const profile = {
  total_length: 1000,
  centerline: Array.from({ length: 101 }, (_, i) => [i * 10, 0]),
  hazard_zones: [{ id: 'c1', label: 'Turn 1', start_distance: 400, end_distance: 500 }],
} as unknown as TrackProfile

const state = (over: Partial<Parameters<HapticsTracker['update']>[0]> = {}) => ({
  speed: 50,
  signed_clearance: 5,
  distance_along_lap: 450,
  barrier_contacts: 0,
  lockup: false,
  wheelspin: false,
  ...over,
})

describe('surfaceUnder', () => {
  it('is track while every wheel is inside the edge', () => {
    expect(surfaceUnder(CAR_HALF_WIDTH + 0.01, 450, profile)).toBe('track')
  })
  it('is kerb from a wheel on the edge until the inner wheels pass the kerb', () => {
    expect(surfaceUnder(CAR_HALF_WIDTH - 0.1, 450, profile)).toBe('kerb')
    expect(surfaceUnder(-CAR_HALF_WIDTH - KERB_WIDTH_M + 0.05, 450, profile)).toBe('kerb')
    expect(surfaceUnder(-CAR_HALF_WIDTH - KERB_WIDTH_M - 0.05, 450, profile)).toBe('rough')
  })
  it('has kerbs only at corners (with the 20 m pad the scenery draws)', () => {
    expect(surfaceUnder(0, 385, profile)).toBe('kerb')
    expect(surfaceUnder(0, 370, profile)).toBe('rough')
    expect(surfaceUnder(0, 1450, profile)).toBe('kerb') // next lap
  })
})

describe('HapticsTracker', () => {
  it('rumbles on a kerb faster the quicker the car goes', () => {
    const t = new HapticsTracker()
    const slow = t.update(state({ speed: 40, signed_clearance: 0.3 }), profile, false).rumble
    const fast = t.update(state({ speed: 80, signed_clearance: 0.3 }), profile, false).rumble
    expect(slow.effect).toBe('kerb')
    expect(slow.rateHz).toBeCloseTo(4) // 40 m/s over 10 m stripes
    expect(fast.rateHz).toBeCloseTo(8)
    expect(fast.strength).toBeGreaterThan(slow.strength)
    expect(fast.strength).toBeLessThanOrEqual(1)
  })

  it('surface beats slip; slip when on the track; nothing when crawling', () => {
    const t = new HapticsTracker()
    expect(t.update(state({ signed_clearance: 0.3, lockup: true }), profile, false).rumble.effect).toBe('kerb')
    expect(t.update(state({ lockup: true }), profile, false).rumble).toMatchObject({ effect: 'slip', strength: 0.7 })
    expect(t.update(state({ wheelspin: true }), profile, false).rumble).toMatchObject({ effect: 'slip', strength: 0.5 })
    expect(t.update(state({ speed: 1, signed_clearance: 0.3 }), profile, false).rumble.effect).toBe('none')
  })

  it('fires an impact once per new barrier contact, not on reset', () => {
    const t = new HapticsTracker()
    expect(t.update(state({ barrier_contacts: 2 }), profile, false).events).toEqual([]) // first sample: baseline
    const hit = t.update(state({ barrier_contacts: 3, speed: 30 }), profile, false).events
    expect(hit).toEqual([{ kind: 'impact', strength: expect.closeTo(1, 5) }])
    expect(t.update(state({ barrier_contacts: 3 }), profile, false).events).toEqual([])
    expect(t.update(state({ barrier_contacts: 0 }), profile, false).events).toEqual([]) // reset to grid
  })

  it('feels a hit at the speed before it (the wall stops the car dead)', () => {
    const t = new HapticsTracker()
    t.update(state({ speed: 12 }), profile, false)
    const [hit] = t.update(state({ speed: 0, barrier_contacts: 1 }), profile, false).events
    expect(hit.strength).toBeCloseTo(0.4 + 12 / 50)
  })

  it('knocks once for a scrape along the wall, but again for a harder hit or a later one', () => {
    const t = new HapticsTracker()
    t.update(state({ speed: 20 }), profile, false, 0)
    expect(t.update(state({ speed: 0, barrier_contacts: 1 }), profile, false, 50).events).toHaveLength(1)
    expect(t.update(state({ speed: 0, barrier_contacts: 2 }), profile, false, 100).events).toEqual([]) // scraping
    t.update(state({ speed: 45, barrier_contacts: 2 }), profile, false, 150)
    expect(t.update(state({ speed: 0, barrier_contacts: 3 }), profile, false, 200).events).toHaveLength(1) // harder
    t.update(state({ speed: 5, barrier_contacts: 3 }), profile, false, 250)
    expect(t.update(state({ speed: 0, barrier_contacts: 4 }), profile, false, 200 + IMPACT_REPEAT_MS).events).toHaveLength(1)
  })

  it('fires a warning jolt on the rising edge only', () => {
    const t = new HapticsTracker()
    expect(t.update(state(), profile, true).events.map((e) => e.kind)).toEqual(['warning'])
    expect(t.update(state(), profile, true).events).toEqual([])
    t.update(state(), profile, false)
    expect(t.update(state(), profile, true).events.map((e) => e.kind)).toEqual(['warning'])
  })
})

describe('warnedHazard', () => {
  it('matches by id or label, else the next hazard', () => {
    expect(warnedHazard(profile, 'Turn 1', null)?.id).toBe('c1')
    expect(warnedHazard(profile, 'c1', null)?.id).toBe('c1')
    expect(warnedHazard(profile, null, 'c1')?.id).toBe('c1')
    expect(warnedHazard(profile, 'nope', null)).toBeNull()
  })
})
