// Every adapter (keyboard, gamepad/wheel, future hardware) reports raw axes
// in this shared native range: steering roughly [-1, 1], pedals roughly
// [0, 1]. Calibration/normalization (normalize.ts) is applied uniformly on
// top, so adapters stay dumb — they just read their device.
export interface RawInputSample {
  steeringRaw: number
  throttleRaw: number
  brakeRaw: number
}

export interface InputAdapter {
  id: string
  label: string
  isAvailable(): boolean
  poll(): RawInputSample
  dispose?(): void
}
