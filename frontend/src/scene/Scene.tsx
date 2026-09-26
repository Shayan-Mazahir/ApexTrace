import { Line, OrbitControls } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import { BufferAttribute, BufferGeometry, Vector3 } from 'three'
import type { HazardKind, TrackProfile } from '../types/schemas'

export interface CarPose {
  x: number
  y: number
  heading: number
}

export type SceneView = 'follow' | 'overview'

// Backend (x, y) is planar; map it onto the scene's ground plane (x, z),
// keeping scene y as height.
function toScenePoint(point: [number, number], height: number): [number, number, number] {
  return [point[0], height, point[1]]
}

const HAZARD_COLOR: Record<HazardKind, string> = {
  braking_zone: '#ef4444',
  chicane: '#f59e0b',
  sweeper: '#2dd4bf',
  narrow: '#f59e0b',
}

function boundsOf(profile: TrackProfile) {
  let minX = Infinity
  let maxX = -Infinity
  let minZ = Infinity
  let maxZ = -Infinity
  for (const [x, z] of profile.centerline) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ, cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2 }
}

// Chase camera while driving; a tilted top-down fit of the whole lap otherwise.
function CameraRig({ view, profile, pose }: { view: SceneView; profile: TrackProfile | null; pose: CarPose }) {
  const { camera, size } = useThree()
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const poseRef = useRef(pose)
  poseRef.current = pose
  const scratch = useMemo(() => ({ target: new Vector3(), look: new Vector3() }), [])

  useEffect(() => {
    if (view !== 'overview') return
    const fov = ('fov' in camera ? (camera.fov as number) : 50) * (Math.PI / 180)
    const aspect = size.width / Math.max(size.height, 1)
    let cx = 0
    let cz = 0
    let distance = 200
    if (profile) {
      const b = boundsOf(profile)
      cx = b.cx
      cz = b.cz
      const halfWidth = (b.maxX - b.minX) / 2 + 40
      const halfDepth = (b.maxZ - b.minZ) / 2 + 40
      distance = 1.1 * Math.max(halfWidth / (Math.tan(fov / 2) * aspect), halfDepth / Math.tan(fov / 2))
    }
    // tilted ~26 degrees off vertical so it reads as 3D, not a flat map
    camera.position.set(cx, distance * 0.9, cz + distance * 0.44)
    camera.lookAt(cx, 0, cz)
    camera.far = distance * 4
    camera.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(cx, 0, cz)
      controls.current.update()
    }
  }, [view, profile, size.width, size.height, camera])

  useFrame((_, dt) => {
    if (view !== 'follow') return
    const p = poseRef.current
    const fx = Math.cos(p.heading)
    const fz = Math.sin(p.heading)
    scratch.target.set(p.x - fx * 34, 18, p.y - fz * 34)
    camera.position.lerp(scratch.target, 1 - Math.exp(-dt * 5))
    scratch.look.set(p.x + fx * 22, 0, p.y + fz * 22)
    camera.lookAt(scratch.look)
  })

  return <OrbitControls ref={controls} makeDefault enabled={view === 'overview'} enableDamping={false} />
}

function Floor({ profile }: { profile: TrackProfile | null }) {
  const b = profile ? boundsOf(profile) : { cx: 0, cz: 0, minX: -100, maxX: 100, minZ: -100, maxZ: 100 }
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[b.cx, -0.5, b.cz]}>
      <planeGeometry args={[b.maxX - b.minX + 6000, b.maxZ - b.minZ + 6000]} />
      <meshStandardMaterial color="#141414" />
    </mesh>
  )
}

// The road as a surface between the two edges (the edge lines alone read as
// hairlines from any distance).
function RoadSurface({ profile }: { profile: TrackProfile }) {
  const geometry = useMemo(() => {
    const n = profile.left_edge.length
    const positions = new Float32Array(n * 2 * 3)
    for (let i = 0; i < n; i++) {
      const [lx, lz] = profile.left_edge[i]
      const [rx, rz] = profile.right_edge[i]
      positions.set([lx, 0.02, lz, rx, 0.02, rz], i * 6)
    }
    const indices: number[] = []
    for (let i = 0; i < n - 1; i++) {
      const a = i * 2
      indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2)
    }
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(positions, 3))
    g.setIndex(indices)
    g.computeVertexNormals()
    return g
  }, [profile])
  return (
    <mesh geometry={geometry}>
      <meshStandardMaterial color="#3a3a3a" side={2} />
    </mesh>
  )
}

function TrackBoundaries({ profile }: { profile: TrackProfile }) {
  const left = profile.left_edge.map((p) => toScenePoint(p, 0.05))
  const right = profile.right_edge.map((p) => toScenePoint(p, 0.05))
  return (
    <>
      <Line points={[...left, left[0]]} color="#ffffff" lineWidth={2} />
      <Line points={[...right, right[0]]} color="#ffffff" lineWidth={2} />
    </>
  )
}

function StartFinishLine({ profile }: { profile: TrackProfile }) {
  const half = profile.track_width / 2
  const [sx, sz] = profile.start_finish
  return (
    <Line
      points={[
        [sx, 0.08, sz - half],
        [sx, 0.08, sz + half],
      ]}
      color="#ffffff"
      lineWidth={5}
    />
  )
}

function SectorMarkers({ profile, scale }: { profile: TrackProfile; scale: number }) {
  return (
    <>
      {profile.sectors.map((sector) => (
        <mesh key={sector.index} position={toScenePoint(sector.start_position, 0.6 * scale)} scale={scale}>
          <cylinderGeometry args={[0.4, 0.4, 1.2, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.6} />
        </mesh>
      ))}
    </>
  )
}

function HazardMarkers({ profile, scale }: { profile: TrackProfile; scale: number }) {
  return (
    <>
      {profile.hazard_zones.map((hazard) => (
        <mesh key={hazard.id} position={toScenePoint(hazard.position, 0.6 * scale)} scale={scale}>
          <coneGeometry args={[0.8, 1.2, 6]} />
          <meshStandardMaterial color={HAZARD_COLOR[hazard.kind]} />
        </mesh>
      ))}
    </>
  )
}

function TrajectoryTrail({ points, color, opacity }: { points: [number, number][]; color: string; opacity: number }) {
  if (points.length < 2) return null
  return (
    <Line
      points={points.map((p) => toScenePoint(p, 0.12))}
      color={color}
      lineWidth={2}
      transparent
      opacity={opacity}
    />
  )
}

function Car({ pose, scale }: { pose: CarPose; scale: number }) {
  return (
    <group position={[pose.x, 0, pose.y]} rotation={[0, -pose.heading, 0]}>
      <mesh position={[0, 0.4 * scale, 0]} scale={scale}>
        <boxGeometry args={[4, 0.8, 1.8]} />
        <meshStandardMaterial color="#ff8c00" />
      </mesh>
      <mesh position={[-0.6 * scale, 0.95 * scale, 0]} scale={scale}>
        <boxGeometry args={[1.6, 0.5, 1]} />
        <meshStandardMaterial color="#ffb347" />
      </mesh>
    </group>
  )
}

interface SceneProps {
  trackProfile: TrackProfile | null
  vehicleState: CarPose | null
  trail: [number, number][]
  previousLapTrail: [number, number][]
  view?: SceneView
}

export function Scene({ trackProfile, vehicleState, trail, previousLapTrail, view = 'overview' }: SceneProps) {
  const pose = vehicleState ?? { x: 0, y: 0, heading: 0 }
  // markers and the car are drawn larger when the whole lap is in view
  const scale = view === 'overview' ? 4 : 1
  return (
    <>
      <ambientLight intensity={0.7} />
      <directionalLight position={[50, 100, 30]} intensity={1.1} />
      <Floor profile={trackProfile} />
      {trackProfile && (
        <>
          <RoadSurface profile={trackProfile} />
          <TrackBoundaries profile={trackProfile} />
          <StartFinishLine profile={trackProfile} />
          <SectorMarkers profile={trackProfile} scale={scale} />
          <HazardMarkers profile={trackProfile} scale={scale} />
        </>
      )}
      <TrajectoryTrail points={previousLapTrail} color="#9ca3af" opacity={0.4} />
      <TrajectoryTrail points={trail} color="#ff8c00" opacity={0.9} />
      <Car pose={pose} scale={scale} />
      <CameraRig view={view} profile={trackProfile} pose={pose} />
    </>
  )
}
