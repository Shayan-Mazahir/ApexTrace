import { describe, expect, it } from 'vitest'
import { DEMO_STEPS, DEMO_TOTAL_SECONDS, locate, stepStart } from './steps'
import { preflightVerdict, runPreflight, type PreflightDeps } from './preflight'

describe('demo timeline', () => {
  it('is the brief\'s three minutes, in the brief\'s order', () => {
    expect(DEMO_TOTAL_SECONDS).toBe(180)
    expect(DEMO_STEPS.map((s) => [s.id, s.seconds])).toEqual([
      ['brief', 15], ['drive', 30], ['inspect', 30], ['choose', 30], ['retest', 45], ['decide', 30],
    ])
  })
  it('locates the step for an elapsed time', () => {
    expect(locate(0)).toEqual({ index: 0, into: 0, done: false })
    expect(locate(14.9).index).toBe(0)
    expect(locate(15).index).toBe(1)
    expect(locate(stepStart(4) + 1).index).toBe(4)
    expect(locate(180).done).toBe(true)
    expect(locate(999).index).toBe(DEMO_STEPS.length - 1)
  })
})

class FakeSocket {
  onmessage: ((e: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  constructor(mode: 'ok' | 'silent') {
    if (mode === 'ok') setTimeout(() => this.onmessage?.({ data: JSON.stringify({ type: 'vehicle_state' }) }), 1)
  }
  close() { this.closed = true }
}

function deps(overrides: Partial<PreflightDeps> & { socket?: 'ok' | 'silent' } = {}): PreflightDeps {
  return {
    apiBase: 'http://x',
    timeoutMs: 30,
    gamepads: () => [null],
    openSocket: () => new FakeSocket(overrides.socket ?? 'ok') as unknown as WebSocket,
    fetchJson: async (url) => {
      if (url.endsWith('/health')) return { status: 'ok' }
      if (url.endsWith('/scenarios')) return ['monza_wet_braking', 'monza_fade_stale_speed', 'baku_sensor_freeze', 'baku_late_warning_delivery'].map((id) => ({ id }))
      if (url.endsWith('/upgrades')) return { upgrades: [1, 2, 3], configs: new Array(8).fill(0) }
      if (url.endsWith('/evaluation/run')) return { configs: new Array(8).fill(0), suite: { tests: new Array(36).fill(0) } }
      if (url.endsWith('/sessions')) return { session_id: 's1' }
      if (url.endsWith('/backup-replay.json')) return { baseline: { frames: [1, 2] } }
      throw new Error(`unexpected ${url}`)
    },
    ...overrides,
  }
}

describe('runPreflight', () => {
  it('passes with only a keyboard warning when everything is up', async () => {
    const checks = await runPreflight(deps())
    expect(checks.map((c) => c.status)).toEqual(['ok', 'ok', 'ok', 'ok', 'ok', 'warn', 'ok'])
    expect(preflightVerdict(checks)).toBe('warn')
  })
  it('fails loudly when the backend is down, without throwing', async () => {
    const down = deps({ fetchJson: async () => { throw new Error('connection refused') } })
    const checks = await runPreflight(down)
    expect(checks.filter((c) => c.status === 'fail').length).toBeGreaterThanOrEqual(5)
    expect(preflightVerdict(checks)).toBe('fail')
    expect(checks[0].detail).toContain('connection refused')
  })
  it('fails the live check when no telemetry arrives', async () => {
    const checks = await runPreflight(deps({ socket: 'silent' }))
    expect(checks.find((c) => c.id === 'live')?.status).toBe('fail')
  })
  it('reports a detected wheel as ok', async () => {
    const pad = { id: 'Logitech G29' } as Gamepad
    const checks = await runPreflight(deps({ gamepads: () => [pad] }))
    expect(checks.find((c) => c.id === 'input')?.status).toBe('ok')
  })
})
