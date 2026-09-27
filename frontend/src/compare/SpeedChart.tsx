import type { ReplayRun } from '../types/schemas'
import { firstTime } from './replayMath'
import './SpeedChart.css'

const W = 1000
const H = 220
const PAD = { l: 48, r: 16, t: 16, b: 30 }

// Both runs' speed over time on one chart, with the moments that matter.
export function SpeedChart({ base, mine, t, maxT, onSeek }: { base: ReplayRun; mine: ReplayRun; t: number; maxT: number; onSeek: (t: number) => void }) {
  const vmax = Math.max(1, ...base.frames.map((f) => f.speed), ...mine.frames.map((f) => f.speed)) * 3.6
  const x = (s: number) => PAD.l + (s / Math.max(maxT, 1e-6)) * (W - PAD.l - PAD.r)
  const y = (kmh: number) => H - PAD.b - (kmh / vmax) * (H - PAD.t - PAD.b)
  const path = (run: ReplayRun) => run.frames.map((f, i) => `${i ? 'L' : 'M'}${x(f.t).toFixed(1)},${y(f.speed * 3.6).toFixed(1)}`).join('')
  const marks = (run: ReplayRun, cls: string) => {
    const warn = firstTime(run.frames, (f) => f.warning_active)
    const end = run.frames.at(-1)
    return (
      <>
        {warn !== null && (
          <g className={`schart__mark schart__mark--${cls}`}>
            <line x1={x(warn)} x2={x(warn)} y1={PAD.t} y2={H - PAD.b} />
          </g>
        )}
        {run.result.track_exit && end && (
          <text x={x(end.t)} y={y(end.speed * 3.6) - 8} className="schart__crash" textAnchor="middle">✕ crash</text>
        )}
      </>
    )
  }
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((k) => k * maxT)
  return (
    <div className="schart">
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label="Speed over time for both runs"
        onClick={(e) => {
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect()
          const px = ((e.clientX - r.left) / r.width) * W
          onSeek(Math.max(0, Math.min(maxT, ((px - PAD.l) / (W - PAD.l - PAD.r)) * maxT)))
        }}>
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line className="schart__grid" x1={PAD.l} x2={W - PAD.r} y1={y(k * vmax)} y2={y(k * vmax)} />
            <text className="schart__axis" x={PAD.l - 8} y={y(k * vmax) + 4} textAnchor="end">{Math.round(k * vmax)}</text>
          </g>
        ))}
        {ticks.map((s) => (
          <text key={s} className="schart__axis" x={x(s)} y={H - 8} textAnchor="middle">{Math.round(s)} s</text>
        ))}
        {marks(base, 'base')}
        {marks(mine, 'mine')}
        <path d={path(base)} className="schart__line schart__line--base" />
        <path d={path(mine)} className="schart__line schart__line--mine" />
        <line className="schart__head" x1={x(t)} x2={x(t)} y1={PAD.t} y2={H - PAD.b} />
      </svg>
      <div className="schart__legend">
        <span><i className="schart__sw schart__sw--base" /> No upgrades</span>
        <span><i className="schart__sw schart__sw--mine" /> Your car</span>
        <span><i className="schart__sw schart__sw--warn" /> first BRAKE warning</span>
        <span className="schart__hint">Speed (km/h). Click the chart to jump.</span>
      </div>
    </div>
  )
}
