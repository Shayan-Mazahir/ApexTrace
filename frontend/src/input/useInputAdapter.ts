import { useEffect, useRef, useState } from 'react'
import { createGamepadAdapter, discoverGamepadIndex } from './adapters/GamepadAdapter'
import { createHardwareAdapter } from './adapters/HardwareAdapter'
import { createKeyboardAdapter } from './adapters/KeyboardAdapter'
import type { InputAdapter, RawInputSample } from './InputAdapter'
import { normalizePedal, normalizeSteering } from './normalize'
import { useCalibration } from './useCalibration'

export interface NormalizedControls {
  steering: number
  throttle: number
  brake: number
}

const IDLE_SAMPLE: RawInputSample = { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0, resetPressed: false }

// Mechanical switches bounce, and a button held down reports pressed on every
// frame; ignore further presses this soon after an accepted one.
const RESET_LOCKOUT_MS = 400

// Prefers a connected gamepad/wheel, then the ESP32 wheel over the bridge,
// then keyboard. The ESP32's socket opens (and can go stale) after mount, so
// the adapter choice is re-run whenever its availability changes — without
// that, hardware is passed over once at startup and never reconsidered.
export function useInputAdapter() {
  const { calibration, setCenter, setDeadzone } = useCalibration()
  const [source, setSource] = useState('Keyboard')
  const [raw, setRaw] = useState<RawInputSample>(IDLE_SAMPLE)
  // Increments once per physical press of the device's reset button. A counter
  // rather than a boolean, so a consumer's effect fires on every press instead
  // of only on the first transition to true.
  const [resetRequests, setResetRequests] = useState(0)
  const adapterRef = useRef<InputAdapter | null>(null)
  const resetHeldRef = useRef(false)
  const lastResetAtRef = useRef(0)

  useEffect(() => {
    const keyboard = createKeyboardAdapter()
    // Assigned just below; pickAdapter is passed *into* the hardware adapter as
    // its availability callback, so it has to be defined first.
    let hardware: InputAdapter | null = null

    const pickAdapter = () => {
      const gamepadIndex = discoverGamepadIndex()
      const next =
        gamepadIndex != null
          ? createGamepadAdapter(gamepadIndex)
          : hardware?.isAvailable()
            ? hardware
            : keyboard
      adapterRef.current = next
      setSource(next.label)
    }

    hardware = createHardwareAdapter(pickAdapter)

    pickAdapter()
    window.addEventListener('gamepadconnected', pickAdapter)
    window.addEventListener('gamepaddisconnected', pickAdapter)

    let frame: number
    const tick = () => {
      const sample = adapterRef.current?.poll() ?? IDLE_SAMPLE
      setRaw(sample)

      // Rising edge only: hold the button and the car resets once, not 60x/s.
      const pressed = sample.resetPressed === true
      const now = performance.now()
      if (pressed && !resetHeldRef.current && now - lastResetAtRef.current > RESET_LOCKOUT_MS) {
        lastResetAtRef.current = now
        setResetRequests((n) => n + 1)
      }
      resetHeldRef.current = pressed

      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('gamepadconnected', pickAdapter)
      window.removeEventListener('gamepaddisconnected', pickAdapter)
      keyboard.dispose?.()
      hardware?.dispose?.()
    }
  }, [])

  const normalized: NormalizedControls = {
    steering: normalizeSteering(raw.steeringRaw, calibration.center, calibration.deadzone),
    throttle: normalizePedal(raw.throttleRaw),
    brake: normalizePedal(raw.brakeRaw),
  }

  return {
    source,
    raw,
    normalized,
    resetRequests,
    calibration,
    setCenter: () => setCenter(raw.steeringRaw),
    setDeadzone,
  }
}
