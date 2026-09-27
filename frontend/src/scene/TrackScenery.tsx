import { Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { useLoader } from '@react-three/fiber'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Object3D, PlaneGeometry, SRGBColorSpace, TextureLoader, type InstancedMesh, type Texture } from 'three'
import type { TrackId, TrackProfile } from '../types/schemas'
import {
  asphaltTexture,
  crowdTexture,
  fenceTexture,
  grassTexture,
  brandBoard,
  pavingTexture,
  sponsorBoard,
  windowsTexture,
} from './textures'
import { BrakeBoards, Kerbs, TyreWalls } from './TrackDetails'
import {
  bounds,
  flatStrip,
  grandstandBack,
  grandstandSpan,
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
  monza: { ground: 'grass', line: '#f2f2f2', kerbA: '#d4121e', kerbB: '#f4f4f4', barrierHeight: 1.0, fence: 'straight', props: 'trees' },
  baku: { ground: 'paving', line: '#f2f2f2', kerbA: '#d4121e', kerbB: '#f4f4f4', barrierHeight: 1.3, fence: 'all', props: 'buildings' },
}

const BOARD_LENGTH = 16 // metres per board image
const GRASS_TILE_M = 24 // one light and one dark mowing stripe

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
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial vertexColors side={DoubleSide} roughness={0.7} />
    </mesh>
  )
}

function TexturedStrip({ strip, map, colour = '#ffffff', transparent = false, roughness = 0.9, metalness = 0 }: {
  strip: UvStrip
  map: Texture
  colour?: string
  transparent?: boolean
  roughness?: number
  metalness?: number
}) {
  const geometry = useUv(strip)
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshStandardMaterial map={map} color={colour} side={DoubleSide} roughness={roughness} metalness={metalness}
        transparent={transparent} alphaTest={transparent ? 0.1 : 0} depthWrite={!transparent} />
    </mesh>
  )
}

// offsets of the three foliage blobs relative to the crown centre
// Trees are impostors of a real fir model (Poly Haven fir_tree_01, baked from
// two sides into public/textures/fir_a.png / fir_b.png by e2e/tmp/bake.mjs).
// Each tree is two crossed textured planes: the model's real silhouette for 4
// triangles, so hundreds of trees stay cheap. Baked lighting, so unlit material.
const TREE_IMAGE_ASPECT = 1024 / 1536
const TREE_IMAGE_HEIGHT_PER_TREE = 1.02 // the bake frames the tree with 2% headroom

function Trees({ items }: { items: Prop[] }) {
  const [texA, texB] = useLoader(TextureLoader, ['/textures/fir_a.png', '/textures/fir_b.png'])
  const planeA = useRef<InstancedMesh>(null)
  const planeB = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(TREE_IMAGE_ASPECT, 1).translate(0, 0.5, 0), [])
  useMemo(() => {
    for (const t of [texA, texB]) {
      t.colorSpace = SRGBColorSpace
      t.anisotropy = 8
      t.needsUpdate = true
    }
  }, [texA, texB])
  const tints = useMemo(() => {
    const c = new Color()
    const out = new Float32Array(items.length * 3)
    items.forEach((p, i) => {
      const v = 0.82 + (p.rotation % 0.25)
      c.setRGB(v * (0.95 + (p.scale % 0.1)), v, v * 0.97)
      out.set([c.r, c.g, c.b], i * 3)
    })
    return out
  }, [items])

  useLayoutEffect(() => {
    const o = new Object3D()
    items.forEach((p, i) => {
      const h = (12 + p.height * 0.6) * p.scale * TREE_IMAGE_HEIGHT_PER_TREE
      o.position.set(p.x, -0.2, p.z)
      o.scale.set(h, h, h)
      o.rotation.set(0, p.rotation, 0)
      o.updateMatrix()
      planeA.current?.setMatrixAt(i, o.matrix)
      o.rotation.set(0, p.rotation + Math.PI / 2, 0)
      o.updateMatrix()
      planeB.current?.setMatrixAt(i, o.matrix)
    })
    for (const m of [planeA.current, planeB.current]) if (m) m.instanceMatrix.needsUpdate = true
  }, [items])

  if (items.length === 0) return null
  return (
    <>
      {[
        [planeA, texA],
        [planeB, texB],
      ].map(([ref, tex], k) => (
        <instancedMesh key={k} ref={ref as React.RefObject<InstancedMesh>} args={[geometry, undefined, items.length]}>
          <instancedBufferAttribute attach="instanceColor" args={[tints, 3]} />
          <meshBasicMaterial map={tex as Texture} alphaTest={0.45} side={DoubleSide} />
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
    const palette = ['#ffffff', '#f4eee4', '#dfe9f4', '#ffffff', '#ece4d4', '#d2e0ee']
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
      <meshStandardMaterial map={windowsTexture()} roughness={0.45} metalness={0.1} />
    </instancedMesh>
  )
}

// A grandstand beside the start straight, facing the track. Its extent comes
// from grandstandSpan so it never reaches over a corner (Baku's Turn 1 starts
// ~200 m after the line).
// Trees and buildings are scattered before the stands are placed, so drop any
// that would poke through a grandstand (or stand in the crowd's footprint).
function keepClearOfGrandstands(profile: TrackProfile, props: Prop[]): Prop[] {
  const spans = ([1, -1] as const)
    .map((side) => grandstandSpan(profile, 60, 300, side))
    .filter((span): span is { from: number; to: number } => span !== null)
  if (spans.length === 0) return props
  const line = profile.centerline as Pt[]
  const reach = grandstandBack(profile) + 34 // stand depth + tree crown radius
  const margin = 25
  const ranges = spans.map((span) => [indexAt(profile, Math.max(0, span.from - margin)), indexAt(profile, span.to + margin)] as const)
  return props.filter((p) => {
    let best = 0
    let bestD = Infinity
    for (let i = 0; i < line.length; i++) {
      const d = Math.hypot(line[i][0] - p.x, line[i][1] - p.z)
      if (d < bestD) {
        bestD = d
        best = i
      }
    }
    if (bestD > reach) return true
    return !ranges.some(([a, b]) => best >= a && best <= b)
  })
}

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
          <mesh key={k} rotation={[-Math.PI / 2, 0, 0]} position={[(row - 0.5) * size, 0, -w / 2 + (col + 0.5) * size]} receiveShadow>
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

export function TrackScenery({ profile, wet = false }: { profile: TrackProfile; wet?: boolean }) {
  const theme = THEMES[profile.id]
  const parts = useMemo(() => {
    const normals = leftNormals(profile)
    const left = profile.left_edge as Pt[]
    const right = profile.right_edge as Pt[]
    // vertex colours are read as linear: convert from the sRGB hex, or every
    // painted colour comes out washed-out pastel
    const line = new Color(theme.line).toArray() as [number, number, number]
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
      // the "left" line is on the driver's right: run u backwards so the text reads correctly
      boardsL: uvWall(barrierL, 0, h, -BOARD_LENGTH, tangerineAt),
      boardsR: uvWall(barrierR, 0, h, BOARD_LENGTH, tangerineAt),
      altL: uvWall(barrierL, 0, h, -BOARD_LENGTH, (i) => !tangerineAt(i)),
      altR: uvWall(barrierR, 0, h, BOARD_LENGTH, (i) => !tangerineAt(i)),
      fenceL: uvWall(out(left, 1, profile.barrier_offset + 0.3), h, h + 3.4, 3.4, fenceAt),
      fenceR: uvWall(out(right, -1, profile.barrier_offset + 0.3), h, h + 3.4, 3.4, fenceAt),
      props: keepClearOfGrandstands(profile, scatterProps(profile, {
        count: theme.props === 'trees' ? 320 : 200,
        minGap: theme.props === 'trees' ? profile.barrier_offset + 16 : buildingMinGap(profile),
        maxGap: profile.barrier_offset + 140,
        clearance: profile.barrier_offset + profile.track_width / 2 + (theme.props === 'trees' ? 10 : 3),
        footprint: theme.props === 'trees' ? 0 : BUILDING_FOOTPRINT,
        seed: profile.id === 'baku' ? 11 : 7,
        minHeight: theme.props === 'trees' ? 9 : 14,
        maxHeight: theme.props === 'trees' ? 17 : 70,
      })),
      box: bounds(profile.centerline as Pt[]),
    }
  }, [profile, theme])

  const groundMap = useMemo(() => {
    const t = (theme.ground === 'grass' ? grassTexture() : pavingTexture()).clone()
    const tile = theme.ground === 'grass' ? GRASS_TILE_M : 12
    t.repeat.set((parts.box.maxX - parts.box.minX + 3000) / tile, (parts.box.maxZ - parts.box.minZ + 3000) / tile)
    t.needsUpdate = true
    return t
  }, [theme.ground, parts.box])

  const { box } = parts
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[box.cx, -0.02, box.cz]} receiveShadow>
        <planeGeometry args={[box.maxX - box.minX + 3000, box.maxZ - box.minZ + 3000]} />
        <meshStandardMaterial map={groundMap} roughness={1} />
      </mesh>
      {theme.ground === 'grass' && (
        <>
          <TexturedStrip strip={parts.runoffL} map={asphaltTexture()} colour="#b9b2a4" />
          <TexturedStrip strip={parts.runoffR} map={asphaltTexture()} colour="#b9b2a4" />
        </>
      )}
      {/* wet: darker and glossy, so the sky and scenery reflect in it */}
      <TexturedStrip strip={parts.road} map={asphaltTexture()} colour={wet ? '#6f757d' : '#c4c7cc'} roughness={wet ? 0.12 : 0.82} metalness={wet ? 0.35 : 0} />
      <ColourStrip strip={parts.lineL} />
      <ColourStrip strip={parts.lineR} />
      <Kerbs profile={profile} red={theme.kerbA} />
      <BrakeBoards profile={profile} />
      {/* street circuits (Baku) keep bare walls: their kerbs reach right up to them */}
      {profile.barrier_offset >= 4 && <TyreWalls profile={profile} />}
      <TexturedStrip strip={parts.boardsL} map={sponsorBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.boardsR} map={sponsorBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.altL} map={brandBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.altR} map={brandBoard()} roughness={0.6} />
      <TexturedStrip strip={parts.fenceL} map={fenceTexture()} transparent />
      <TexturedStrip strip={parts.fenceR} map={fenceTexture()} transparent />
      {theme.props === 'trees' ? (
        <Suspense fallback={null}>
          <Trees items={parts.props} />
        </Suspense>
      ) : (
        <Buildings items={parts.props} />
      )}
      <Grandstand profile={profile} from={60} to={300} side={1} />
      <Grandstand profile={profile} from={60} to={300} side={-1} />
      <StartFinish profile={profile} />
    </group>
  )
}
