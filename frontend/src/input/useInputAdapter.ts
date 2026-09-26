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

const IDLE_SAMPLE: RawInputSample = { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0 }

// Prefers a connected gamepad/wheel, falls back to keyboard. The hardware
// adapter is wired in but never auto-selected — it reports unavailable
// until a real ESP32/Pi transport exists.
export function useInputAdapter() {
  const { calibration, setCenter, setDeadzone } = useCalibration()
  const [source, setSource] = useState('Keyboard')
  const [raw, setRaw] = useState<RawInputSample>(IDLE_SAMPLE)
  const adapterRef = useRef<InputAdapter | null>(null)

  useEffect(() => {
    const keyboard = createKeyboardAdapter()
    const hardware = createHardwareAdapter()

    const pickAdapter = () => {
      const gamepadIndex = discoverGamepadIndex()
      const next =
        gamepadIndex != null
          ? createGamepadAdapter(gamepadIndex)
          : hardware.isAvailable()
            ? hardware
            : keyboard
      adapterRef.current = next
      setSource(next.label)
    }

    pickAdapter()
    window.addEventListener('gamepadconnected', pickAdapter)
    window.addEventListener('gamepaddisconnected', pickAdapter)

    let frame: number
    const tick = () => {
      setRaw(adapterRef.current?.poll() ?? IDLE_SAMPLE)
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)

    return () => {
      cancelAnimationFrame(frame)
      window.removeEventListener('gamepadconnected', pickAdapter)
      window.removeEventListener('gamepaddisconnected', pickAdapter)
      keyboard.dispose?.()
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
    calibration,
    setCenter: () => setCenter(raw.steeringRaw),
    setDeadzone,
  }
}
