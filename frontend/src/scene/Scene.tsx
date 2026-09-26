import { Line, OrbitControls } from '@react-three/drei'
import type { HazardKind, TrackProfile, VehicleStateMessage } from '../types/schemas'

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
  let minX = 0
  let maxX = 0
  let minZ = 0
  let maxZ = 0
  for (const [x, z] of profile.centerline) {
    minX = Math.min(minX, x)
    maxX = Math.max(maxX, x)
    minZ = Math.min(minZ, z)
    maxZ = Math.max(maxZ, z)
  }
  return { minX, maxX, minZ, maxZ }
}

function Floor({ profile }: { profile: TrackProfile | null }) {
  if (!profile) {
    return (
      <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
        <planeGeometry args={[200, 200]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
    )
  }
  const { minX, maxX, minZ, maxZ } = boundsOf(profile)
  const width = maxX - minX + 100
  const depth = maxZ - minZ + 100
  const centerX = (minX + maxX) / 2
  const centerZ = (minZ + maxZ) / 2
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, 0, centerZ]} receiveShadow>
      <planeGeometry args={[width, depth]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

function TrackBoundaries({ profile }: { profile: TrackProfile }) {
  const left = profile.left_edge.map((p) => toScenePoint(p, 0.02))
  const right = profile.right_edge.map((p) => toScenePoint(p, 0.02))
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
        [sx, 0.03, sz - half],
        [sx, 0.03, sz + half],
      ]}
      color="#ffffff"
      lineWidth={4}
    />
  )
}

function SectorMarkers({ profile }: { profile: TrackProfile }) {
  return (
    <>
      {profile.sectors.map((sector) => (
        <mesh key={sector.index} position={toScenePoint(sector.start_position, 0.6)}>
          <cylinderGeometry args={[0.4, 0.4, 1.2, 8]} />
          <meshStandardMaterial color="#ffffff" transparent opacity={0.5} />
        </mesh>
      ))}
    </>
  )
}

function HazardMarkers({ profile }: { profile: TrackProfile }) {
  return (
    <>
      {profile.hazard_zones.map((hazard) => (
        <mesh key={hazard.id} position={toScenePoint(hazard.position, 0.5)}>
          <coneGeometry args={[0.8, 1, 6]} />
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
      points={points.map((p) => toScenePoint(p, 0.05))}
      color={color}
      lineWidth={1.5}
      transparent
      opacity={opacity}
    />
  )
}

function Car({ x, y, heading }: { x: number; y: number; heading: number }) {
  return (
    <mesh position={[x, 0.4, y]} rotation={[0, -heading, 0]} castShadow>
      <boxGeometry args={[2, 0.8, 1]} />
      <meshStandardMaterial color="#ff8c00" />
    </mesh>
  )
}

interface SceneProps {
  trackProfile: TrackProfile | null
  vehicleState: VehicleStateMessage | null
  trail: [number, number][]
  previousLapTrail: [number, number][]
}

export function Scene({ trackProfile, vehicleState, trail, previousLapTrail }: SceneProps) {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <Floor profile={trackProfile} />
      {trackProfile && (
        <>
          <TrackBoundaries profile={trackProfile} />
          <StartFinishLine profile={trackProfile} />
          <SectorMarkers profile={trackProfile} />
          <HazardMarkers profile={trackProfile} />
        </>
      )}
      <TrajectoryTrail points={previousLapTrail} color="#9ca3af" opacity={0.35} />
      <TrajectoryTrail points={trail} color="#ff8c00" opacity={0.7} />
      <Car x={vehicleState?.x ?? 0} y={vehicleState?.y ?? 0} heading={vehicleState?.heading ?? 0} />
      <OrbitControls />
    </>
  )
}
