// Every adapter (keyboard, gamepad/wheel, future hardware) reports raw axes
// in this shared native range: steering roughly [-1, 1], pedals roughly
// [0, 1]. Calibration/normalization (normalize.ts) is applied uniformly on
// top, so adapters stay dumb — they just read their device.
export interface RawInputSample {
  steeringRaw: number
  throttleRaw: number
  brakeRaw: number
}

// Discrete car controls (gear shifts, active aero, reverse, battery mode) and
// `reset`, which puts the car back on the grid like the "Reset to grid" button
// (only the ESP32 wheel has one; keyboard and gamepad leave it unmapped).
export type ButtonId = 'shiftUp' | 'shiftDown' | 'drs' | 'reverse' | 'ersCycle' | 'reset'
export const BUTTON_IDS: ButtonId[] = ['shiftUp', 'shiftDown', 'drs', 'reverse', 'ersCycle', 'reset']

// What the game tells an input device about itself, for devices that can show
// it (the ESP32 wheel's screen). Sent back over the device's own link;
// devices without one simply don't implement setFeedback.
export interface DeviceFeedback {
  active: boolean // the car is being driven with THIS device
  session: 'none' | 'connecting' | 'reconnecting' | 'connected'
  warning: 'clear' | 'brake' | 'stale'
  speedKmh: number | null
}

export interface InputAdapter {
  id: string
  label: string
  isAvailable(): boolean
  poll(): RawInputSample
  // buttons currently held down (polled; fine for pads, whose presses last several frames)
  pollButtons?(): ButtonId[]
  // running totals of presses counted from device events (keyboard), so a
  // tap shorter than a frame is never missed
  buttonPresses?(): Record<ButtonId, number>
  // latest game state for the device to display; the adapter decides when to send it
  setFeedback?(feedback: DeviceFeedback): void
  dispose?(): void
}
