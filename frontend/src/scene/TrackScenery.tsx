import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Object3D, type InstancedMesh, type Texture } from 'three'
import type { TrackId, TrackProfile } from '../types/schemas'
import {
  asphaltTexture,
  crowdTexture,
  fenceTexture,
  grassTexture,
  limitlabBoard,
  pavingTexture,
  sponsorBoard,
  windowsTexture,
} from './textures'
import {
  bounds,
  cornerMask,
  flatStrip,
  grandstandBack,
  grandstandSpan,
  hexToRgb,
  indexAt,
  leftNormals,
  offset,
  scatterProps,
  uvFlat,
  uvWall,
  type Prop,
  type Pt,
  type StripGeometry,
  type UvStrip,
} from './trackGeometry'

export interface TrackTheme {
  ground: 'grass' | 'paving'
  line: string
  kerbA: string
  kerbB: string
  barrierHeight: number
  fence: 'all' | 'straight'
  props: 'trees' | 'buildings'
}

export const THEMES: Record<TrackId, TrackTheme> = {
  monza: { ground: 'grass', line: '#f2f2f2', kerbA: '#d7262e', kerbB: '#f4f4f4', barrierHeight: 1.0, fence: 'straight', props: 'trees' },
  baku: { ground: 'paving', line: '#f2f2f2', kerbA: '#d7262e', kerbB: '#f4f4f4', barrierHeight: 1.3, fence: 'all', props: 'buildings' },
}

const BOARD_LENGTH = 16 // metres per board image

function useStrip(strip: StripGeometry) {
  return useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(strip.positions, 3))
    g.setAttribute('color', new BufferAttribute(strip.colors, 3))
    g.setIndex(strip.indices)
    g.computeVertexNormals()
    return g
  }, [strip])
}

function useUv(strip: UvStrip) {
  return useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(strip.positions, 3))
    g.setAttribute('uv', new BufferAttribute(strip.uvs, 2))
    g.setIndex(strip.indices)
    g.computeVertexNormals()
    return g
  }, [strip])
}

// Double-sided: strip winding depends on which edge comes first.
function ColourStrip({ strip }: { strip: StripGeometry }) {
  const geometry = useStrip(strip)
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={DoubleSide} roughness={0.85} />
    </mesh>
  )
}

function TexturedStrip({ strip, map, colour = '#ffffff', transparent = false, roughness = 0.9 }: {
  strip: UvStrip
  map: Texture
  colour?: string
  transparent?: boolean
  roughness?: number
}) {
  const geometry = useUv(strip)
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial map={map} color={colour} side={DoubleSide} roughness={roughness}
        transparent={transparent} alphaTest={transparent ? 0.1 : 0} depthWrite={!transparent} />
    </mesh>
  )
}

// offsets of the three foliage blobs relative to the crown centre
const BLOBS: [number, number, number, number][] = [
  [0, 0, 0, 1],
  [0.55, -0.35, 0.3, 0.78],
  [-0.5, -0.25, -0.35, 0.72],
]

function Trees({ items }: { items: Prop[] }) {
  const trunks = useRef<InstancedMesh>(null)
  const crown0 = useRef<InstancedMesh>(null)
  const crown1 = useRef<InstancedMesh>(null)
  const crown2 = useRef<InstancedMesh>(null)
  const crowns = [crown0, crown1, crown2]
  const colours = useMemo(() => {
    const c = new Color()
    const out = new Float32Array(items.length * 3)
    items.forEach((p, i) => {
      c.setHSL(0.25 + (p.rotation % 0.07), 0.42 + (p.scale - 0.7) * 0.2, 0.2 + (p.rotation % 0.3) * 0.25)
      out.set([c.r, c.g, c.b], i * 3)
    })
    return out
  }, [items])

  useLayoutEffect(() => {
    const o = new Object3D()
    const refs = [crown0, crown1, crown2]
    items.forEach((p, i) => {
      const h = p.height * p.scale
      o.position.set(p.x, h * 0.35, p.z)
      o.rotation.set(0, p.rotation, 0)
      o.scale.set(p.scale, h * 0.7, p.scale)
      o.updateMatrix()
      trunks.current?.setMatrixAt(i, o.matrix)
      const r = 2.6 * p.scale + h * 0.18
      BLOBS.forEach(([dx, dy, dz, s], k) => {
        o.position.set(p.x + dx * r, h * 0.78 + dy * r, p.z + dz * r)
        o.rotation.set(p.rotation, p.rotation * 2, 0)
        o.scale.set(r * s, r * s * 0.9, r * s)
        o.updateMatrix()
        refs[k].current?.setMatrixAt(i, o.matrix)
      })
    })
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true
    for (const c of refs) if (c.current) c.current.instanceMatrix.needsUpdate = true
  }, [items])

  if (items.length === 0) return null
  return (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, items.length]}>
        <cylinderGeometry args={[0.18, 0.32, 1, 6]} />
        <meshStandardMaterial color="#5a4330" roughness={1} />
      </instancedMesh>
      {crowns.map((ref, k) => (
        <instancedMesh key={k} ref={ref} args={[undefined, undefined, items.length]}>
          <icosahedronGeometry args={[1, 1]} />
          <instancedBufferAttribute attach="instanceColor" args={[colours, 3]} />
          <meshStandardMaterial roughness={1} flatShading />
        </instancedMesh>
      ))}
    </>
  )
}

// Buildings are 16 m x 12.8 m at scale 1, up to scale 1.3, at any rotation:
// the furthest a corner can reach from the centre is the half-diagonal.
const BUILDING_MAX_SCALE = 1.3
const BUILDING_FOOTPRINT = Math.hypot(8 * BUILDING_MAX_SCALE, 6.4 * BUILDING_MAX_SCALE)

// Start candidates beyond the keep-out so street blocks line the walls
// instead of being mostly rejected.
function buildingMinGap(profile: TrackProfile): number {
  return profile.track_width / 2 + profile.barrier_offset + 3 + BUILDING_FOOTPRINT + 1
}

function Buildings({ items }: { items: Prop[] }) {
  const ref = useRef<InstancedMesh>(null)
  const tints = useMemo(() => {
    const palette = ['#f2e6cf', '#e6d5b0', '#ffffff', '#d9cdb8', '#cfe0ee', '#efe2c8']
    const c = new Color()
    const out = new Float32Array(items.length * 3)
    items.forEach((p, i) => {
      c.set(palette[Math.floor(p.rotation * 10) % palette.length])
      out.set([c.r, c.g, c.b], i * 3)
    })
    return out
  }, [items])
  useLayoutEffect(() => {
    const o = new Object3D()
    items.forEach((p, i) => {
      const w = 16 * p.scale
      o.position.set(p.x, p.height / 2, p.z)
      o.rotation.set(0, p.rotation, 0)
      o.scale.set(w, p.height, w * 0.8)
      o.updateMatrix()
      ref.current?.setMatrixAt(i, o.matrix)
    })
    if (ref.current) ref.current.instanceMatrix.needsUpdate = true
  }, [items])
  if (items.length === 0) return null
  return (
    <instancedMesh ref={ref} args={[undefined, undefined, items.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <instancedBufferAttribute attach="instanceColor" args={[tints, 3]} />
      <meshStandardMaterial map={windowsTexture()} roughness={0.7} />
    </instancedMesh>
  )
}

// A grandstand beside the start straight, facing the track. Its extent comes
// from grandstandSpan so it never reaches over a corner (Baku's Turn 1 starts
// ~200 m after the line).
function Grandstand({ profile, from, to, side }: { profile: TrackProfile; from: number; to: number; side: 1 | -1 }) {
  const span = useMemo(() => grandstandSpan(profile, from, to, side), [profile, from, to, side])
  return span ? <GrandstandBody profile={profile} from={span.from} to={span.to} side={side} /> : null
}

function GrandstandBody({ profile, from, to, side }: { profile: TrackProfile; from: number; to: number; side: 1 | -1 }) {
  const normals = useMemo(() => leftNormals(profile), [profile])
  const i0 = indexAt(profile, from)
  const i1 = indexAt(profile, to)
  const [x0, z0] = profile.centerline[i0]
  const [x1, z1] = profile.centerline[i1]
  const mid = indexAt(profile, (from + to) / 2)
  const [nx, nz] = normals[mid]
  const length = Math.hypot(x1 - x0, z1 - z0)
  const heading = Math.atan2(z1 - z0, x1 - x0)
  const back = grandstandBack(profile)
  const cx = (x0 + x1) / 2 + nx * side * back
  const cz = (z0 + z1) / 2 + nz * side * back
  const crowd = useMemo(() => {
    const t = crowdTexture().clone()
    t.repeat.set(Math.max(1, length / 30), 1)
    t.needsUpdate = true
    return t
  }, [length])
  // local frame: +x along the straight, +z = left of travel (side 1)
  return (
    <group position={[cx, 0, cz]} rotation={[0, -heading, 0]}>
      <mesh position={[0, 6, side * 5]} rotation={[side * -0.55, 0, 0]}>
        <boxGeometry args={[length, 0.5, 16]} />
        <meshStandardMaterial map={crowd} roughness={1} />
      </mesh>
      <mesh position={[0, 5.5, side * 11]}>
        <boxGeometry args={[length, 11, 1]} />
        <meshStandardMaterial color="#3b3d42" />
      </mesh>
      <mesh position={[0, 15.5, side * 5]} rotation={[side * 0.12, 0, 0]}>
        <boxGeometry args={[length + 4, 0.4, 18]} />
        <meshStandardMaterial color="#e9eaec" metalness={0.3} roughness={0.5} />
      </mesh>
    </group>
  )
}

function StartFinish({ profile }: { profile: TrackProfile }) {
  const [x0, z0] = profile.centerline[0]
  const [x1, z1] = profile.centerline[1]
  const heading = Math.atan2(z1 - z0, x1 - x0)
  const w = profile.track_width
  const span = w + 2 * Math.min(profile.barrier_offset + 1.5, 6)
  const cells = 12
  const size = w / cells
  const board = sponsorBoard()
  return (
    <group position={[x0, 0.04, z0]} rotation={[0, -heading, 0]}>
      {Array.from({ length: cells * 2 }, (_, k) => {
        const row = k % 2
        const col = Math.floor(k / 2)
        return (
          <mesh key={k} rotation={[-Math.PI / 2, 0, 0]} position={[(row - 0.5) * size, 0, -w / 2 + (col + 0.5) * size]}>
            <planeGeometry args={[size, size]} />
            <meshStandardMaterial color={(row + col) % 2 ? '#111' : '#f5f5f5'} />
          </mesh>
        )
      })}
      {/* Tangerine gantry */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 4.5, side * (span / 2)]}>
          <boxGeometry args={[1.6, 9, 1.6]} />
          <meshStandardMaterial color="#ff7a00" roughness={0.6} />
        </mesh>
      ))}
      <mesh position={[0, 9.4, 0]}>
        <boxGeometry args={[1.4, 2.4, span + 1.6]} />
        <meshStandardMaterial color="#ff7a00" roughness={0.6} />
      </mesh>
      {[1, -1].map((face) => (
        <mesh key={face} position={[face * 0.72, 9.4, 0]} rotation={[0, face * (Math.PI / 2), 0]}>
          <planeGeometry args={[span, 2.1]} />
          <meshStandardMaterial map={board} />
        </mesh>
      ))}
    </group>
  )
}

export function TrackScenery({ profile }: { profile: TrackProfile }) {
  const theme = THEMES[profile.id]
  const parts = useMemo(() => {
    const normals = leftNormals(profile)
    const left = profile.left_edge as Pt[]
    const right = profile.right_edge as Pt[]
    const mask = cornerMask(profile)
    const line = hexToRgb(theme.line)
    const kA = hexToRgb(theme.kerbA)
    const kB = hexToRgb(theme.kerbB)
    const out = (edge: Pt[], side: 1 | -1, d: number) => offset(edge, normals, d, side)
    const barrierL = out(left, 1, profile.barrier_offset)
    const barrierR = out(right, -1, profile.barrier_offset)
    const n = profile.centerline.length
    const step = profile.total_length / Math.max(n - 1, 1)
    const tangerineAt = (i: number) => Math.floor((i * step) / (BOARD_LENGTH * 3)) % 4 !== 3
    const nearStart = (i: number) => {
      const d = i * step
      return d < 450 || d > profile.total_length - 250
    }
    const fenceAt = theme.fence === 'all' ? () => true : nearStart
    const h = theme.barrierHeight
    const runoff = Math.min(profile.barrier_offset, 4)
    return {
      road: uvFlat(left, right, 0.02, 10, 1.5),
      runoffL: uvFlat(left, out(left, 1, runoff), 0.015, 10, 0.5),
      runoffR: uvFlat(right, out(right, -1, runoff), 0.015, 10, 0.5),
      lineL: flatStrip(left, out(left, -1, 0.35), 0.045, () => line),
      lineR: flatStrip(right, out(right, 1, 0.35), 0.045, () => line),
      kerbL: flatStrip(out(left, 1, 1.4), left, 0.05, (i) => (i % 2 ? kA : kB), (i) => mask[i]),
      kerbR: flatStrip(right, out(right, -1, 1.4), 0.05, (i) => (i % 2 ? kA : kB), (i) => mask[i]),
      // the "left" line is on the driver's right: run u backwards so the text reads correctly
      boardsL: uvWall(barrierL, 0, h, -BOARD_LENGTH, tangerineAt),
      boardsR: uvWall(barrierR, 0, h, BOARD_LENGTH, tangerineAt),
      altL: uvWall(barrierL, 0, h, -BOARD_LENGTH, (i) => !tangerineAt(i)),
      altR: uvWall(barrierR, 0, h, BOARD_LENGTH, (i) => !tangerineAt(i)),
      fenceL: uvWall(out(left, 1, profile.barrier_offset + 0.3), h, h + 3.4, 3.4, fenceAt),
      fenceR: uvWall(out(right, -1, profile.barrier_offset + 0.3), h, h + 3.4, 3.4, fenceAt),
      props: scatterProps(profile, {
        count: theme.props === 'trees' ? 320 : 200,
        minGap: theme.props === 'trees' ? profile.barrier_offset + 16 : buildingMinGap(profile),
        maxGap: profile.barrier_offset + 140,
        clearance: profile.barrier_offset + profile.track_width / 2 + (theme.props === 'trees' ? 10 : 3),
        footprint: theme.props === 'trees' ? 0 : BUILDING_FOOTPRINT,
        seed: profile.id === 'baku' ? 11 : 7,
        minHeight: theme.props === 'trees' ? 9 : 14,
        maxHeight: theme.props === 'trees' ? 17 : 70,
      }),
      box: bounds(profile.centerline as Pt[]),
    }
  }, [profile, theme])

  const groundMap = useMemo(() => {
    const t = (theme.ground === 'grass' ? grassTexture() : pavingTexture()).clone()
    t.repeat.set((parts.box.maxX - parts.box.minX + 3000) / 12, (parts.box.maxZ - parts.box.minZ + 3000) / 12)
    t.needsUpdate = true
    return t
  }, [theme.ground, parts.box])

  const { box } = parts
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[box.cx, -0.02, box.cz]}>
        <planeGeometry args={[box.maxX - box.minX + 3000, box.maxZ - box.minZ + 3000]} />
        <meshStandardMaterial map={groundMap} roughness={1} />
      </mesh>
      {theme.ground === 'grass' && (
        <>
          <TexturedStrip strip={parts.runoffL} map={asphaltTexture()} colour="#b9b2a4" />
          <TexturedStrip strip={parts.runoffR} map={asphaltTexture()} colour="#b9b2a4" />
        </>
      )}
      <TexturedStrip strip={parts.road} map={asphaltTexture()} colour="#b8bbc2" roughness={0.95} />
      <ColourStrip strip={parts.lineL} />
      <ColourStrip strip={parts.lineR} />
      <ColourStrip strip={parts.kerbL} />
      <ColourStrip strip={parts.kerbR} />
      <TexturedStrip strip={parts.boardsL} map={sponsorBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.boardsR} map={sponsorBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.altL} map={limitlabBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.altR} map={limitlabBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.fenceL} map={fenceTexture()} transparent />
      <TexturedStrip strip={parts.fenceR} map={fenceTexture()} transparent />
      {theme.props === 'trees' ? <Trees items={parts.props} /> : <Buildings items={parts.props} />}
      <Grandstand profile={profile} from={60} to={300} side={1} />
      <Grandstand profile={profile} from={60} to={300} side={-1} />
      <StartFinish profile={profile} />
    </group>
  )
}
