import { Line, OrbitControls } from '@react-three/drei'
import type { TrackProfile, VehicleStateMessage } from '../types/schemas'

// Backend (x, y) is planar; map it onto the scene's ground plane (x, z),
// keeping scene y as height.
function toScenePoint(point: [number, number], height: number): [number, number, number] {
  return [point[0], height, point[1]]
}

function Floor({ centerX }: { centerX: number }) {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[centerX, 0, 0]} receiveShadow>
      <planeGeometry args={[500, 200]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

function TrackBoundaries({ profile }: { profile: TrackProfile }) {
  return (
    <>
      <Line points={profile.left_edge.map((p) => toScenePoint(p, 0.02))} color="#ffffff" lineWidth={2} />
      <Line points={profile.right_edge.map((p) => toScenePoint(p, 0.02))} color="#ffffff" lineWidth={2} />
    </>
  )
}

function TrajectoryTrail({ points }: { points: [number, number][] }) {
  if (points.length < 2) return null
  return (
    <Line
      points={points.map((p) => toScenePoint(p, 0.05))}
      color="#ff8c00"
      lineWidth={1.5}
      transparent
      opacity={0.6}
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
}

export function Scene({ trackProfile, vehicleState, trail }: SceneProps) {
  const floorCenterX = trackProfile
    ? trackProfile.approach_length + trackProfile.exit_length / 2
    : 0

  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <Floor centerX={floorCenterX} />
      {trackProfile && <TrackBoundaries profile={trackProfile} />}
      <TrajectoryTrail points={trail} />
      <Car x={vehicleState?.x ?? 0} y={vehicleState?.y ?? 0} heading={vehicleState?.heading ?? 0} />
      <OrbitControls />
    </>
  )
}
