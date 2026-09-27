import type { VehicleStateMessage } from '../types/schemas'

// Best-lap ghost: records the lap being driven and, when it finishes as a
// valid new best, keeps it; the ghost car then replays it against the current
// lap's clock, so the driver races their own best.

export interface GhostSample {
  t: number // seconds into the lap
  x: number
  y: number
  heading: number
}

export interface GhostPose {
  x: number
  y: number
  heading: number
}

type Input = Pick<VehicleStateMessage, 'x' | 'y' | 'heading' | 'lap_time_s' | 'laps_completed' | 'last_lap_s' | 'last_lap_valid'>

const MIN_LAP_SAMPLES = 40 // a "lap" shorter than this is a reset artefact

export class GhostRecorder {
  private current: GhostSample[] = []
  private laps: number | null = null
  best: { samples: GhostSample[]; time: number } | null = null

  push(v: Input): void {
    const lapDone = this.laps !== null && v.laps_completed > this.laps
    const restarted = this.laps !== null && v.laps_completed < this.laps
    const last = this.current.at(-1)
    if (lapDone) {
      const time = v.last_lap_s
      if (v.last_lap_valid && time != null && this.current.length >= MIN_LAP_SAMPLES && (!this.best || time < this.best.time)) {
        this.best = { samples: this.current, time }
      }
      this.current = []
    } else if (restarted || (last && v.lap_time_s < last.t - 0.5)) {
      this.current = [] // reset to grid: that lap will never finish
    }
    this.laps = v.laps_completed
    const prev = this.current.at(-1)
    if (!prev || v.lap_time_s > prev.t) this.current.push({ t: v.lap_time_s, x: v.x, y: v.y, heading: v.heading })
  }

  /** Where the best lap was at `t` seconds into it; null when there is no best, or it has finished. */
  poseAt(t: number): GhostPose | null {
    const s = this.best?.samples
    if (!s || t < s[0].t || t > s[s.length - 1].t) return null
    let lo = 0
    let hi = s.length - 1
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (s[mid].t <= t) lo = mid
      else hi = mid
    }
    const a = s[lo]
    const b = s[hi]
    const k = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0
    const dh = ((((b.heading - a.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: a.heading + dh * k }
  }

  reset(): void {
    this.current = []
    this.laps = null
    this.best = null
  }
}
