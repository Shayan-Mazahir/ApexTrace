import { describe, expect, it } from 'vitest'
import type { FaultSummary } from '../types/schemas'
import { upcomingFaults } from './FaultHeadsUp'

const fault = (id: string, state: FaultSummary['state'], starts_at_m: number | null) =>
  ({ id, type: 'grip_loss', target: 'world', source: 'preset', state, level: 0, description: '', parameters: {}, activations: 0, remaining_m: null, starts_at_m }) as FaultSummary

describe('upcomingFaults', () => {
  it('counts down to a fault starting ahead, only within the window', () => {
    const f = [fault('wet', 'pending', 900)]
    expect(upcomingFaults(f, 5793, 300)).toEqual([])
    expect(upcomingFaults(f, 5793, 600)[0].ahead).toBe(300)
  })
  it('wraps across the start/finish line and ignores active faults', () => {
    const f = [fault('a', 'waiting', 100), fault('b', 'active', 120)]
    const up = upcomingFaults(f, 5000, 5000 * 2 + 4800) // lap 3, 200 m before the line
    expect(up.map((x) => [x.f.id, x.ahead])).toEqual([['a', 300]])
  })
})
