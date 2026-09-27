import { describe, expect, it } from 'vitest'
import type { TrackProfile } from '../types/schemas'
import { computeRacingLine, lapTime } from './racingLine'
import type { Pt } from './trackGeometry'

// Stadium-shaped loop: two 300 m straights joined by R60 semicircles, 12 m wide.
function stadium(): TrackProfile {
  const center: Pt[] = []
  const left: Pt[] = []
  const right: Pt[] = []
  const R = 60
  const L = 300
  const w = 6
  const push = (x: number, y: number, nx: number, ny: number) => {
    center.push([x, y])
    left.push([x + nx * w, y + ny * w])
    right.push([x - nx * w, y - ny * w])
  }
  const arcSteps = 47 // pi * 60 / 47 ~= 4 m, so samples stay evenly spaced
  for (let k = 0; k < L / 4; k++) push(k * 4, 0, 0, 1)
  for (let k = 0; k < arcSteps; k++) {
    const a = -Math.PI / 2 + (k * Math.PI) / arcSteps
    push(L + R * Math.cos(a), R + R * Math.sin(a), -Math.cos(a), -Math.sin(a))
  }
  for (let k = 0; k < L / 4; k++) push(L - k * 4, 2 * R, 0, -1)
  for (let k = 0; k < arcSteps; k++) {
    const a = Math.PI / 2 + (k * Math.PI) / arcSteps
    push(R * Math.cos(a), R + R * Math.sin(a), -Math.cos(a), -Math.sin(a))
  }
  center.push(center[0])
  left.push(left[0])
  right.push(right[0])
  return {
    id: 'monza', name: 'stadium', seed: 0, track_width: 12, total_length: 0, barrier_offset: 4,
    start_finish: center[0], centerline: center, left_edge: left, right_edge: right, sectors: [], hazard_zones: [],
  }
}

describe('computeRacingLine', () => {
  const profile = stadium()
  const line = computeRacingLine(profile)

  it('is a closed loop with one point per centerline sample', () => {
    expect(line.points).toHaveLength(profile.centerline.length)
    expect(line.points[0]).toEqual(line.points[line.points.length - 1])
  })

  it('stays inside the track edges', () => {
    for (const o of line.offsets) expect(Math.abs(o)).toBeLessThanOrEqual(6 - 1.6 + 1e-9)
  })

  it('uses the track width: outside on entry and exit, inside at the apex', () => {
    // Corners turn left (anticlockwise), so the apex is on the left (+ offset).
    expect(line.offsets[75 + 23]).toBeGreaterThan(3) // apex of the first corner
    expect(line.offsets[70]).toBeLessThan(-2) // just before turn-in
    expect(line.offsets[75 + 47 + 5]).toBeLessThan(-2) // just after the exit
  })

  it('is faster around the lap than the centerline under the same car limits', () => {
    expect(lapTime(line.points)).toBeLessThan(lapTime(profile.centerline as Pt[]))
  })

  it('brakes before corners and accelerates out of them', () => {
    const approach = line.phase.slice(75 - 40, 75)
    expect(approach).toContain('brake')
    expect(line.phase[75 - 45]).toBe('throttle') // mid-straight
    expect(line.phase[75 + 47 + 5]).toBe('throttle')
  })
})
