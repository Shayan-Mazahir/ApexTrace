import type { InputAdapter, RawInputSample } from '../InputAdapter'
import { clamp } from '../normalize'
import { nextBackoffMs } from '../../stream/reconnect'

// Shape the ESP32 wheel pushes over WebSocket (via embedded-firmware/bridge.py,
// which reads the serial stream and re-broadcasts it as JSON).
export interface HardwareInputMessage {
  source: 'esp32' | 'pi-zero'
  sequence: number
  timestamp: number
  steeringRaw: number
  throttleRaw: number
  brakeRaw: number
  // HW-504 push-button (SW -> D25). Optional so firmware predating it still works.
  resetPressed?: boolean
}

export const BRIDGE_PORT = 8765

// Same host the page was served from, so the engineer's second device doesn't
// look for the bridge on its own localhost (mirrors api/config.ts). Set
// VITE_HARDWARE_WS_URL when the ESP32 is plugged into a different machine.
// Resolved lazily: read at module load this would make the module unimportable
// outside a browser.
export function bridgeUrl(): string {
  const override = import.meta.env.VITE_HARDWARE_WS_URL
  if (override) return override
  const host = typeof window === 'undefined' ? 'localhost' : window.location.hostname
  return `ws://${host}:${BRIDGE_PORT}`
}

// Full-lock reading from the averaged MPU pair, in g. The firmware reports
// gravity's projection on the wheel's Y axis (~±0.8 g at full lock), while
// normalize.ts assumes a device spanning ±1 — adapters convert into that
// shared convention, see InputAdapter.ts.
export const STEERING_FULL_SCALE = 0.8

// The firmware sends at 50 Hz (delay(20)). If samples stop arriving the last
// one must NOT be held: a frozen packet at full throttle would keep the car
// accelerating with the wheel unplugged.
export const STALE_AFTER_MS = 500

// The firmware hardcodes the HW-504 centre to 2048, but real sticks idle a
// little off that, which would read as permanent throttle or brake — the
// deadzone slider in the calibration panel only applies to steering.
const PEDAL_DEADZONE = 0.06

const AVAILABILITY_POLL_MS = 100

function pedal(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  const magnitude = clamp(raw, 0, 1)
  if (magnitude <= PEDAL_DEADZONE) return 0
  return (magnitude - PEDAL_DEADZONE) / (1 - PEDAL_DEADZONE)
}

function steering(raw: number): number {
  if (!Number.isFinite(raw)) return 0
  return clamp(raw / STEERING_FULL_SCALE, -1, 1)
}

/**
 * Live ESP32 wheel over the serial->WebSocket bridge.
 *
 * `onAvailabilityChange` matters: the socket opens (and goes stale) long after
 * the adapter is created, so the caller has to re-run its adapter choice when
 * availability flips — otherwise the hardware is passed over once at startup
 * and never looked at again.
 */
export function createHardwareAdapter(onAvailabilityChange?: () => void): InputAdapter {
  const latest: RawInputSample = { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0, resetPressed: false }
  let available = false
  // -Infinity, not 0: a real performance.now() can legitimately be 0, so 0 is
  // not usable as a "nothing received yet" sentinel.
  let lastMessageAt = Number.NEGATIVE_INFINITY
  let attempt = 0
  let socket: WebSocket | null = null
  let retry: ReturnType<typeof setTimeout> | undefined
  let disposed = false

  const fresh = () => performance.now() - lastMessageAt < STALE_AFTER_MS

  const refresh = () => {
    const next = socket?.readyState === WebSocket.OPEN && fresh()
    if (next === available) return
    available = next
    if (!available) {
      latest.steeringRaw = 0
      latest.throttleRaw = 0
      latest.brakeRaw = 0
      latest.resetPressed = false
    }
    onAvailabilityChange?.()
  }

  // Watches for the *stale* edge too, which no socket event reports.
  const watchdog = setInterval(refresh, AVAILABILITY_POLL_MS)

  function connect() {
    if (disposed) return
    const ws = new WebSocket(bridgeUrl())
    socket = ws

    ws.onopen = () => {
      if (disposed || socket !== ws) return
      attempt = 0
    }

    ws.onmessage = (event: MessageEvent<string>) => {
      if (disposed || socket !== ws) return
      try {
        const data = JSON.parse(event.data) as HardwareInputMessage
        latest.steeringRaw = steering(data.steeringRaw)
        latest.throttleRaw = pedal(data.throttleRaw)
        latest.brakeRaw = pedal(data.brakeRaw)
        latest.resetPressed = data.resetPressed === true
        lastMessageAt = performance.now()
        refresh()
      } catch {
        // malformed/torn line forwarded by the bridge — keep the last good sample
      }
    }

    ws.onclose = () => {
      if (disposed || socket !== ws) return
      refresh()
      // The bridge or the ESP32 may be restarted mid-session, so keep trying.
      retry = setTimeout(connect, nextBackoffMs(attempt++))
    }

    ws.onerror = () => {
      // onclose always follows, which schedules the retry above.
    }
  }

  connect()

  return {
    id: 'hardware',
    // A getter, not a snapshot: availability is decided after construction.
    get label() {
      return available ? 'ESP32 wheel' : 'ESP32 wheel (not connected)'
    },
    isAvailable: () => available,
    poll(): RawInputSample {
      // Never hand back a stale sample — see STALE_AFTER_MS.
      if (!available) return { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0, resetPressed: false }
      // A copy, not `latest` itself: the caller stores this in React state, and
      // handing back one object that is mutated in place would compare equal
      // every frame and suppress the re-render that moves the car.
      return { ...latest }
    },
    dispose() {
      disposed = true
      clearInterval(watchdog)
      clearTimeout(retry)
      if (socket) {
        socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null
        socket.close()
        socket = null
      }
    },
  }
}
