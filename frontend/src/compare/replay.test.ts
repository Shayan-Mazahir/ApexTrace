import { describe, expect, it } from 'vitest'
import type { ReplayFrame } from '../types/schemas'
import { advancePlayback, bands, firstTime, poseAt, runDuration, trailUpTo } from './replayMath'

const frame = (t: number, x: number, extra: Partial<ReplayFrame> = {}): ReplayFrame => ({
  t, x, y: 0, heading: 0, speed: x, throttle: 0, brake: 0, distance: x, clearance: 1,
  warning_active: false, track_exit: false, lap_complete: false, ...extra,
})
const frames = [frame(0, 0), frame(0.1, 10), frame(0.2, 20), frame(0.3, 30)]

describe('poseAt', () => {
  it('interpolates between recorded frames', () => {
    expect(poseAt(frames, 0.15)?.x).toBeCloseTo(15)
    expect(poseAt(frames, 0.25)?.speed).toBeCloseTo(25)
  })
  it('clamps before the start and after the end (a finished run stays put)', () => {
    expect(poseAt(frames, -1)?.x).toBe(0)
    expect(poseAt(frames, 99)?.x).toBe(30)
  })
  it('turns the short way round the heading wrap', () => {
    const wrapFrames = [frame(0, 0, { heading: Math.PI - 0.1 }), frame(1, 1, { heading: -Math.PI + 0.1 })]
    const h = poseAt(wrapFrames, 0.5)!.heading
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.01)
  })
  it('handles an empty run', () => {
    expect(poseAt([], 1)).toBeNull()
  })
})

describe('replay helpers', () => {
  it('builds the trail only up to the playhead', () => {
    expect(trailUpTo(frames, 0.2)).toHaveLength(3)
  })
  it('reports duration', () => {
    expect(runDuration(frames)).toBe(0.3)
    expect(runDuration([])).toBe(0)
  })
  it('finds warning bands, including one still open at the end', () => {
    const f = [frame(0, 0), frame(0.1, 1, { warning_active: true }), frame(0.2, 2, { warning_active: true }), frame(0.3, 3), frame(0.4, 4, { warning_active: true })]
    expect(bands(f, (x) => x.warning_active)).toEqual([{ start: 0.1, end: 0.3 }, { start: 0.4, end: 0.4 }])
  })
  it('finds the first matching time', () => {
    expect(firstTime([frame(0, 0), frame(0.1, 1, { brake: 1 })], (f) => f.brake > 0)).toBe(0.1)
    expect(firstTime(frames, (f) => f.brake > 0)).toBeNull()
  })
})

describe('advancePlayback', () => {
  it('advances by rate and clamps to the run', () => {
    expect(advancePlayback(1, 0.5, 2, 10)).toBe(2)
    expect(advancePlayback(9.9, 1, 1, 10)).toBe(10)
    expect(advancePlayback(0.1, -1, 1, 10)).toBe(0)
  })
})
