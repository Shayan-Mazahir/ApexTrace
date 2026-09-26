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
    dispose() {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
    },
  }
}
