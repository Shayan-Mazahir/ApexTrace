import type { InputAdapter, RawInputSample } from '../InputAdapter'

const STEER_LEFT_KEYS = new Set(['ArrowLeft', 'a', 'A'])
const STEER_RIGHT_KEYS = new Set(['ArrowRight', 'd', 'D'])
const THROTTLE_KEYS = new Set(['ArrowUp', 'w', 'W'])
const BRAKE_KEYS = new Set(['ArrowDown', 's', 'S', ' '])

export function createKeyboardAdapter(): InputAdapter {
  const held = new Set<string>()

  const onKeyDown = (event: KeyboardEvent) => held.add(event.key)
  const onKeyUp = (event: KeyboardEvent) => held.delete(event.key)

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  const isAnyHeld = (keys: Set<string>) => [...held].some((key) => keys.has(key))

  return {
    id: 'keyboard',
    label: 'Keyboard',
    isAvailable: () => true,
    poll(): RawInputSample {
      const left = isAnyHeld(STEER_LEFT_KEYS)
      const right = isAnyHeld(STEER_RIGHT_KEYS)
      return {
        steeringRaw: left === right ? 0 : left ? -1 : 1,
        throttleRaw: isAnyHeld(THROTTLE_KEYS) ? 1 : 0,
        brakeRaw: isAnyHeld(BRAKE_KEYS) ? 1 : 0,
      }
    },
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    },
  }
}
