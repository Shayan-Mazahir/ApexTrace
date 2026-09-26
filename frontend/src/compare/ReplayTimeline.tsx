import type { ReplayFrame } from '../types/schemas'
import { bands, runDuration } from './replayMath'
import './ReplayTimeline.css'

interface ReplayTimelineProps {
  frames: ReplayFrame[]
  maxT: number
  t: number
}

const W = 600
const H = 110
const PAD = 22
const MAX_SPEED = 40

// Speed trace with the warning window and braking marked underneath, on a
// time axis shared with the other run so they can be read side by side.
export function ReplayTimeline({ frames, maxT, t }: ReplayTimelineProps) {
  const x = (time: number) => PAD + (time / Math.max(maxT, 0.001)) * (W - 2 * PAD)
  const y = (speed: number) => H - 30 - (speed / MAX_SPEED) * (H - 50)
  const warnings = bands(frames, (f) => f.warning_active)
  const braking = bands(frames, (f) => f.brake > 0.5)
  const end = frames.length ? frames[frames.length - 1] : null
  const points = frames.map((f) => `${x(f.t).toFixed(1)},${y(f.speed).toFixed(1)}`).join(' ')

  return (
    <svg className="replay-timeline" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Speed, warning and braking over time">
      <line x1={PAD} x2={W - PAD} y1={H - 30} y2={H - 30} className="replay-timeline__axis" />
      {warnings.map((b, i) => (
        <rect key={`w${i}`} x={x(b.start)} width={Math.max(2, x(b.end) - x(b.start))} y={6} height={10} className="replay-timeline__warning" />
      ))}
      {braking.map((b, i) => (
        <rect key={`b${i}`} x={x(b.start)} width={Math.max(2, x(b.end) - x(b.start))} y={H - 26} height={8} className="replay-timeline__brake" />
      ))}
      <polyline points={points} className="replay-timeline__speed" />
      {end?.track_exit && (
        <text x={x(runDuration(frames))} y={y(end.speed) - 4} textAnchor="end" className="replay-timeline__exit">
          ✕ track exit
        </text>
      )}
      <line x1={x(t)} x2={x(t)} y1={4} y2={H - 16} className="replay-timeline__cursor" />
      <text x={PAD} y={H - 4} className="replay-timeline__label">0 s</text>
      <text x={W - PAD} y={H - 4} textAnchor="end" className="replay-timeline__label">{maxT.toFixed(0)} s</text>
      <text x={PAD} y={H - 4} dx={60} className="replay-timeline__label">▬ warning (top)  ▬ braking (bottom)  — speed</text>
    </svg>
  )
}
