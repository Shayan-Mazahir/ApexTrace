import type { HapticEvent, Rumble, RumbleEffect } from '../../haptics/haptics'
import type { ButtonId, InputAdapter, RawInputSample } from '../InputAdapter'

const STEERING_AXIS = 0
const THROTTLE_BUTTON = 7 // right trigger, standard mapping
const BRAKE_BUTTON = 6 // left trigger, standard mapping
// Standard mapping: bumpers work as paddles on most wheels and pads. Partial:
// `reset` is left unmapped here (it is the ESP32 wheel's joystick press).
export const BUTTON_INDEX: Partial<Record<ButtonId, number>> = {
  shiftUp: 5, // RB / right paddle
  shiftDown: 4, // LB / left paddle
  drs: 0, // A / cross
  reverse: 2, // X / square
  ersCycle: 3, // Y / triangle
}

// Chrome/Edge expose Xbox-style pads' two motors as a 'dual-rumble' actuator:
// the strong (low-frequency, left) and weak (high-frequency, right) motor.
interface DualRumbleParams {
  duration: number
  strongMagnitude: number
  weakMagnitude: number
}
interface Actuator {
  playEffect?(type: 'dual-rumble', params: DualRumbleParams): Promise<unknown>
  reset?(): Promise<unknown>
}

// [strong, weak] per effect: kerbs are a sharp buzz (weak motor), run-off a
// heavy rumble (strong motor), wheel slip a light fizz.
const MOTORS: Record<Exclude<RumbleEffect, 'none'>, [number, number]> = {
  kerb: [0.35, 0.9],
  rough: [0.6, 0.35],
  slip: [0.12, 0.55],
}
// Longer than the 50 ms between states, so a steady rumble never gaps.
const HOLD_MS = 140
const IMPACT_MS = 380
const WARNING_PULSE_MS = 90
const WARNING_GAP_MS = 80

export function discoverGamepadIndex(): number | null {
  const pads = navigator.getGamepads?.() ?? []
  for (const pad of pads) {
    if (pad) return pad.index
  }
  return null
}

export function createGamepadAdapter(index: number): InputAdapter {
  const actuator = (): Actuator | null =>
    (navigator.getGamepads?.()[index] as (Gamepad & { vibrationActuator?: Actuator }) | null)?.vibrationActuator ?? null
  const play = (params: DualRumbleParams) => void actuator()?.playEffect?.('dual-rumble', params)?.catch(() => undefined)
  // A new effect replaces the one playing, so the 20 Hz rumble would cut a
  // jolt short: hold it off until the jolt is over.
  let busyUntil = 0
  let rumbling = false
  return {
    id: `gamepad-${index}`,
    label: 'Gamepad/Wheel',
    isAvailable: () => navigator.getGamepads?.()[index] != null,
    poll(): RawInputSample {
      const pad = navigator.getGamepads?.()[index]
      if (!pad) return { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0 }
      return {
        steeringRaw: pad.axes[STEERING_AXIS] ?? 0,
        throttleRaw: pad.buttons[THROTTLE_BUTTON]?.value ?? 0,
        brakeRaw: pad.buttons[BRAKE_BUTTON]?.value ?? 0,
      }
    },
    pollButtons(): ButtonId[] {
      const pad = navigator.getGamepads?.()[index]
      if (!pad) return []
      return (Object.entries(BUTTON_INDEX) as [ButtonId, number][])
        .filter(([, index]) => pad.buttons[index]?.pressed)
        .map(([id]) => id)
    },
    setRumble(rumble: Rumble) {
      if (performance.now() < busyUntil) return
      if (rumble.effect === 'none') {
        if (rumbling) void actuator()?.reset?.()?.catch(() => undefined)
        rumbling = false
        return
      }
      const [strong, weak] = MOTORS[rumble.effect]
      rumbling = true
      play({ duration: HOLD_MS, strongMagnitude: strong * rumble.strength, weakMagnitude: weak * rumble.strength })
    },
    hapticEvent(event: HapticEvent) {
      const s = event.strength
      if (event.kind === 'impact') {
        busyUntil = performance.now() + IMPACT_MS
        play({ duration: IMPACT_MS, strongMagnitude: s, weakMagnitude: s })
        return
      }
      // BRAKE warning: a double tap, like a pit-to-car call
      busyUntil = performance.now() + 2 * WARNING_PULSE_MS + WARNING_GAP_MS
      const tap = () => play({ duration: WARNING_PULSE_MS, strongMagnitude: 0.2 * s, weakMagnitude: s })
      tap()
      setTimeout(tap, WARNING_PULSE_MS + WARNING_GAP_MS)
    },
  }
}
