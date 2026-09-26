import { describe, expect, it } from 'vitest'
import type { TrackProfile } from '../types/schemas'
import { cornerMask, flatStrip, formatLapTime, leftNormals, offset, scatterProps, wallStrip } from './trackGeometry'

// A 400 m square loop, 10 m wide, with one "corner" hazard.
function squareTrack(): TrackProfile {
  const c: [number, number][] = []
  for (let i = 0; i < 25; i++) c.push([i * 4, 0])
  for (let i = 0; i < 25; i++) c.push([100, i * 4])
  for (let i = 0; i < 25; i++) c.push([100 - i * 4, 100])
  for (let i = 0; i < 25; i++) c.push([0, 100 - i * 4])
  c.push([0, 0])
  const n = c.length
  const normals = c.map((_, i) => {
    const a = c[(i - 1 + n - 1) % (n - 1)]
    const b = c[(i + 1) % (n - 1)]
    const dx = b[0] - a[0]
    const dy = b[1] - a[1]
    const l = Math.hypot(dx, dy)
    return [-dy / l, dx / l] as [number, number]
  })
  return {
    id: 'monza', name: 'test', seed: 1, track_width: 10, total_length: 400, start_finish: [0, 0],
    centerline: c,
    left_edge: c.map(([x, y], i) => [x + normals[i][0] * 5, y + normals[i][1] * 5]),
    right_edge: c.map(([x, y], i) => [x - normals[i][0] * 5, y - normals[i][1] * 5]),
    sectors: [],
    hazard_zones: [{ id: 't1', kind: 'braking_zone', label: 'T1', start_distance: 90, end_distance: 110, position: [100, 0], corner_speed: 20 }],
  }
}

describe('track geometry', () => {
  it('left normals are unit length and point at the left edge', () => {
    const p = squareTrack()
    const n = leftNormals(p)
    for (const [x, y] of n) expect(Math.hypot(x, y)).toBeCloseTo(1)
    const [ox, oy] = offset(p.centerline, n, 5, 1)[3]
    expect(ox).toBeCloseTo(p.left_edge[3][0])
    expect(oy).toBeCloseTo(p.left_edge[3][1])
  })

  it('builds one quad per included sample pair', () => {
    const p = squareTrack()
    const road = flatStrip(p.left_edge, p.right_edge, 0, () => [0, 0, 0])
    expect(road.indices.length).toBe((p.centerline.length - 1) * 6)
    expect(road.positions.length).toBe((p.centerline.length - 1) * 4 * 3)
    const half = flatStrip(p.left_edge, p.right_edge, 0, () => [0, 0, 0], (i) => i % 2 === 0)
    expect(half.indices.length).toBe(Math.ceil((p.centerline.length - 1) / 2) * 6)
  })

  it('walls span the requested heights', () => {
    const p = squareTrack()
    const w = wallStrip(p.left_edge, 0, 1.2, () => [1, 1, 1])
    const ys = new Set<number>()
    for (let i = 1; i < w.positions.length; i += 3) ys.add(Math.round(w.positions[i] * 100) / 100)
    expect([...ys].sort()).toEqual([0, 1.2])
  })

  it('marks kerb samples only around hazard zones', () => {
    const mask = cornerMask(squareTrack(), 10)
    expect(mask[25]).toBe(true) // 100 m, inside the corner
    expect(mask[5]).toBe(false) // 20 m, on the straight
  })

  it('never places scenery on or near the road, and is deterministic', () => {
    const p = squareTrack()
    const opts = { count: 40, minGap: 8, maxGap: 40, clearance: 15, seed: 7, minHeight: 5, maxHeight: 10 }
    const props = scatterProps(p, opts)
    expect(props.length).toBeGreaterThan(0)
    for (const pr of props) {
      const nearest = Math.min(...p.centerline.map(([x, y]) => Math.hypot(x - pr.x, y - pr.z)))
      expect(nearest).toBeGreaterThanOrEqual(15 - 4) // clearance checked on every other sample
    }
    expect(scatterProps(p, opts)).toEqual(props)
  })

  it('formats lap times like a timing screen', () => {
    expect(formatLapTime(83.4567)).toBe('1:23.457')
    expect(formatLapTime(9.5)).toBe('0:09.500')
    expect(formatLapTime(null)).toBe('—')
  })
})
