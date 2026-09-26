// Every adapter (keyboard, gamepad/wheel, future hardware) reports raw axes
// in this shared native range: steering roughly [-1, 1], pedals roughly
// [0, 1]. Calibration/normalization (normalize.ts) is applied uniformly on
// top, so adapters stay dumb — they just read their device.
export interface RawInputSample {
  steeringRaw: number
  throttleRaw: number
  brakeRaw: number
}

// Discrete car controls (gear shifts, active aero, reverse, battery mode).
export type ButtonId = 'shiftUp' | 'shiftDown' | 'drs' | 'reverse' | 'ersCycle'
export const BUTTON_IDS: ButtonId[] = ['shiftUp', 'shiftDown', 'drs', 'reverse', 'ersCycle']

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
  dispose?(): void
}
