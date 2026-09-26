import { useEffect, useRef, useState } from 'react'
import { createGamepadAdapter, discoverGamepadIndex } from './adapters/GamepadAdapter'
import { createHardwareAdapter } from './adapters/HardwareAdapter'
import { createKeyboardAdapter } from './adapters/KeyboardAdapter'
import { BUTTON_IDS, type ButtonId, type InputAdapter, type RawInputSample } from './InputAdapter'
import { normalizePedal, normalizeSteering } from './normalize'
import { useCalibration } from './useCalibration'

export interface NormalizedControls {
  steering: number
  throttle: number
  brake: number
}

const IDLE_SAMPLE: RawInputSample = { steeringRaw: 0, throttleRaw: 0, brakeRaw: 0 }

export type ButtonCounts = Record<ButtonId, number>
const ZERO_COUNTS = (): ButtonCounts => ({ shiftUp: 0, shiftDown: 0, drs: 0, reverse: 0, ersCycle: 0, reset: 0 })

// Prefers a connected gamepad/wheel, then the ESP32 wheel over the bridge,
// then keyboard. The ESP32's socket opens (and can go stale) after mount, so
// the adapter choice is re-run whenever its availability changes — without
// that, hardware is passed over once at startup and never reconsidered.
export function useInputAdapter() {
  const { calibration, setCenter, setDeadzone } = useCalibration()
  const [source, setSource] = useState('Keyboard')
  const [raw, setRaw] = useState<RawInputSample>(IDLE_SAMPLE)
  const adapterRef = useRef<InputAdapter | null>(null)
  // Running totals of button presses (rising edges). Keyboard buttons stay
  // live alongside a wheel/pad so shifts always work.
  const buttonCounts = useRef<ButtonCounts>(ZERO_COUNTS())
  const [presses, setPresses] = useState<ButtonCounts>(ZERO_COUNTS())

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
    let held = new Set<ButtonId>()
    const padPresses = ZERO_COUNTS()
    const tick = () => {
      setRaw(adapterRef.current?.poll() ?? IDLE_SAMPLE)
      // pad/wheel buttons: count rising edges of the held state
      const pad = adapterRef.current !== keyboard ? adapterRef.current : null
      const now = new Set<ButtonId>(pad?.pollButtons?.() ?? [])
      for (const id of BUTTON_IDS) if (now.has(id) && !held.has(id)) padPresses[id] += 1
      held = now
      // keyboard presses are counted from key events, so short taps are never lost
      const keys = keyboard.buttonPresses?.() ?? ZERO_COUNTS()
      let changed = false
      for (const id of BUTTON_IDS) {
        const total = keys[id] + padPresses[id]
        if (total !== buttonCounts.current[id]) {
          buttonCounts.current[id] = total
          changed = true
        }
      }
      if (changed) setPresses({ ...buttonCounts.current })
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
    buttonCounts,
    presses,
    calibration,
    setCenter: () => setCenter(raw.steeringRaw),
    setDeadzone,
  }
}
