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

export function discoverGamepadIndex(): number | null {
  const pads = navigator.getGamepads?.() ?? []
  for (const pad of pads) {
    if (pad) return pad.index
  }
  return null
}

export function createGamepadAdapter(index: number): InputAdapter {
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
  }
}
