import { useEffect, useMemo } from 'react'
import { BufferAttribute, BufferGeometry, CanvasTexture, DoubleSide, RepeatWrapping, SRGBColorSpace, type Texture } from 'three'
import type { HazardZone, TrackProfile } from '../types/schemas'
import { cornerMask, leftNormals, offset, uvWall, type Pt } from './trackGeometry'

// Circuit furniture that makes the layout read like a real track: raised,
// striped kerbs at every corner and braking-marker boards on the approach.

const KERB_WIDTH_M = 1.4 // must match the physics (placeholder_sim.KERB_WIDTH_M) and haptics
const KERB_STRIPE_M = 1.0 // each red or white block
// Cross-section, from the edge line outward: (metres out, height). The road
// surface sits at 0.02; the kerb rises to a lip, runs flat, then rolls off.
const KERB_PROFILE: [number, number][] = [
  [0, 0.024],
  [0.16, 0.072],
  [1.22, 0.07],
  [KERB_WIDTH_M, 0.03],
]

let kerbTexture: Texture | null = null
// One red and one white block (u 0..1 = two stripes), with a darker groove at
// each join and a light edge on the lip, so it reads as moulded concrete.
function kerbMap(red: string): Texture {
  if (kerbTexture) return kerbTexture
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 64
  const g = c.getContext('2d')!
  g.fillStyle = red
  g.fillRect(0, 0, 128, 64)
  g.fillStyle = '#f2f2ee'
  g.fillRect(128, 0, 128, 64)
  g.fillStyle = 'rgba(0,0,0,0.28)'
  for (const x of [0, 127, 128, 255]) g.fillRect(x, 0, 1, 64)
  const shade = g.createLinearGradient(0, 0, 0, 64) // v: lip (0) to outer edge (1)
  shade.addColorStop(0, 'rgba(255,255,255,0.10)')
  shade.addColorStop(0.2, 'rgba(0,0,0,0)')
  shade.addColorStop(1, 'rgba(0,0,0,0.12)')
  g.fillStyle = shade
  g.fillRect(0, 0, 256, 64)
  kerbTexture = new CanvasTexture(c)
  kerbTexture.wrapS = RepeatWrapping
  kerbTexture.colorSpace = SRGBColorSpace
  kerbTexture.anisotropy = 8
  return kerbTexture
}

function cumulative(points: Pt[]): number[] {
  const d = [0]
  for (let i = 1; i < points.length; i++) d.push(d[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]))
  return d
}

// The raised kerb beside one edge line, only where `mask` says (corners).
function kerbGeometry(edge: Pt[], normals: Pt[], side: 1 | -1, mask: boolean[]): BufferGeometry {
  const rails = KERB_PROFILE.map(([d]) => offset(edge, normals, d, side))
  const along = cumulative(edge)
  const positions: number[] = []
  const uvs: number[] = []
  const indices: number[] = []
  const last = KERB_PROFILE.length - 1
  for (let i = 0; i < edge.length - 1; i++) {
    if (!mask[i]) continue
    const base = positions.length / 3
    for (const k of [i, i + 1]) {
      KERB_PROFILE.forEach(([, h], r) => {
        const [x, z] = rails[r][k]
        positions.push(x, h, z)
        uvs.push(along[k] / (2 * KERB_STRIPE_M), r / last)
      })
    }
    const w = KERB_PROFILE.length
    for (let r = 0; r < last; r++) {
      const a = base + r
      const b = base + w + r
      indices.push(a, b, a + 1, b, b + 1, a + 1)
    }
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  g.setIndex(indices)
  g.computeVertexNormals()
  return g
}

export function Kerbs({ profile, red }: { profile: TrackProfile; red: string }) {
  const geometries = useMemo(() => {
    const normals = leftNormals(profile)
    const mask = cornerMask(profile)
    return [kerbGeometry(profile.left_edge as Pt[], normals, 1, mask), kerbGeometry(profile.right_edge as Pt[], normals, -1, mask)]
  }, [profile])
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  const map = kerbMap(red)
  return (
    <>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial map={map} roughness={0.55} side={DoubleSide} />
        </mesh>
      ))}
    </>
  )
}

// ---------------------------------------------------------------- braking boards

const BOARD_DISTANCES = [150, 100, 50] // metres before the corner's braking zone

const boardTextures = new Map<number, Texture>()
function boardMap(metres: number): Texture {
  const hit = boardTextures.get(metres)
  if (hit) return hit
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.fillStyle = '#fafafa'
  g.fillRect(0, 0, 128, 128)
  g.strokeStyle = '#111'
  g.lineWidth = 8
  g.strokeRect(6, 6, 116, 116)
  g.fillStyle = '#111'
  g.font = 'bold 58px system-ui, -apple-system, Segoe UI, Roboto, sans-serif'
  g.textAlign = 'center'
  g.textBaseline = 'middle'
  g.fillText(String(metres), 64, 68)
  const t = new CanvasTexture(c)
  t.colorSpace = SRGBColorSpace
  t.anisotropy = 8
  boardTextures.set(metres, t)
  return t
}

interface Board {
  x: number
  z: number
  yaw: number
  metres: number
}

// Which way a corner turns, from the heading change across its zone: +1 when
// the outside is the left_edge side. Boards and tyre walls go on the outside,
// where drivers look for them and where a car that runs wide ends up.
function outsideOf(profile: TrackProfile, hazard: HazardZone): 1 | -1 {
  const line = profile.centerline
  const n = line.length
  const step = profile.total_length / Math.max(n - 1, 1)
  const at = (d: number) => ((Math.round(d / step) % n) + n) % n
  const heading = (i: number) => {
    const [x0, y0] = line[i]
    const [x1, y1] = line[(i + 1) % n]
    return Math.atan2(y1 - y0, x1 - x0)
  }
  const turn = Math.sin(heading(at((hazard.start_distance + hazard.end_distance) / 2)) - heading(at(hazard.start_distance)))
  return turn > 0 ? -1 : 1
}

function boardsFor(profile: TrackProfile, hazard: HazardZone, normals: Pt[]): Board[] {
  const line = profile.centerline
  const n = line.length
  const step = profile.total_length / Math.max(n - 1, 1)
  const at = (d: number) => ((Math.round(d / step) % n) + n) % n
  const heading = (i: number) => {
    const [x0, y0] = line[i]
    const [x1, y1] = line[(i + 1) % n]
    return Math.atan2(y1 - y0, x1 - x0)
  }
  const outside = outsideOf(profile, hazard)
  const out = Math.min(profile.barrier_offset - 0.6, 3.2) + profile.track_width / 2
  return BOARD_DISTANCES.map((metres) => {
    const i = at(hazard.start_distance - metres)
    const [cx, cz] = line[i]
    return {
      x: cx + normals[i][0] * out * outside,
      z: cz + normals[i][1] * out * outside,
      yaw: -heading(i) + Math.PI / 2, // facing the cars coming toward it
      metres,
    }
  })
}

export function BrakeBoards({ profile }: { profile: TrackProfile }) {
  const boards = useMemo(() => {
    const normals = leftNormals(profile)
    return profile.hazard_zones.flatMap((h) => boardsFor(profile, h, normals))
  }, [profile])
  return (
    <group>
      {boards.map((b, k) => (
        <group key={k} position={[b.x, 0, b.z]} rotation={[0, b.yaw, 0]}>
          <mesh position={[0, 0.55, -0.03]} castShadow>
            <boxGeometry args={[0.08, 1.1, 0.06]} />
            <meshStandardMaterial color="#9aa0a6" roughness={0.6} />
          </mesh>
          <mesh position={[0, 1.55, 0]} castShadow>
            <boxGeometry args={[1.05, 1.05, 0.05]} />
            <meshStandardMaterial color="#e8e8e8" roughness={0.5} />
          </mesh>
          <mesh position={[0, 1.55, 0.027]}>
            <planeGeometry args={[1.0, 1.0]} />
            <meshStandardMaterial map={boardMap(b.metres)} roughness={0.5} />
          </mesh>
        </group>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- tyre walls

const TYRE_WALL_HEIGHT = 0.9 // three tyres
const TYRE_WALL_TILE_M = 2.64 // four tyres per texture tile
const TYRE_WALL_INSET_M = 0.35 // in front of the barrier

let tyreTexture: Texture | null = null
// Stacked tyres face-on: black rubber rings with a lighter sidewall, strapped
// with a red and white belt, as tyre walls at the outside of corners are.
function tyreMap(): Texture {
  if (tyreTexture) return tyreTexture
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 96
  const g = c.getContext('2d')!
  g.fillStyle = '#0b0b0c'
  g.fillRect(0, 0, 256, 96)
  for (let row = 0; row < 3; row++) {
    for (let col = 0; col < 4; col++) {
      const cx = col * 64 + 32
      const cy = row * 32 + 16
      const ring = g.createRadialGradient(cx, cy, 5, cx, cy, 16)
      ring.addColorStop(0, '#050505')
      ring.addColorStop(0.45, '#050505')
      ring.addColorStop(0.55, '#2b2c2f')
      ring.addColorStop(0.85, '#1a1b1d')
      ring.addColorStop(1, '#0b0b0c')
      g.fillStyle = ring
      g.beginPath()
      g.arc(cx, cy, 16, 0, Math.PI * 2)
      g.fill()
    }
  }
  for (let x = 0; x < 256; x += 32) { // belt across the middle row
    g.fillStyle = (x / 32) % 2 ? '#f1f1ee' : '#d4121e'
    g.fillRect(x, 40, 32, 16)
  }
  tyreTexture = new CanvasTexture(c)
  tyreTexture.wrapS = RepeatWrapping
  tyreTexture.colorSpace = SRGBColorSpace
  tyreTexture.anisotropy = 8
  return tyreTexture
}

// A tyre wall in front of the barrier on the outside of every corner, from a
// little before the corner to a little after its exit.
export function TyreWalls({ profile }: { profile: TrackProfile }) {
  const geometries = useMemo(() => {
    const normals = leftNormals(profile)
    const n = profile.centerline.length
    const step = profile.total_length / Math.max(n - 1, 1)
    const onSide = { 1: new Array<boolean>(n).fill(false), [-1]: new Array<boolean>(n).fill(false) } as Record<1 | -1, boolean[]>
    for (const h of profile.hazard_zones) {
      const side = outsideOf(profile, h)
      for (let d = h.start_distance - 30; d <= h.end_distance + 50; d += step) {
        onSide[side][((Math.round(d / step) % n) + n) % n] = true
      }
    }
    const out = profile.barrier_offset - TYRE_WALL_INSET_M
    return ([1, -1] as const).map((side) => {
      const edge = (side === 1 ? profile.left_edge : profile.right_edge) as Pt[]
      const strip = uvWall(offset(edge, normals, out, side), 0, TYRE_WALL_HEIGHT, TYRE_WALL_TILE_M, (i) => onSide[side][i])
      const g = new BufferGeometry()
      g.setAttribute('position', new BufferAttribute(strip.positions, 3))
      g.setAttribute('uv', new BufferAttribute(strip.uvs, 2))
      g.setIndex(strip.indices)
      g.computeVertexNormals()
      return g
    })
  }, [profile])
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries])
  const map = tyreMap()
  return (
    <>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} receiveShadow>
          <meshStandardMaterial map={map} roughness={0.9} side={DoubleSide} />
        </mesh>
      ))}
    </>
  )
}
