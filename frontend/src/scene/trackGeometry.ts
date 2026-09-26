import type { TrackProfile } from '../types/schemas'

export type Pt = [number, number]

// Unit normal at each sample, pointing to the LEFT edge of the road.
export function leftNormals(profile: TrackProfile): Pt[] {
  return profile.centerline.map(([cx, cy], i) => {
    const [lx, ly] = profile.left_edge[i]
    const len = Math.hypot(lx - cx, ly - cy) || 1
    return [(lx - cx) / len, (ly - cy) / len]
  })
}

export function offset(points: Pt[], normals: Pt[], distance: number, side: 1 | -1): Pt[] {
  return points.map(([x, y], i) => [x + normals[i][0] * distance * side, y + normals[i][1] * distance * side])
}

export interface StripGeometry {
  positions: Float32Array
  colors: Float32Array
  indices: number[]
}

type Rgb = [number, number, number]

export function hexToRgb(hex: string): Rgb {
  const v = parseInt(hex.replace('#', ''), 16)
  return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255]
}

// A flat ribbon between two polylines at height y. `colorAt(i)` colours the
// quad starting at sample i; `include(i)` skips quads (e.g. kerbs only at
// corners).
export function flatStrip(
  a: Pt[],
  b: Pt[],
  y: number,
  colorAt: (i: number) => Rgb,
  include: (i: number) => boolean = () => true,
): StripGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i < a.length - 1; i++) {
    if (!include(i)) continue
    const c = colorAt(i)
    const base = positions.length / 3
    for (const [x, z] of [a[i], b[i], a[i + 1], b[i + 1]]) {
      positions.push(x, y, z)
      colors.push(...c)
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices }
}

// A vertical wall along a polyline, from y0 to y1.
export function wallStrip(
  line: Pt[],
  y0: number,
  y1: number,
  colorAt: (i: number) => Rgb,
  include: (i: number) => boolean = () => true,
): StripGeometry {
  const positions: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let i = 0; i < line.length - 1; i++) {
    if (!include(i)) continue
    const c = colorAt(i)
    const base = positions.length / 3
    const [x0, z0] = line[i]
    const [x1, z1] = line[i + 1]
    for (const [x, y, z] of [[x0, y0, z0], [x0, y1, z0], [x1, y0, z1], [x1, y1, z1]]) {
      positions.push(x, y, z)
      colors.push(...c)
    }
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  return { positions: new Float32Array(positions), colors: new Float32Array(colors), indices }
}

// Samples inside (or within `pad` metres of) a hazard zone — where kerbs go.
export function cornerMask(profile: TrackProfile, pad = 20): boolean[] {
  const n = profile.centerline.length
  const step = profile.total_length / Math.max(n - 1, 1)
  return profile.centerline.map((_, i) => {
    const d = i * step
    return profile.hazard_zones.some((h) => d >= h.start_distance - pad && d <= h.end_distance + pad)
  })
}

// Deterministic pseudo-random in [0, 1) (mulberry32).
export function rng(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface Prop {
  x: number
  z: number
  scale: number
  height: number
  rotation: number
}

// Scenery (trees / buildings) scattered beside the circuit but never on or
// too near the road: every candidate is checked against the whole centerline.
// `footprint` is how far the prop extends from its centre at the largest
// scale (e.g. a rotated building's half-diagonal), so the whole prop, not just
// its centre, stays `clearance` away from the centerline.
export function scatterProps(
  profile: TrackProfile,
  opts: {
    count: number
    minGap: number
    maxGap: number
    clearance: number
    seed: number
    minHeight: number
    maxHeight: number
    footprint?: number
  },
): Prop[] {
  const random = rng(opts.seed)
  const line = profile.centerline
  const normals = leftNormals(profile)
  const props: Prop[] = []
  const stride = Math.max(1, Math.floor((line.length - 1) / opts.count))
  for (let i = 0; i < line.length - 1; i += stride) {
    for (const side of [1, -1] as const) {
      const gap = opts.minGap + random() * (opts.maxGap - opts.minGap)
      const x = line[i][0] + normals[i][0] * side * gap
      const z = line[i][1] + normals[i][1] * side * gap
      let tooClose = false
      const keepOut = opts.clearance + (opts.footprint ?? 0)
      for (let k = 0; k < line.length; k += opts.footprint ? 1 : 2) {
        if (Math.hypot(line[k][0] - x, line[k][1] - z) < keepOut) {
          tooClose = true
          break
        }
      }
      if (tooClose) continue
      props.push({
        x,
        z,
        scale: 0.7 + random() * 0.6,
        height: opts.minHeight + random() * (opts.maxHeight - opts.minHeight),
        rotation: random() * Math.PI,
      })
    }
  }
  return props
}

export function bounds(line: Pt[]) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of line) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

export function formatLapTime(seconds: number | null | undefined): string {
  if (seconds === null || seconds === undefined || !Number.isFinite(seconds)) return '—'
  const m = Math.floor(seconds / 60)
  const s = seconds - m * 60
  return `${m}:${s.toFixed(3).padStart(6, '0')}`
}

export interface UvStrip {
  positions: Float32Array
  uvs: Float32Array
  indices: number[]
}

function cumulative(line: Pt[]): number[] {
  const out = [0]
  for (let i = 1; i < line.length; i++) out.push(out[i - 1] + Math.hypot(line[i][0] - line[i - 1][0], line[i][1] - line[i - 1][1]))
  return out
}

// Vertical strip with u running along the line (one texture repeat every
// `uLength` metres) so boards/fences tile without stretching.
export function uvWall(line: Pt[], y0: number, y1: number, uLength: number, include: (i: number) => boolean = () => true): UvStrip {
  const d = cumulative(line)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < line.length - 1; i++) {
    if (!include(i)) continue
    const base = positions.length / 3
    const [x0, z0] = line[i]
    const [x1, z1] = line[i + 1]
    const u0 = d[i] / uLength
    const u1 = d[i + 1] / uLength
    positions.push(x0, y0, z0, x0, y1, z0, x1, y0, z1, x1, y1, z1)
    uvs.push(u0, 0, u0, 1, u1, 0, u1, 1)
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices }
}

// Flat ribbon between two lines with u along the lap and v across it.
export function uvFlat(a: Pt[], b: Pt[], y: number, uLength: number, vRepeat = 1): UvStrip {
  const d = cumulative(a)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  for (let i = 0; i < a.length - 1; i++) {
    const base = positions.length / 3
    positions.push(a[i][0], y, a[i][1], b[i][0], y, b[i][1], a[i + 1][0], y, a[i + 1][1], b[i + 1][0], y, b[i + 1][1])
    const u0 = d[i] / uLength
    const u1 = d[i + 1] / uLength
    uvs.push(u0, 0, u0, vRepeat, u1, 0, u1, vRepeat)
    indices.push(base, base + 1, base + 2, base + 1, base + 3, base + 2)
  }
  return { positions: new Float32Array(positions), uvs: new Float32Array(uvs), indices }
}

// Sample index at a distance along the lap.
export function indexAt(profile: TrackProfile, distance: number): number {
  const n = profile.centerline.length - 1
  return Math.round(((((distance % profile.total_length) + profile.total_length) % profile.total_length) / profile.total_length) * n) % n
}

// Grandstand layout (local frame of the stand: `back` metres out from the
// straight's centerline, extending `GRANDSTAND_REACH_IN` towards the track
// (roof front edge) and `GRANDSTAND_REACH_OUT` away from it).
export const GRANDSTAND_REACH_IN = 4
export const GRANDSTAND_REACH_OUT = 14
const GRANDSTAND_MIN_LENGTH = 60
const GRANDSTAND_CORNER_GAP = 40 // stop this far before the first corner
const GRANDSTAND_STRAIGHTNESS = 1 // max deviation of the track from the stand's line, metres

export function grandstandBack(profile: TrackProfile): number {
  return profile.track_width / 2 + profile.barrier_offset + 9
}

/**
 * The stretch [from, end] a straight grandstand can occupy beside the start
 * straight without reaching over the track: it stops before the first corner,
 * only covers track that is actually straight, and its whole footprint must
 * stay behind the walls of every part of the circuit. Returns null when there
 * is no long enough straight (then no stand is drawn).
 */
export function grandstandSpan(profile: TrackProfile, from: number, to: number, side: 1 | -1): { from: number; to: number } | null {
  const firstCorner = Math.min(
    Infinity,
    ...profile.hazard_zones.filter((h) => h.start_distance > from).map((h) => h.start_distance),
  )
  const step = profile.total_length / (profile.centerline.length - 1)
  const wall = profile.track_width / 2 + profile.barrier_offset + 1
  const back = grandstandBack(profile)
  const line = profile.centerline as Pt[]
  const normals = leftNormals(profile)
  for (let end = Math.min(to, firstCorner - GRANDSTAND_CORNER_GAP); end - from >= GRANDSTAND_MIN_LENGTH; end -= step) {
    const i0 = indexAt(profile, from)
    const i1 = indexAt(profile, end)
    const [x0, z0] = line[i0]
    const [x1, z1] = line[i1]
    const len = Math.hypot(x1 - x0, z1 - z0) || 1
    const ux = (x1 - x0) / len
    const uz = (z1 - z0) / len
    let straight = true
    for (let i = i0; i <= i1 && straight; i++) {
      const dev = Math.abs((line[i][0] - x0) * uz - (line[i][1] - z0) * ux)
      straight = dev <= GRANDSTAND_STRAIGHTNESS
    }
    if (!straight) continue
    const [nx, nz] = normals[indexAt(profile, (from + end) / 2)]
    let clear = true
    for (let t = 0; t <= len && clear; t += step) {
      for (const reach of [back - GRANDSTAND_REACH_IN, back + GRANDSTAND_REACH_OUT]) {
        const px = x0 + ux * t + nx * side * reach
        const pz = z0 + uz * t + nz * side * reach
        for (const [cx, cz] of line) {
          if (Math.hypot(cx - px, cz - pz) < wall) {
            clear = false
            break
          }
        }
        if (!clear) break
      }
    }
    if (clear) return { from, to: end }
  }
  return null
}
