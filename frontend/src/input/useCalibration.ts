import { useCallback, useEffect, useState } from 'react'

export interface Calibration {
  center: number
  deadzone: number
}

const STORAGE_KEY = 'limitlab.steering-calibration'
const DEFAULT_CALIBRATION: Calibration = { center: 0, deadzone: 0.05 }

function loadCalibration(): Calibration {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_CALIBRATION
    const parsed = JSON.parse(raw)
    return {
      center: typeof parsed.center === 'number' ? parsed.center : DEFAULT_CALIBRATION.center,
      deadzone:
        typeof parsed.deadzone === 'number' ? parsed.deadzone : DEFAULT_CALIBRATION.deadzone,
    }
  } catch {
    return DEFAULT_CALIBRATION
  }
}

export function useCalibration() {
  const [calibration, setCalibration] = useState<Calibration>(loadCalibration)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(calibration))
    } catch {
      // private browsing / storage disabled — calibration just won't persist
    }
  }, [calibration])

  const setCenter = useCallback((center: number) => {
    setCalibration((c) => ({ ...c, center }))
  }, [])

  const setDeadzone = useCallback((deadzone: number) => {
    setCalibration((c) => ({ ...c, deadzone }))
  }, [])

  return { calibration, setCenter, setDeadzone }
}
