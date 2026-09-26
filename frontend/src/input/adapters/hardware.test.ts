import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { HardwareInputMessage } from './HardwareAdapter'
import { createHardwareAdapter, STALE_AFTER_MS, STEERING_FULL_SCALE } from './HardwareAdapter'

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

  constructor(url: string) {
    this.url = url
    FakeSocket.instances.push(this)
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
    expect(h.adapter.poll()).toEqual({ steeringRaw: 0, throttleRaw: 0, brakeRaw: 0, resetPressed: false })

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
    expect(h.adapter.poll()).toEqual({ steeringRaw: 0, throttleRaw: 0, brakeRaw: 0, resetPressed: false })
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

  it('reports the reset button, and forgets it when the wheel goes away', () => {
    const h = harness()
    h.socket.emit({ resetPressed: true })
    expect(h.adapter.poll().resetPressed).toBe(true)

    h.socket.emit({ resetPressed: false })
    expect(h.adapter.poll().resetPressed).toBe(false)

    // firmware predating the button omits the field entirely
    h.socket.emit({ steeringRaw: 0.4 })
    expect(h.adapter.poll().resetPressed).toBe(false)

    // a stale "pressed" must not survive the wheel being unplugged
    h.socket.emit({ resetPressed: true })
    vi.advanceTimersByTime(STALE_AFTER_MS + 100)
    expect(h.adapter.poll().resetPressed).toBe(false)
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
