import { describe, expect, it } from 'vitest'
import { PoseBuffer, RENDER_DELAY_S } from './poseBuffer'

describe('PoseBuffer', () => {
  it('renders between server samples, delayed, and stays smooth when packets bunch up', () => {
    const b = new PoseBuffer()
    for (let i = 0; i <= 10; i++) b.push({ t: i * 0.05, x: i * 4, y: 0, heading: 0 }) // 80 m/s
    const p = b.sample(0)!
    expect(p.t).toBeCloseTo(0.5 - RENDER_DELAY_S)
    expect(p.x).toBeCloseTo((0.5 - RENDER_DELAY_S) * 80)
    // a 150 ms gap with no packets: the render clock keeps moving, extrapolating briefly
    const xs = [0, 1, 2, 3, 4, 5].map(() => b.sample(1 / 60)!.x)
    for (let i = 1; i < xs.length; i++) expect(xs[i]).toBeGreaterThan(xs[i - 1])
  })
  it('interpolates heading across the +/-pi seam the short way', () => {
    const b = new PoseBuffer()
    b.push({ t: 0, x: 0, y: 0, heading: Math.PI - 0.1 })
    b.push({ t: 0.05, x: 0, y: 0, heading: -Math.PI + 0.1 })
    b.push({ t: 0.15, x: 0, y: 0, heading: -Math.PI + 0.1 })
    const h = b.sample(0)!.heading // t = 0.05
    expect(Math.abs(Math.abs(h) - Math.PI)).toBeLessThan(0.11)
  })
  it('resets when the run restarts (server time goes backwards)', () => {
    const b = new PoseBuffer()
    for (let i = 0; i < 50; i++) b.push({ t: i * 0.05, x: i, y: 0, heading: 0 })
    b.push({ t: 0.05, x: 999, y: 0, heading: 0 })
    expect(b.sample(0)!.x).toBe(999)
  })
})
