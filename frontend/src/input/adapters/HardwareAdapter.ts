import type { InputAdapter, RawInputSample } from '../InputAdapter'

// Shape the ESP32/Pi Zero wheel will eventually push over WebSocket or
// serial. No transport is wired up yet — this just fixes the contract so
// the real adapter can be dropped in later without touching callers.
export interface HardwareInputMessage {
  source: 'esp32' | 'pi-zero'
  sequence: number
  timestamp: number
  steeringRaw: number
  throttleRaw: number
  brakeRaw: number
}

export function createHardwareAdapter(): InputAdapter {
  const latest: RawInputSample = { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0 }

  return {
    id: 'hardware',
    label: 'Hardware wheel (not connected)',
    isAvailable: () => false,
    poll(): RawInputSample {
      return latest
    },
  }
}
