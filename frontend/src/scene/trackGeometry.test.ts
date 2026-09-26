import { describe, expect, it } from 'vitest'
import type { TrackProfile } from '../types/schemas'
import { cornerMask, flatStrip, formatLapTime, grandstandSpan, leftNormals, offset, scatterProps, wallStrip } from './trackGeometry'

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
    id: 'monza', name: 'test', seed: 1, track_width: 10, total_length: 400, barrier_offset: 2, start_finish: [0, 0],
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

  it('keeps a prop\'s whole footprint, not just its centre, clear of the road', () => {
    const p = squareTrack()
    const footprint = 13
    const props = scatterProps(p, { count: 40, minGap: 8, maxGap: 60, clearance: 10, seed: 3, minHeight: 5, maxHeight: 10, footprint })
    expect(props.length).toBeGreaterThan(0)
    for (const pr of props) {
      const nearest = Math.min(...p.centerline.map(([x, y]) => Math.hypot(x - pr.x, y - pr.z)))
      expect(nearest - footprint).toBeGreaterThanOrEqual(10) // every sample is checked when a footprint is set
    }
  })

  it('stops the start grandstands before the first corner', () => {
    // The square's first straight runs 0-100 m; its corner hazard is moved to 150 m.
    const p = { ...squareTrack(), total_length: 400 }
    p.hazard_zones = [{ ...p.hazard_zones[0], start_distance: 150, end_distance: 170 }]
    for (const side of [1, -1] as const) {
      const span = grandstandSpan(p, 10, 300, side)
      expect(span).not.toBeNull()
      expect(span!.to).toBeLessThanOrEqual(100) // never past the end of the straight
      expect(span!.to - span!.from).toBeGreaterThanOrEqual(60)
    }
  })

  it('draws no grandstand when there is no long enough straight', () => {
    const p = squareTrack() // corner hazard at 90 m: only 40 m of straight before it
    expect(grandstandSpan(p, 10, 300, 1)).toBeNull()
  })

  it('formats lap times like a timing screen', () => {
    expect(formatLapTime(83.4567)).toBe('1:23.457')
    expect(formatLapTime(9.5)).toBe('0:09.500')
    expect(formatLapTime(null)).toBe('—')
  })
})

import { indexAt, uvFlat, uvWall } from './trackGeometry'

describe('uv strips', () => {
  it('tiles u along distance so textures do not stretch', () => {
    const line: [number, number][] = [[0, 0], [10, 0], [20, 0]]
    const w = uvWall(line, 0, 1, 10)
    const us = [...w.uvs].filter((_, i) => i % 2 === 0)
    expect(Math.max(...us)).toBeCloseTo(2) // 20 m / 10 m per repeat
    expect(w.indices).toHaveLength(12)
    const f = uvFlat(line, line.map(([x]) => [x, 5] as [number, number]), 0, 5, 1)
    expect(Math.max(...[...f.uvs].filter((_, i) => i % 2 === 0))).toBeCloseTo(4)
  })

  it('maps lap distance to a sample index, wrapping', () => {
    const c: [number, number][] = Array.from({ length: 101 }, (_, i) => [i, 0] as [number, number])
    const p = { centerline: c, total_length: 100 } as unknown as import('../types/schemas').TrackProfile
    expect(indexAt(p, 25)).toBe(25)
    expect(indexAt(p, 125)).toBe(25)
    expect(indexAt(p, -10)).toBe(90)
  })
})
