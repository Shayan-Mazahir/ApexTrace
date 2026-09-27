import { describe, expect, it } from 'vitest'
import { FULL_LOCK_G, OneEuroFilter, responseCurve, tiltToSteering, WheelSteering } from './steeringShaping'

describe('tiltToSteering', () => {
  it('is linear in wheel angle, reaching full lock at the full-lock reading', () => {
    expect(tiltToSteering(0)).toBe(0)
    expect(tiltToSteering(FULL_LOCK_G)).toBeCloseTo(1)
    expect(tiltToSteering(-FULL_LOCK_G)).toBeCloseTo(-1)
    // half the angle of full lock (26.6 deg) is half the steering, not sin's ~0.56
    expect(tiltToSteering(Math.sin(Math.asin(FULL_LOCK_G) / 2))).toBeCloseTo(0.5)
    expect(tiltToSteering(1.4)).toBe(1)
    expect(tiltToSteering(Number.NaN)).toBe(0)
  })
})

describe('responseCurve', () => {
  it('softens the centre but keeps the ends and the sign', () => {
    expect(responseCurve(0)).toBe(0)
    expect(responseCurve(1)).toBe(1)
    expect(responseCurve(-1)).toBe(-1)
    expect(Math.abs(responseCurve(0.2))).toBeLessThan(0.2)
    expect(responseCurve(-0.5)).toBeCloseTo(-responseCurve(0.5))
  })
})

describe('OneEuroFilter', () => {
  const run = (f: OneEuroFilter, signal: (t: number) => number, seconds: number, hz = 30) => {
    const out: number[] = []
    for (let i = 0; i <= seconds * hz; i++) out.push(f.filter(signal(i / hz), i / hz))
    return out
  }

  it('removes rumble-rate shake while the wheel is held still', () => {
    // wheel held at 0.3, servos shaking the reading by +-0.08 at 12 Hz
    const out = run(new OneEuroFilter(), (t) => 0.3 + 0.08 * Math.sign(Math.sin(2 * Math.PI * 12 * t)), 3)
    const tail = out.slice(-30)
    expect(Math.max(...tail) - Math.min(...tail)).toBeLessThan(0.05) // was 0.16 peak to peak
    expect(tail.reduce((a, b) => a + b) / tail.length).toBeCloseTo(0.3, 1)
  })

  it('keeps up with a quick turn', () => {
    // a 0 -> 1 turn over 0.25 s: within 0.2 s of arriving, the output is nearly there
    const out = run(new OneEuroFilter(), (t) => Math.min(1, t / 0.25), 0.45)
    expect(out.at(-1)).toBeGreaterThan(0.9)
  })

  it('passes the first sample through and ignores repeated timestamps', () => {
    const f = new OneEuroFilter()
    expect(f.filter(0.7, 1)).toBe(0.7)
    expect(f.filter(0.1, 1)).toBe(0.7)
  })
})

describe('WheelSteering', () => {
  it('is steady at rest and never forwards NaN', () => {
    const w = new WheelSteering()
    expect(w.update(0, 0)).toBe(0)
    expect(w.update(Number.NaN, 0.03)).toBe(0)
  })
})
