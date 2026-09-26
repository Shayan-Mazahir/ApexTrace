import { useCallback, useEffect, useRef, useState } from 'react'
import { advancePlayback } from './replayMath'

// One shared clock drives both replays so they stay synchronized.
export function usePlayback(duration: number) {
  const [t, setT] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [rate, setRate] = useState(1)
  const tRef = useRef(0)
  tRef.current = t

  useEffect(() => {
    if (!playing) return
    let frame = 0
    let last = performance.now()
    const tick = (now: number) => {
      const next = advancePlayback(tRef.current, (now - last) / 1000, rate, duration)
      last = now
      setT(next)
      if (next >= duration) {
        setPlaying(false)
        return
      }
      frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [playing, rate, duration])

  const play = useCallback(() => {
    if (tRef.current >= duration) setT(0)
    setPlaying(true)
  }, [duration])
  const pause = useCallback(() => setPlaying(false), [])
  const restart = useCallback(() => {
    setT(0)
    setPlaying(true)
  }, [])
  const seek = useCallback((value: number) => setT(value), [])

  return { t, playing, rate, setRate, play, pause, restart, seek }
}
