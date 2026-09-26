import { describe, expect, it } from 'vitest'
import { classifyConnection } from './connectionQuality'
import { appendFaultEvent, faultWindows, MAX_FAULT_EVENTS } from './faultTimeline'
import { nextBackoffMs } from './reconnect'
import { applyWarningEvent, INITIAL_WARNING } from './warningState'
import type { FaultEventMessage, WarningEventMessage } from '../types/schemas'

const warning = (seq: number, active: boolean, zone = 'Turn 1'): WarningEventMessage => ({
  type: 'warning_event',
  seq,
  active,
  state: active ? 'brake' : 'clear',
  source: 'remote',
  data_age_ms: 20,
  generated_t: 0,
  displayed_t: 0,
  reason: active ? `Approaching ${zone}` : null,
  hazard_zone: active ? zone : null,
  hazard_id: active ? 'turn1' : null,
  advised_speed: active ? 19 : null,
  source_t: 0,
})

describe('applyWarningEvent', () => {
  it('accepts newer events and clears on inactive', () => {
    const on = applyWarningEvent(INITIAL_WARNING, warning(1, true), 1000)
    expect(on).toMatchObject({ active: true, lastSeq: 1, since: 1000 })
    const off = applyWarningEvent(on, warning(2, false), 1500)
    expect(off).toMatchObject({ active: false, lastSeq: 2, since: null })
  })

  it('ignores stale and out-of-order events', () => {
    const on = applyWarningEvent(INITIAL_WARNING, warning(5, true), 1000)
    // a late "inactive" from before the activation must not clear it
    expect(applyWarningEvent(on, warning(4, false), 1100)).toBe(on)
    // duplicates are ignored too
    expect(applyWarningEvent(on, warning(5, false), 1100)).toBe(on)
  })

  it('keeps the original start time when the same hazard is re-announced', () => {
    const first = applyWarningEvent(INITIAL_WARNING, warning(1, true), 1000)
    expect(applyWarningEvent(first, warning(2, true), 2000).since).toBe(1000)
    expect(applyWarningEvent(first, warning(2, true, 'Turn 2'), 2000).since).toBe(2000)
  })
})

describe('stale warnings', () => {
  it('shows a stale caution (not BRAKE) and keeps its start time', () => {
    const stale = { ...warning(3, false), state: 'stale' as const, reason: 'Telemetry stale' }
    const s1 = applyWarningEvent(INITIAL_WARNING, stale, 1000)
    expect(s1).toMatchObject({ active: false, stale: true, since: 1000, reason: 'Telemetry stale' })
    const s2 = applyWarningEvent(s1, { ...stale, seq: 4 }, 2000)
    expect(s2.since).toBe(1000)
    const brake = applyWarningEvent(s2, warning(5, true), 3000)
    expect(brake).toMatchObject({ active: true, stale: false })
  })
})

describe('classifyConnection', () => {
  it('is offline when disconnected', () => {
    expect(classifyConnection({ connected: false, msSinceLastMessage: 0, packetAgeMs: 0 }).level).toBe(
      'offline',
    )
  })
  it('grades by measured packet age', () => {
    const level = (age: number) =>
      classifyConnection({ connected: true, msSinceLastMessage: 50, packetAgeMs: age }).level
    expect([level(0), level(150), level(400)]).toEqual(['good', 'degraded', 'poor'])
  })
  it('is poor when the stream goes silent', () => {
    expect(classifyConnection({ connected: true, msSinceLastMessage: 5000, packetAgeMs: 0 }).level).toBe(
      'poor',
    )
  })
})

describe('nextBackoffMs', () => {
  it('doubles and caps', () => {
    expect([0, 1, 2, 3, 10].map(nextBackoffMs)).toEqual([500, 1000, 2000, 4000, 5000])
  })
})

describe('appendFaultEvent', () => {
  const ev = (d: number): FaultEventMessage => ({
    type: 'fault_event', event: 'fault_activated', t: d, distance: d, fault_id: `f${d}`, fault_type: 'grip_loss',
    target: 'world', source: 'manual', description: '',
  })
  it('caps the history', () => {
    let events: FaultEventMessage[] = []
    for (let i = 0; i < MAX_FAULT_EVENTS + 10; i++) events = appendFaultEvent(events, ev(i))
    expect(events).toHaveLength(MAX_FAULT_EVENTS)
    expect(events[events.length - 1].distance).toBe(MAX_FAULT_EVENTS + 9)
  })
  it('pairs activations with deactivations into windows', () => {
    const on = ev(100)
    const off: FaultEventMessage = { ...on, event: 'fault_deactivated', distance: 250 }
    expect(faultWindows([on, off, ev(400)], 1000)).toEqual([
      { id: 'f100', target: 'world', start: 100, end: 250 },
      { id: 'f400', target: 'world', start: 400, end: null },
    ])
  })
})
