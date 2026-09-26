import { Line, OrbitControls, Sky } from '@react-three/drei'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import { Vector3, type Group, type PerspectiveCamera } from 'three'
import type { TrackProfile } from '../types/schemas'
import { F1Car } from './F1Car'
import { bounds, type Pt } from './trackGeometry'
import { TrackScenery } from './TrackScenery'

export interface CarPose {
  x: number
  y: number
  heading: number
  speed?: number
}

export type SceneView = 'follow' | 'overview'

const SKY_HORIZON = '#bcd3e6'

type ShownPose = { x: number; y: number; heading: number; speed: number }

// Telemetry arrives at 20 Hz; the car and camera are drawn at display rate,
// easing toward the latest server pose (a few tens of ms behind it).
function useSmoothedPose(pose: CarPose) {
  const target = useRef(pose)
  target.current = pose
  const shown = useRef<ShownPose>({ x: pose.x, y: pose.y, heading: pose.heading, speed: pose.speed ?? 0 })
  const first = useRef(true)
  useFrame((_, dt) => {
    const t = target.current
    const s = shown.current
    const jump = Math.hypot(t.x - s.x, t.y - s.y) > 60 // reset / new track: snap
    const k = first.current || jump ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 18)
    first.current = false
    s.x += (t.x - s.x) * k
    s.y += (t.y - s.y) * k
    const dh = ((((t.heading - s.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    s.heading += dh * k
    s.speed = t.speed ?? 0
  })
  return shown
}

function CameraRig({ view, profile, shown }: { view: SceneView; profile: TrackProfile | null; shown: React.MutableRefObject<ShownPose> }) {
  const { camera, size } = useThree()
  const controls = useRef<ElementRef<typeof OrbitControls>>(null)
  const scratch = useMemo(() => ({ target: new Vector3(), look: new Vector3() }), [])

  useEffect(() => {
    if (view !== 'overview') return
    const cam = camera as PerspectiveCamera
    cam.fov = 50
    const fov = (cam.fov * Math.PI) / 180
    const aspect = size.width / Math.max(size.height, 1)
    let cx = 0
    let cz = 0
    let distance = 300
    if (profile) {
      const b = bounds(profile.centerline as Pt[])
      cx = b.cx
      cz = b.cz
      const halfW = (b.maxX - b.minX) / 2 + 60
      const halfD = (b.maxZ - b.minZ) / 2 + 60
      distance = 1.08 * Math.max(halfW / (Math.tan(fov / 2) * aspect), halfD / Math.tan(fov / 2))
    }
    cam.position.set(cx, distance * 0.92, cz + distance * 0.38)
    cam.lookAt(cx, 0, cz)
    cam.near = 1
    cam.far = distance * 5
    cam.updateProjectionMatrix()
    if (controls.current) {
      controls.current.target.set(cx, 0, cz)
      controls.current.update()
    }
  }, [view, profile, size.width, size.height, camera])

  useFrame((_, dt) => {
    if (view !== 'follow') return
    const cam = camera as PerspectiveCamera
    const p = shown.current
    const fx = Math.cos(p.heading)
    const fz = Math.sin(p.heading)
    const back = 8.5 + p.speed * 0.02
    scratch.target.set(p.x - fx * back, 2.6 + p.speed * 0.006, p.y - fz * back)
    if (cam.position.distanceTo(scratch.target) > 150) cam.position.copy(scratch.target) // coming from overview: snap
    else cam.position.lerp(scratch.target, 1 - Math.exp(-Math.min(dt, 0.1) * 7))
    scratch.look.set(p.x + fx * 10, 0.9, p.y + fz * 10)
    cam.lookAt(scratch.look)
    const fov = 58 + Math.min(p.speed, 88) * 0.14 // widen with speed
    if (Math.abs(cam.fov - fov) > 0.05 || cam.far !== 4000) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3)
      cam.near = 0.3
      cam.far = 4000
      cam.updateProjectionMatrix()
    }
  })

  return <OrbitControls ref={controls} makeDefault enabled={view === 'overview'} enableDamping={false} />
}

function Car({ shown, steering, scale }: { shown: React.MutableRefObject<ShownPose>; steering?: React.MutableRefObject<number>; scale: number }) {
  const group = useRef<Group>(null)
  const speed = useRef(0)
  useFrame(() => {
    const p = shown.current
    speed.current = p.speed
    if (group.current) {
      group.current.position.set(p.x, 0.02, p.y)
      group.current.rotation.set(0, -p.heading, 0)
    }
  })
  return (
    <group ref={group} scale={scale}>
      {scale > 1 && (
        // position ring so the car is findable when the whole lap is in view
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.3, 0]}>
          <ringGeometry args={[3.2, 4.4, 40]} />
          <meshBasicMaterial color="#ff7a00" transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
      {/* soft contact shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.1, 0.01, 0]}>
        <planeGeometry args={[5.6, 2.3]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <F1Car speed={speed} steering={steering} />
    </group>
  )
}

function Trail({ points, color, opacity }: { points: [number, number][]; color: string; opacity: number }) {
  if (points.length < 2) return null
  return <Line points={points.map(([x, z]) => [x, 0.15, z] as [number, number, number])} color={color} lineWidth={2} transparent opacity={opacity} />
}

interface SceneProps {
  trackProfile: TrackProfile | null
  vehicleState: CarPose | null
  trail: [number, number][]
  previousLapTrail: [number, number][]
  view?: SceneView
  steering?: React.MutableRefObject<number>
}

export function Scene({ trackProfile, vehicleState, trail, previousLapTrail, view = 'overview', steering }: SceneProps) {
  const start = useMemo<CarPose>(() => {
    if (!trackProfile) return { x: 0, y: 0, heading: 0 }
    const [x0, y0] = trackProfile.centerline[0]
    const [x1, y1] = trackProfile.centerline[1]
    return { x: x0, y: y0, heading: Math.atan2(y1 - y0, x1 - x0) }
  }, [trackProfile])
  const shown = useSmoothedPose(vehicleState ?? start)
  const overview = view === 'overview'

  return (
    <>
      <color attach="background" args={[SKY_HORIZON]} />
      {!overview && <fog attach="fog" args={[SKY_HORIZON, 250, 1400]} />}
      <Sky distance={3000} sunPosition={[400, 220, 300]} turbidity={6} rayleigh={1.2} mieCoefficient={0.004} />
      <hemisphereLight args={['#dfeaf5', '#4d5a3c', 0.85]} />
      <directionalLight position={[300, 400, 200]} intensity={1.6} />
      {trackProfile && <TrackScenery profile={trackProfile} />}
      <Trail points={previousLapTrail} color="#9ca3af" opacity={0.5} />
      {overview && <Trail points={trail} color="#ff7a00" opacity={0.95} />}
      <Car shown={shown} steering={steering} scale={overview ? 8 : 1} />
      <CameraRig view={view} profile={trackProfile} shown={shown} />
    </>
  )
}
