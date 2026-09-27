// Entity interpolation for server-authoritative motion: keep the last few
// server states and render slightly in the past, blending between the two
// samples that bracket the render time. Network jitter (bunched or late
// packets) then no longer shows up as stutter.

export interface TimedPose {
  t: number // server simulation time, s
  x: number
  y: number
  heading: number
}

export const RENDER_DELAY_S = 0.1 // two 20 Hz ticks
const MAX_EXTRAPOLATE_S = 0.1

const wrap = (a: number) => ((((a + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI

export class PoseBuffer {
  private samples: TimedPose[] = []
  private clock: number | null = null

  push(p: TimedPose) {
    const last = this.samples[this.samples.length - 1]
    if (last && p.t <= last.t) {
      if (p.t < last.t - 1) this.reset() // time went backwards: run was reset
      else return // duplicate or out-of-order: ignore
    }
    this.samples.push(p)
    if (this.samples.length > 20) this.samples.shift()
  }

  reset() {
    this.samples = []
    this.clock = null
  }

  /** Advance the render clock by dt (s) and return the interpolated pose. */
  sample(dt: number): TimedPose | null {
    const n = this.samples.length
    if (n === 0) return null
    const latest = this.samples[n - 1]
    const target = latest.t - RENDER_DELAY_S
    if (this.clock === null || Math.abs(this.clock - target) > 0.3) this.clock = target
    else this.clock += dt + (target - this.clock) * Math.min(1, dt * 2) // follow the server clock without jumps
    const t = this.clock
    if (n === 1 || t <= this.samples[0].t) return { ...this.samples[0], t }
    for (let i = n - 1; i > 0; i--) {
      const a = this.samples[i - 1]
      const b = this.samples[i]
      if (t >= a.t) {
        const span = b.t - a.t || 1e-6
        const k = Math.min(1 + MAX_EXTRAPOLATE_S / span, (t - a.t) / span) // past the newest sample: brief extrapolation
        return { t, x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k, heading: a.heading + wrap(b.heading - a.heading) * k }
      }
    }
    return { ...latest, t }
  }
}
