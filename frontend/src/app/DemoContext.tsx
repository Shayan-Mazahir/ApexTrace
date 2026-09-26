import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react'
import { DEMO_STEPS, DEMO_TOTAL_SECONDS, locate, stepStart, type DemoStep } from '../demo/steps'

const TICK_S = 0.25

interface DemoContextValue {
  active: boolean
  paused: boolean
  elapsed: number
  stepIndex: number
  step: DemoStep
  start: () => void
  stop: () => void
  next: () => void
  prev: () => void
  togglePause: () => void
}

const DemoContext = createContext<DemoContextValue | null>(null)

export function DemoProvider({ children }: { children: ReactNode }) {
  const [active, setActive] = useState(false)
  const [paused, setPaused] = useState(false)
  const [elapsed, setElapsed] = useState(0)

  const { index, done } = locate(elapsed)

  useEffect(() => {
    if (!active || paused) return
    const id = setInterval(() => setElapsed((e) => e + TICK_S), TICK_S * 1000)
    return () => clearInterval(id)
  }, [active, paused])

  useEffect(() => {
    if (active && done) setActive(false)
  }, [active, done])

  const start = useCallback(() => {
    setElapsed(0)
    setPaused(false)
    setActive(true)
  }, [])
  const stop = useCallback(() => setActive(false), [])
  const next = useCallback(
    () => setElapsed((e) => stepStart(Math.min(DEMO_STEPS.length, locate(e).index + 1))),
    [],
  )
  const prev = useCallback(
    () => setElapsed((e) => stepStart(Math.max(0, locate(e).index - 1))),
    [],
  )
  const togglePause = useCallback(() => setPaused((p) => !p), [])

  const value = useMemo(
    () => ({ active, paused, elapsed, stepIndex: index, step: DEMO_STEPS[index], start, stop, next, prev, togglePause }),
    [active, paused, elapsed, index, start, stop, next, prev, togglePause],
  )
  return <DemoContext.Provider value={value}>{children}</DemoContext.Provider>
}

export function useDemo() {
  const ctx = useContext(DemoContext)
  if (!ctx) throw new Error('useDemo must be used within DemoProvider')
  return ctx
}

export { DEMO_TOTAL_SECONDS }
