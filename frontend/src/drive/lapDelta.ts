// Live delta to the best lap, the way sims do it: the best valid lap is kept
// as (distance, time) samples, and the current lap time is compared with the
// best lap's time at the same distance round the lap.

export interface LapSample {
  d: number // metres into the lap
  t: number // lap time at that point, s
}

export class LapDeltaTracker {
  private current: LapSample[] = []
  private best: LapSample[] | null = null
  private bestTime: number | null = null
  private lap = -1

  reset() {
    this.current = []
    this.best = null
    this.bestTime = null
    this.lap = -1
  }

  /**
   * Feed one vehicle-state sample. `lap` is the lap number, `valid` whether
   * the lap that has just finished counted (only valid laps become the reference).
   */
  update(lap: number, distanceIntoLap: number, lapTime: number, lastLap: number | null, lastLapValid: boolean | null | undefined) {
    if (lap !== this.lap) {
      if (this.lap >= 0 && lap === this.lap + 1 && lastLap != null && lastLapValid !== false) {
        if (this.bestTime == null || lastLap < this.bestTime) {
          this.best = this.current
          this.bestTime = lastLap
        }
      }
      this.current = []
      this.lap = lap
    }
    const last = this.current[this.current.length - 1]
    if (!last || distanceIntoLap > last.d) this.current.push({ d: distanceIntoLap, t: lapTime })
  }

  /** Seconds ahead (-) or behind (+) the best lap at this distance; null without a reference. */
  delta(distanceIntoLap: number, lapTime: number): number | null {
    const ref = this.best
    if (!ref || ref.length < 2 || distanceIntoLap < ref[0].d) return null
    let lo = 0
    let hi = ref.length - 1
    if (distanceIntoLap >= ref[hi].d) return lapTime - ref[hi].t
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1
      if (ref[mid].d <= distanceIntoLap) lo = mid
      else hi = mid
    }
    const a = ref[lo]
    const b = ref[hi]
    const f = (distanceIntoLap - a.d) / (b.d - a.d || 1)
    return lapTime - (a.t + (b.t - a.t) * f)
  }
}
