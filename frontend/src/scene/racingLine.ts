import type { TrackProfile } from '../types/schemas'
import { leftNormals, type Pt } from './trackGeometry'

// Car limits used to colour the line. They mirror the backend car model
// (backend/app/placeholder_sim.py: G_LAT, BRAKE_DECEL, ACCEL, MAX_SPEED), with
// braking derated so the red zones start a little early rather than late.
const LATERAL_ACCEL = 35
const BRAKE_DECEL = 40 * 0.8
const DRIVE_ACCEL = 12
const MAX_SPEED = 88

// Keep the line this far inside each edge (car half-width 1 m + a little room).
const EDGE_MARGIN = 1.6

export type LinePhase = 'brake' | 'throttle'

export interface RacingLine {
  points: Pt[] // closed: last point equals the first
  offsets: number[] // metres left (+) of the centerline, per centerline sample
  speeds: number[] // m/s the car model could carry along the line
  phase: LinePhase[] // per point
}

/**
 * Racing line that keeps corner curvature as low as the track allows.
 *
 * Each centerline sample may slide along its normal within the track edges.
 * We minimise a curvature penalty on the resulting path (second differences,
 * weighted towards the tightest spots; see solveLevel), which gives the
 * classic outside - apex - outside shape. Coarse levels run first so long,
 * sweeping corners converge quickly.
 */
export function computeRacingLine(profile: TrackProfile): RacingLine {
  let center = profile.centerline as Pt[]
  let left = profile.left_edge as Pt[]
  const closedInput = samePoint(center[0], center[center.length - 1])
  if (closedInput) {
    center = center.slice(0, -1)
    left = left.slice(0, -1)
  }
  const n = center.length
  const normals = leftNormals({ ...profile, centerline: center, left_edge: left })
  const bound = center.map(([cx, cy], i) => {
    const half = Math.hypot(left[i][0] - cx, left[i][1] - cy)
    return Math.max(0, half - EDGE_MARGIN)
  })

  const offsets = new Float64Array(n)
  for (const stride of [16, 4, 1]) {
    if (stride > 1 && n / stride < 12) continue
    const idx: number[] = []
    for (let i = 0; i < n; i += stride) idx.push(i)
    solveLevel(center, normals, bound, offsets, idx)
    if (stride > 1) interpolateOffsets(offsets, idx, n)
  }

  const points: Pt[] = center.map(([x, y], i) => [x + normals[i][0] * offsets[i], y + normals[i][1] * offsets[i]])
  const { speeds, phase } = speedProfile(points)
  points.push(points[0])
  speeds.push(speeds[0])
  phase.push(phase[0])
  const out = Array.from(offsets)
  if (closedInput) out.push(out[0])
  return { points, offsets: out, speeds, phase }
}

function samePoint(a: Pt, b: Pt): boolean {
  return Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6
}

// Exponent of the curvature penalty. p = 2 is the classic minimum-curvature
// (sum of squares) line; a mild p = 4 leans towards evening out the tightest
// spots, which uses more of the track on entry and exit.
const CURVATURE_POWER = 4
const WEIGHT_CAP = 20
const WEIGHT_BLEND = 0.3
const OUTER_ITERATIONS = 25
const INNER_ITERATIONS = 150

function solveLevel(center: Pt[], normals: Pt[], bound: number[], offsets: Float64Array, idx: number[]) {
  const m = idx.length
  const px = new Float64Array(m)
  const py = new Float64Array(m)
  const w = new Float64Array(m).fill(1)
  for (let k = 0; k < m; k++) {
    const i = idx[k]
    px[k] = center[i][0] + normals[i][0] * offsets[i]
    py[k] = center[i][1] + normals[i][1] * offsets[i]
  }
  // Iteratively reweighted least squares: weight each second difference by
  // |curvature|^(p-2), then minimise the weighted sum of squares with projected
  // Gauss-Seidel (exact per-coordinate minimiser, moved along the normal and
  // clamped to the track).
  for (let outer = 0; outer < OUTER_ITERATIONS; outer++) {
    if (outer > 0) {
      let mean = 0
      const second = new Float64Array(m)
      for (let k = 0; k < m; k++) {
        const a = (k - 1 + m) % m
        const b = (k + 1) % m
        second[k] = Math.hypot(px[a] - 2 * px[k] + px[b], py[a] - 2 * py[k] + py[b])
        mean += second[k] / m
      }
      for (let k = 0; k < m; k++) {
        // Bounded, gradually blended weights keep the reweighting stable: very
        // uneven weights let lightly weighted stretches kink freely.
        const target = Math.min(WEIGHT_CAP, Math.max(1 / WEIGHT_CAP, Math.pow(second[k] / (mean || 1), CURVATURE_POWER - 2)))
        w[k] = Math.pow(w[k], 1 - WEIGHT_BLEND) * Math.pow(target, WEIGHT_BLEND)
      }
    }
    for (let it = 0; it < INNER_ITERATIONS; it++) {
      for (let k = 0; k < m; k++) {
        const a = (k - 1 + m) % m
        const b = (k + 1) % m
        const a2 = (k - 2 + m) % m
        const b2 = (k + 2) % m
        // d/dp_k of sum_j w_j |p_{j-1} - 2 p_j + p_{j+1}|^2 = 0
        const denom = w[a] + 4 * w[k] + w[b]
        const tx = (w[a] * (2 * px[a] - px[a2]) + 2 * w[k] * (px[a] + px[b]) + w[b] * (2 * px[b] - px[b2])) / denom
        const ty = (w[a] * (2 * py[a] - py[a2]) + 2 * w[k] * (py[a] + py[b]) + w[b] * (2 * py[b] - py[b2])) / denom
        const i = idx[k]
        const [nx, ny] = normals[i]
        const next = Math.max(-bound[i], Math.min(bound[i], offsets[i] + (tx - px[k]) * nx + (ty - py[k]) * ny))
        offsets[i] = next
        px[k] = center[i][0] + nx * next
        py[k] = center[i][1] + ny * next
      }
    }
  }
}

function interpolateOffsets(offsets: Float64Array, idx: number[], n: number) {
  for (let k = 0; k < idx.length; k++) {
    const i0 = idx[k]
    const i1 = k + 1 < idx.length ? idx[k + 1] : n
    const o0 = offsets[i0]
    const o1 = offsets[i1 % n]
    for (let i = i0 + 1; i < i1; i++) offsets[i] = o0 + ((o1 - o0) * (i - i0)) / (i1 - i0)
  }
}

/** Curvature-limited speed with acceleration/braking passes around the closed loop. */
export function speedProfile(points: Pt[]): { speeds: number[]; phase: LinePhase[] } {
  const n = points.length
  const dist = points.map((p, i) => Math.hypot(points[(i + 1) % n][0] - p[0], points[(i + 1) % n][1] - p[1]))
  // Curvature over a +-2 sample chord smooths out sampling noise.
  const limit = points.map((_, i) => {
    const k = mengerCurvature(points[(i - 2 + n) % n], points[i], points[(i + 2) % n])
    return k < 1e-6 ? MAX_SPEED : Math.min(MAX_SPEED, Math.sqrt(LATERAL_ACCEL / k))
  })
  const fwd = limit.slice()
  for (let lap = 0; lap < 2; lap++) {
    for (let i = 0; i < n; i++) {
      const prev = (i - 1 + n) % n
      fwd[i] = Math.min(limit[i], Math.sqrt(fwd[prev] ** 2 + 2 * DRIVE_ACCEL * dist[prev]))
    }
  }
  const speeds = fwd.slice()
  for (let lap = 0; lap < 2; lap++) {
    for (let i = n - 1; i >= 0; i--) {
      const next = (i + 1) % n
      speeds[i] = Math.min(speeds[i], Math.sqrt(speeds[next] ** 2 + 2 * BRAKE_DECEL * dist[i]))
    }
  }
  const phase: LinePhase[] = speeds.map((v, i) => (v < fwd[i] - 0.5 ? 'brake' : 'throttle'))
  return { speeds, phase }
}

/** Seconds to drive a closed polyline at the speeds from speedProfile. */
export function lapTime(points: Pt[]): number {
  const loop = samePoint(points[0], points[points.length - 1]) ? points.slice(0, -1) : points
  const { speeds } = speedProfile(loop)
  let t = 0
  for (let i = 0; i < loop.length; i++) {
    const j = (i + 1) % loop.length
    t += Math.hypot(loop[j][0] - loop[i][0], loop[j][1] - loop[i][1]) / ((speeds[i] + speeds[j]) / 2)
  }
  return t
}

function mengerCurvature(a: Pt, b: Pt, c: Pt): number {
  const ab = Math.hypot(b[0] - a[0], b[1] - a[1])
  const bc = Math.hypot(c[0] - b[0], c[1] - b[1])
  const ca = Math.hypot(a[0] - c[0], a[1] - c[1])
  const cross = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]))
  const denom = ab * bc * ca
  return denom < 1e-9 ? 0 : (2 * cross) / denom
}
