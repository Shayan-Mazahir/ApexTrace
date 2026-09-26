import { useLayoutEffect, useMemo, useRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Object3D, type InstancedMesh } from 'three'
import type { TrackId, TrackProfile } from '../types/schemas'
import {
  bounds,
  cornerMask,
  flatStrip,
  hexToRgb,
  leftNormals,
  offset,
  scatterProps,
  wallStrip,
  type Pt,
  type StripGeometry,
} from './trackGeometry'

export interface TrackTheme {
  ground: string
  asphalt: string
  asphaltAlt: string
  line: string
  kerbA: string
  kerbB: string
  barrier: string
  barrierAlt: string
  barrierGap: number // metres from the road edge
  barrierHeight: number
  props: 'trees' | 'buildings'
}

export const THEMES: Record<TrackId, TrackTheme> = {
  monza: {
    ground: '#3f6b35',
    asphalt: '#2c2d31',
    asphaltAlt: '#2a2b2f',
    line: '#f2f2f2',
    kerbA: '#d7262e',
    kerbB: '#f4f4f4',
    barrier: '#9aa3ab',
    barrierAlt: '#8b949c',
    barrierGap: 14,
    barrierHeight: 0.9,
    props: 'trees',
  },
  baku: {
    ground: '#8a857c',
    asphalt: '#2e2f33',
    asphaltAlt: '#2c2d31',
    line: '#f2f2f2',
    kerbA: '#d7262e',
    kerbB: '#f4f4f4',
    barrier: '#e8e8e8',
    barrierAlt: '#1f5fbf',
    barrierGap: 1.2,
    barrierHeight: 1.3,
    props: 'buildings',
  },
}

function useStripGeometry(strip: StripGeometry) {
  return useMemo(() => {
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(strip.positions, 3))
    g.setAttribute('color', new BufferAttribute(strip.colors, 3))
    g.setIndex(strip.indices)
    g.computeVertexNormals()
    return g
  }, [strip])
}

// Double-sided: the strip winding depends on which edge is passed first, and
// a culled road is invisible from above.
function Strip({ strip }: { strip: StripGeometry }) {
  const geometry = useStripGeometry(strip)
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial vertexColors side={DoubleSide} roughness={0.9} />
    </mesh>
  )
}

const BUILDING_COLOURS = ['#d8c7a3', '#c9b48c', '#e3d7bd', '#b9a27a', '#9fb3c4', '#cfc6b8', '#a89b86']

function Instances({ items, kind }: { items: { x: number; z: number; scale: number; height: number; rotation: number }[]; kind: 'trees' | 'buildings' }) {
  const trunks = useRef<InstancedMesh>(null)
  const tops = useRef<InstancedMesh>(null)
  // Colours go in as an attribute at creation: setColorAt() after the first
  // render leaves the material compiled without instance colours (all black).
  const colours = useMemo(() => {
    const c = new Color()
    const out = new Float32Array(items.length * 3)
    items.forEach((p, i) => {
      if (kind === 'trees') c.setHSL(0.27 + (p.rotation % 0.06), 0.5, 0.2 + (p.scale - 0.7) * 0.15)
      else c.set(BUILDING_COLOURS[Math.floor(p.rotation * 10) % BUILDING_COLOURS.length])
      out.set([c.r, c.g, c.b], i * 3)
    })
    return out
  }, [items, kind])

  useLayoutEffect(() => {
    const o = new Object3D()
    items.forEach((p, i) => {
      if (kind === 'trees') {
        o.position.set(p.x, 1.5 * p.scale, p.z)
        o.rotation.set(0, p.rotation, 0)
        o.scale.set(p.scale, p.scale, p.scale)
        o.updateMatrix()
        trunks.current?.setMatrixAt(i, o.matrix)
        o.position.set(p.x, (3 + p.height / 2) * p.scale, p.z)
        o.scale.set(p.scale * 1.2, p.scale * (p.height / 6), p.scale * 1.2)
        o.updateMatrix()
        tops.current?.setMatrixAt(i, o.matrix)
      } else {
        const w = 14 * p.scale
        o.position.set(p.x, p.height / 2, p.z)
        o.rotation.set(0, p.rotation, 0)
        o.scale.set(w, p.height, w * 0.8)
        o.updateMatrix()
        tops.current?.setMatrixAt(i, o.matrix)
      }
    })
    if (trunks.current) trunks.current.instanceMatrix.needsUpdate = true
    if (tops.current) tops.current.instanceMatrix.needsUpdate = true
  }, [items, kind])

  if (items.length === 0) return null
  return kind === 'trees' ? (
    <>
      <instancedMesh ref={trunks} args={[undefined, undefined, items.length]}>
        <cylinderGeometry args={[0.25, 0.35, 3, 6]} />
        <meshStandardMaterial color="#5b4028" />
      </instancedMesh>
      <instancedMesh ref={tops} args={[undefined, undefined, items.length]}>
        <coneGeometry args={[3, 6, 8]} />
        <instancedBufferAttribute attach="instanceColor" args={[colours, 3]} />
        <meshStandardMaterial roughness={1} />
      </instancedMesh>
    </>
  ) : (
    <instancedMesh ref={tops} args={[undefined, undefined, items.length]}>
      <boxGeometry args={[1, 1, 1]} />
      <instancedBufferAttribute attach="instanceColor" args={[colours, 3]} />
      <meshStandardMaterial roughness={0.9} />
    </instancedMesh>
  )
}

function StartFinish({ profile }: { profile: TrackProfile }) {
  const [x0, z0] = profile.centerline[0]
  const [x1, z1] = profile.centerline[1]
  const heading = Math.atan2(z1 - z0, x1 - x0)
  const w = profile.track_width
  const cells = 12
  const size = w / cells
  return (
    <group position={[x0, 0.03, z0]} rotation={[0, -heading, 0]}>
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
      {/* gantry */}
      {[1, -1].map((side) => (
        <mesh key={side} position={[0, 3, side * (w / 2 + 1.2)]}>
          <boxGeometry args={[0.3, 6, 0.3]} />
          <meshStandardMaterial color="#222" />
        </mesh>
      ))}
      <mesh position={[0, 6, 0]}>
        <boxGeometry args={[0.6, 0.8, w + 3]} />
        <meshStandardMaterial color="#141414" />
      </mesh>
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
    const a1 = hexToRgb(theme.asphalt)
    const a2 = hexToRgb(theme.asphaltAlt)
    const line = hexToRgb(theme.line)
    const kA = hexToRgb(theme.kerbA)
    const kB = hexToRgb(theme.kerbB)
    const b1 = hexToRgb(theme.barrier)
    const b2 = hexToRgb(theme.barrierAlt)
    const kerbStripe = (i: number) => (Math.floor(i / 1) % 2 ? kA : kB)
    const barrierPaint = (i: number) => (Math.floor(i / 6) % 2 ? b1 : b2)
    const inset = (edge: Pt[], side: 1 | -1, d: number) => offset(edge, normals, d, side)

    return {
      road: flatStrip(left, right, 0.02, (i) => (Math.floor(i / 5) % 2 ? a1 : a2)),
      lineL: flatStrip(left, inset(left, -1, 0.35), 0.04, () => line),
      lineR: flatStrip(right, inset(right, 1, 0.35), 0.04, () => line),
      kerbL: flatStrip(inset(left, 1, 1.4), left, 0.05, kerbStripe, (i) => mask[i]),
      kerbR: flatStrip(right, inset(right, -1, 1.4), 0.05, kerbStripe, (i) => mask[i]),
      wallL: wallStrip(inset(left, 1, theme.barrierGap), 0, theme.barrierHeight, barrierPaint),
      wallR: wallStrip(inset(right, -1, theme.barrierGap), 0, theme.barrierHeight, barrierPaint),
      props: scatterProps(profile, {
        count: theme.props === 'trees' ? 260 : 180,
        minGap: theme.barrierGap + 18,
        maxGap: theme.barrierGap + 120,
        clearance: theme.barrierGap + 14,
        seed: profile.id === 'baku' ? 11 : 7,
        minHeight: theme.props === 'trees' ? 5 : 12,
        maxHeight: theme.props === 'trees' ? 9 : 55,
      }),
      box: bounds(profile.centerline as Pt[]),
    }
  }, [profile, theme])

  const { box } = parts
  return (
    <group>
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[box.cx, -0.02, box.cz]} receiveShadow>
        <planeGeometry args={[box.maxX - box.minX + 3000, box.maxZ - box.minZ + 3000]} />
        <meshStandardMaterial color={theme.ground} roughness={1} />
      </mesh>
      <Strip strip={parts.road} />
      <Strip strip={parts.lineL} />
      <Strip strip={parts.lineR} />
      <Strip strip={parts.kerbL} />
      <Strip strip={parts.kerbR} />
      <Strip strip={parts.wallL} />
      <Strip strip={parts.wallR} />
      <Instances items={parts.props} kind={theme.props} />
      <StartFinish profile={profile} />
    </group>
  )
}
