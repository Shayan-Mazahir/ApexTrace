import { describe, expect, it } from 'vitest'
import { LapDeltaTracker } from './lapDelta'

function driveLap(tracker: LapDeltaTracker, lap: number, speed: number, length = 1000) {
  for (let d = 0; d <= length; d += 10) tracker.update(lap, d, d / speed, null, null)
}

describe('LapDeltaTracker', () => {
  it('has no delta until a valid lap has been completed', () => {
    const t = new LapDeltaTracker()
    driveLap(t, 1, 50)
    expect(t.delta(500, 10)).toBeNull()
  })

  it('compares the current lap with the best lap at the same distance', () => {
    const t = new LapDeltaTracker()
    driveLap(t, 1, 50) // 20 s lap
    t.update(2, 0, 0, 20, true)
    expect(t.delta(500, 10.5)).toBeCloseTo(0.5) // best lap was at 500 m after 10 s
    expect(t.delta(500, 9.8)).toBeCloseTo(-0.2)
  })

  it('ignores invalid laps as a reference', () => {
    const t = new LapDeltaTracker()
    driveLap(t, 1, 100) // fast but invalid
    t.update(2, 0, 0, 10, false)
    expect(t.delta(500, 6)).toBeNull()
  })

  it('keeps the faster of two valid laps', () => {
    const t = new LapDeltaTracker()
    driveLap(t, 1, 50)
    t.update(2, 0, 0, 20, true)
    driveLap(t, 2, 40) // slower lap
    t.update(3, 0, 0, 25, true)
    expect(t.delta(500, 10)).toBeCloseTo(0) // still the 20 s lap
  })
})
