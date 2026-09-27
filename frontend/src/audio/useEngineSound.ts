import { useEffect, useRef, useState } from 'react'
import type { VehicleStateMessage } from '../types/schemas'
import { EngineSound } from './engineSound'

const KEY = 'apextrace.sound'

function storedOn(): boolean {
  try {
    return localStorage.getItem(KEY) !== 'off'
  } catch {
    return true
  }
}

// Engine audio for the Drive screen. Pitch follows the server's rpm; throttle
// comes straight from the local pedal so the sound reacts with no lag.
export function useEngineSound(v: VehicleStateMessage | null, throttle: number, live: boolean) {
  const [on, setOn] = useState(storedOn)
  const engine = useRef<EngineSound | null>(null)

  useEffect(() => {
    if (typeof AudioContext === 'undefined') return
    const e = (engine.current = new EngineSound())
    // autoplay policy: the context starts suspended until the page is clicked
    const unlock = () => e.resume()
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
      e.close()
      engine.current = null
    }
  }, [])

  useEffect(() => {
    engine.current?.setVolume(on ? 0.5 : 0)
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off')
    } catch {
      // private mode: the setting just isn't remembered
    }
  }, [on])

  // every new server state or pedal change re-renders the Drive screen
  useEffect(() => {
    engine.current?.update({
      rpm: v?.rpm ?? 4000,
      throttle,
      gear: v?.gear ?? 0,
      speed: v?.speed ?? 0,
      lockup: v?.lockup ?? false,
      wheelspin: v?.wheelspin ?? false,
      live: live && !!v && !document.hidden,
    })
  })

  return { on, toggle: () => setOn((x) => !x) }
}
