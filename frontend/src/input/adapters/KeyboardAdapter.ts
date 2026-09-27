import type { ButtonId, InputAdapter, RawInputSample } from '../InputAdapter'

const STEER_LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A'])
const STEER_RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D'])
const THROTTLE_KEYS = new Set(['ArrowUp', 'w', 'W'])
const BRAKE_KEYS = new Set(['ArrowDown', 's', 'S', ' '])
export const BUTTON_KEYS: Record<ButtonId, string[]> = {
  shiftUp: ['e', 'E'],
  shiftDown: ['q', 'Q'],
  drs: ['f', 'F'],
  reverse: ['r', 'R'],
  ersCycle: ['b', 'B'],
  reset: [], // the ESP32 wheel's joystick press; on keyboard use the "Reset to grid" button
}

export function createKeyboardAdapter(): InputAdapter {
  const held = new Set<string>()

  const presses: Record<ButtonId, number> = { shiftUp: 0, shiftDown: 0, drs: 0, reverse: 0, ersCycle: 0, reset: 0 }
  const onKeyDown = (event: KeyboardEvent) => {
    held.add(event.key)
    if (event.repeat) return
    for (const id of Object.keys(BUTTON_KEYS) as ButtonId[]) {
      if (BUTTON_KEYS[id].includes(event.key)) presses[id] += 1
    }
  }
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.key)

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const isAnyHeld = (keys: Set<string>) => [...held].some((key) => keys.has(key))

  // Keys are on/off; ramp them so the car doesn't twitch at 300 km/h.
  let steering = 0
  let throttle = 0
  let brake = 0
  let last = performance.now()
  const approach = (value: number, target: number, rate: number, dt: number) => {
    const d = target - value
    return Math.abs(d) <= rate * dt ? target : value + Math.sign(d) * rate * dt
  }

  return {
    id: 'keyboard',
    label: 'Keyboard',
    isAvailable: () => true,
    poll(): RawInputSample {
      const now = performance.now()
      const dt = Math.min((now - last) / 1000, 0.1)
      last = now
      const left = isAnyHeld(STEER_LEFT_KEYS)
      const right = isAnyHeld(STEER_RIGHT_KEYS)
      const steerTarget = left === right ? 0 : left ? -1 : 1
      // turn in over ~0.35 s, centre faster
      steering = approach(steering, steerTarget, steerTarget === 0 ? 5 : 2.8, dt)
      throttle = approach(throttle, isAnyHeld(THROTTLE_KEYS) ? 1 : 0, 5, dt)
      brake = approach(brake, isAnyHeld(BRAKE_KEYS) ? 1 : 0, 8, dt)
      return { steeringRaw: steering, throttleRaw: throttle, brakeRaw: brake }
    },
    buttonPresses: () => ({ ...presses }),
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    },
  }
}
