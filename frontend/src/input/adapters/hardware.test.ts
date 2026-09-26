import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardwareInputMessage } from './HardwareAdapter'
import {
  createHardwareAdapter,
  RESET_RELEASE_DEBOUNCE_MS,
  STALE_AFTER_MS,
  STEERING_FULL_SCALE,
} from './HardwareAdapter'

class FakeSocket {
  static OPEN = 1
  static instances: FakeSocket[] = []
  readyState = 0
  onopen: (() => void) | null = null
  onmessage: ((e: MessageEvent<string>) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  closed = false
  url: string
  sent: string[] = []

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
  }

  send(data: string) {
    this.sent.push(data)
  }

  // feedback messages sent back to the bridge, parsed
  feedback() {
    return this.sent.map((m) => JSON.parse(m) as Record<string, unknown>)
  }

  close() {
    this.closed = true
    this.readyState = 3
  }

  open() {
    this.readyState = FakeSocket.OPEN
    this.onopen?.()
  }

  drop() {
    this.readyState = 3
    this.onclose?.()
  }

  emit(message: Partial<HardwareInputMessage>) {
    const full: HardwareInputMessage = {
      source: 'esp32',
      sequence: 1,
      timestamp: 0,
      steeringRaw: 0,
      throttleRaw: 0,
      brakeRaw: 0,
      ...message,
    }
    this.onmessage?.({ data: JSON.stringify(full) } as MessageEvent<string>)
  }
}

function harness() {
  const changes: number[] = []
  const adapter = createHardwareAdapter(() => changes.push(1))
  const socket = FakeSocket.instances.at(-1)!
  socket.open()
  return { adapter, socket, changes }
}

beforeEach(() => {
  FakeSocket.instances = []
  vi.stubGlobal('WebSocket', FakeSocket)
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('ESP32 hardware adapter', () => {
  it('is unavailable until a sample actually arrives', () => {
    const h = harness()
    expect(h.adapter.isAvailable()).toBe(false)
    expect(h.adapter.label).toContain('not connected')
    expect(h.adapter.poll()).toEqual({ steeringRaw: 0, throttleRaw: 0, brakeRaw: 0 })

    h.socket.emit({ steeringRaw: 0.4 })
    expect(h.adapter.isAvailable()).toBe(true)
    expect(h.adapter.label).toBe('ESP32 wheel')
    expect(h.changes).toHaveLength(1)
  })

  it('scales full lock to the ±1 convention normalize.ts expects', () => {
    const h = harness()
    h.socket.emit({ steeringRaw: STEERING_FULL_SCALE })
    expect(h.adapter.poll().steeringRaw).toBeCloseTo(1)

    h.socket.emit({ steeringRaw: -STEERING_FULL_SCALE })
    expect(h.adapter.poll().steeringRaw).toBeCloseTo(-1)

    // past the measured full-lock reading it clamps rather than exceeding 1
    h.socket.emit({ steeringRaw: 1.5 })
    expect(h.adapter.poll().steeringRaw).toBe(1)
  })

  it('treats a resting joystick as no pedal input', () => {
    const h = harness()
    h.socket.emit({ throttleRaw: 0.03, brakeRaw: 0.02 }) // idle offset, not a request
    expect(h.adapter.poll().throttleRaw).toBe(0)
    expect(h.adapter.poll().brakeRaw).toBe(0)

    h.socket.emit({ throttleRaw: 1, brakeRaw: 1 }) // full press still reaches full
    expect(h.adapter.poll().throttleRaw).toBeCloseTo(1)
    expect(h.adapter.poll().brakeRaw).toBeCloseTo(1)
  })

  it('drops to zero when samples stop, instead of holding the last one', () => {
    const h = harness()
    h.socket.emit({ steeringRaw: 0.8, throttleRaw: 1 })
    expect(h.adapter.poll().throttleRaw).toBeCloseTo(1)

    // the wheel is unplugged: a held full-throttle sample must not persist
    vi.advanceTimersByTime(STALE_AFTER_MS + 100)
    expect(h.adapter.isAvailable()).toBe(false)
    expect(h.adapter.poll()).toEqual({ steeringRaw: 0, throttleRaw: 0, brakeRaw: 0 })
    expect(h.changes).toHaveLength(2) // became available, then went stale
  })

  it('ignores a malformed or non-numeric sample', () => {
    const h = harness()
    h.socket.emit({ steeringRaw: 0.4 })
    h.socket.onmessage?.({ data: 'not json' } as MessageEvent<string>)
    expect(h.adapter.poll().steeringRaw).toBeCloseTo(0.5) // last good sample kept

    h.socket.emit({ steeringRaw: NaN as unknown as number })
    expect(h.adapter.poll().steeringRaw).toBe(0) // never forwards NaN to the backend
  })

  it('reports the joystick press as the reset button, and releases it', () => {
    const h = harness()
    expect(h.adapter.pollButtons?.()).toEqual([])

    h.socket.emit({ resetPressed: true })
    expect(h.adapter.pollButtons?.()).toEqual(['reset'])

    // released: held briefly for the debounce, then let go
    h.socket.emit({ resetPressed: false })
    expect(h.adapter.pollButtons?.()).toEqual(['reset'])
    vi.advanceTimersByTime(RESET_RELEASE_DEBOUNCE_MS + 20)
    h.socket.emit({ resetPressed: false })
    expect(h.adapter.pollButtons?.()).toEqual([])
  })

  it('merges contact bounce into one press, as the edge counter sees it', () => {
    const h = harness()
    // Count rising edges the way useInputAdapter does, sampling every 20 ms.
    let held = false
    let edges = 0
    const sample = () => {
      const now = h.adapter.pollButtons?.().includes('reset') ?? false
      if (now && !held) edges += 1
      held = now
    }
    // press, a 40 ms bounce open, pressed again, then a real release
    for (const pressed of [true, true, false, false, true, true, true, false]) {
      h.socket.emit({ resetPressed: pressed })
      sample()
      vi.advanceTimersByTime(20)
    }
    vi.advanceTimersByTime(RESET_RELEASE_DEBOUNCE_MS)
    h.socket.emit({ resetPressed: false })
    sample()
    expect(edges).toBe(1)
    expect(held).toBe(false)

    // a genuine second press after that still counts
    h.socket.emit({ resetPressed: true })
    sample()
    expect(edges).toBe(2)
  })

  it('never holds reset from old firmware or a wheel that went away', () => {
    const h = harness()
    // firmware predating the button omits the field entirely
    h.socket.emit({ steeringRaw: 0.4 })
    expect(h.adapter.pollButtons?.()).toEqual([])

    // a stale "pressed" must not survive the wheel being unplugged
    h.socket.emit({ resetPressed: true })
    vi.advanceTimersByTime(STALE_AFTER_MS + 100)
    expect(h.adapter.pollButtons?.()).toEqual([])
  })

  it('hands back a fresh object each poll, so React sees the change', () => {
    const h = harness()
    h.socket.emit({ steeringRaw: 0.4 })
    const first = h.adapter.poll()
    h.socket.emit({ steeringRaw: 0.8 })
    const second = h.adapter.poll()
    expect(second).not.toBe(first) // not one mutated object handed out twice
    expect(first.steeringRaw).not.toBe(second.steeringRaw)
  })

  describe('feedback to the wheel screen', () => {
    const live = { active: true, session: 'connected', warning: 'clear', speedKmh: 283 } as const

    it('reports the state as soon as the bridge connects', () => {
      const h = harness()
      expect(h.socket.feedback()).toEqual([
        { type: 'feedback', active: false, session: 'none', warning: 'clear', speed_kmh: null },
      ])
    })

    it('sends nothing while the bridge socket is not open', () => {
      createHardwareAdapter().setFeedback?.(live)
      const socket = FakeSocket.instances.at(-1)!
      vi.advanceTimersByTime(1000)
      expect(socket.sent).toEqual([]) // never opened: no bridge to talk to
    })

    it('sends a BRAKE warning immediately, not on the next heartbeat', () => {
      const h = harness()
      h.adapter.setFeedback?.(live)
      const before = h.socket.sent.length
      h.adapter.setFeedback?.({ ...live, warning: 'brake' })
      expect(h.socket.sent.length).toBe(before + 1) // synchronously, no timer involved
      expect(h.socket.feedback().at(-1)).toMatchObject({ warning: 'brake', active: true, session: 'connected' })
    })

    it('lets speed ride the 10 Hz heartbeat instead of sending on every change', () => {
      const h = harness()
      h.adapter.setFeedback?.(live)
      const before = h.socket.sent.length
      h.adapter.setFeedback?.({ ...live, speedKmh: 284.4 })
      h.adapter.setFeedback?.({ ...live, speedKmh: 285.6 })
      expect(h.socket.sent.length).toBe(before) // speed alone: nothing sent yet

      vi.advanceTimersByTime(100)
      expect(h.socket.feedback().at(-1)).toMatchObject({ speed_kmh: 286 }) // rounded, latest value
    })

    it('keeps a 10 Hz heartbeat while the bridge is connected', () => {
      const h = harness()
      h.adapter.setFeedback?.(live)
      const before = h.socket.sent.length
      vi.advanceTimersByTime(1000)
      expect(h.socket.sent.length - before).toBe(10)
    })

    it('stops talking once the bridge goes away', () => {
      const h = harness()
      h.socket.drop()
      const before = h.socket.sent.length
      h.adapter.setFeedback?.({ ...live, warning: 'brake' })
      vi.advanceTimersByTime(300) // shorter than the first reconnect backoff
      expect(h.socket.sent.length).toBe(before)
    })
  })

  it('reconnects when the bridge restarts, and dispose() stops everything', () => {
    const h = harness()
    h.socket.drop()
    vi.advanceTimersByTime(600)
    expect(FakeSocket.instances).toHaveLength(2)

    const replacement = FakeSocket.instances[1]
    replacement.open()
    replacement.emit({ steeringRaw: 0.4 })
    expect(h.adapter.isAvailable()).toBe(true)

    h.adapter.dispose?.()
    expect(replacement.closed).toBe(true)
    replacement.drop()
    vi.advanceTimersByTime(10_000)
    expect(FakeSocket.instances).toHaveLength(2) // no zombie retry loop
  })
})
