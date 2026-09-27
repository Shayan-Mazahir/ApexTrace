import { describe, expect, it } from 'vitest'
import { GhostRecorder } from './ghostLap'

// drives `seconds` of a lap along x at 50 m/s, sampled at 20 Hz
function lap(g: GhostRecorder, laps: number, seconds: number, speed = 50) {
  for (let i = 0; i <= seconds * 20; i++) {
    const t = i / 20
    g.push({ x: t * speed, y: 0, heading: 0, lap_time_s: t, laps_completed: laps, last_lap_s: null, last_lap_valid: null })
  }
}
const finish = (g: GhostRecorder, laps: number, time: number, valid = true) =>
  g.push({ x: 0, y: 0, heading: 0, lap_time_s: 0, laps_completed: laps, last_lap_s: time, last_lap_valid: valid })

describe('GhostRecorder', () => {
  it('keeps a finished valid lap and replays it by lap time', () => {
    const g = new GhostRecorder()
    lap(g, 0, 10)
    expect(g.poseAt(1)).toBeNull() // nothing finished yet
    finish(g, 1, 10)
    expect(g.best?.time).toBe(10)
    expect(g.poseAt(2.525)?.x).toBeCloseTo(126.25) // interpolated between samples
    expect(g.poseAt(11)).toBeNull() // past the end of the ghost's lap
  })

  it('only replaces the ghost with a faster valid lap', () => {
    const g = new GhostRecorder()
    lap(g, 0, 10)
    finish(g, 1, 10)
    lap(g, 1, 12, 40)
    finish(g, 2, 12) // slower
    expect(g.best?.time).toBe(10)
    lap(g, 2, 9, 60)
    finish(g, 3, 9, false) // faster but invalid (off track)
    expect(g.best?.time).toBe(10)
    lap(g, 3, 9, 60)
    finish(g, 4, 9)
    expect(g.best?.time).toBe(9)
    expect(g.poseAt(1)?.x).toBeCloseTo(60)
  })

  it('drops the partial lap on a reset to grid, keeping the full lap after it', () => {
    const g = new GhostRecorder()
    lap(g, 0, 5, 80) // 5 s in, then reset: the lap clock goes back to 0
    lap(g, 0, 10)
    finish(g, 1, 10)
    expect(g.best?.samples).toHaveLength(201) // only the lap driven after the reset
    expect(g.poseAt(4)?.x).toBeCloseTo(200) // 50 m/s, not the pre-reset 80 m/s
  })

  it('ignores a "lap" too short to be real', () => {
    const g = new GhostRecorder()
    lap(g, 0, 1)
    finish(g, 1, 1)
    expect(g.best).toBeNull()
  })
})
