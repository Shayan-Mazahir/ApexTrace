import type { ReplayFrame } from '../types/schemas'

export interface PoseAt {
  x: number
  y: number
  heading: number
  speed: number
  frame: ReplayFrame
}

const wrap = (angle: number) => ((angle + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI

// Frames are recorded at 10 Hz; playback interpolates between them. Past the
// end of a run the car simply stays where the run ended (exit or finish).
export function poseAt(frames: ReplayFrame[], t: number): PoseAt | null {
  if (frames.length === 0) return null
  if (t <= frames[0].t) return { x: frames[0].x, y: frames[0].y, heading: frames[0].heading, speed: frames[0].speed, frame: frames[0] }
  const last = frames[frames.length - 1]
  if (t >= last.t) return { x: last.x, y: last.y, heading: last.heading, speed: last.speed, frame: last }

  let lo = 0
  let hi = frames.length - 1
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1
    if (frames[mid].t <= t) lo = mid
    else hi = mid
  }
  const a = frames[lo]
  const b = frames[hi]
  const k = (t - a.t) / (b.t - a.t)
  return {
    x: a.x + (b.x - a.x) * k,
    y: a.y + (b.y - a.y) * k,
    heading: a.heading + wrap(b.heading - a.heading) * k,
    speed: a.speed + (b.speed - a.speed) * k,
    frame: a,
  }
}

export function trailUpTo(frames: ReplayFrame[], t: number): [number, number][] {
  return frames.filter((f) => f.t <= t).map((f) => [f.x, f.y])
}

export function runDuration(frames: ReplayFrame[]): number {
  return frames.length ? frames[frames.length - 1].t : 0
}

export interface Band {
  start: number
  end: number
}

// Contiguous time ranges where `pick(frame)` is true.
export function bands(frames: ReplayFrame[], pick: (f: ReplayFrame) => boolean): Band[] {
  const result: Band[] = []
  let start: number | null = null
  for (const f of frames) {
    if (pick(f) && start === null) start = f.t
    if (!pick(f) && start !== null) {
      result.push({ start, end: f.t })
      start = null
    }
  }
  if (start !== null && frames.length) result.push({ start, end: frames[frames.length - 1].t })
  return result
}

export function firstTime(frames: ReplayFrame[], pick: (f: ReplayFrame) => boolean): number | null {
  return frames.find(pick)?.t ?? null
}

export function advancePlayback(t: number, dtSeconds: number, rate: number, duration: number): number {
  return Math.min(duration, Math.max(0, t + dtSeconds * rate))
}
