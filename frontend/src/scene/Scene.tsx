import { Environment, Lightformer, Line, OrbitControls, Sky } from '@react-three/drei'
import { Bloom, EffectComposer, SMAA, Vignette } from '@react-three/postprocessing'
import { useFrame, useThree } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type ElementRef } from 'react'
import { BufferAttribute, BufferGeometry, Color, DoubleSide, Vector3, type Group, type PerspectiveCamera } from 'three'
import type { TrackProfile } from '../types/schemas'
import { PoseBuffer } from './poseBuffer'
import { F1Car } from './F1Car'
import { computeRacingLine } from './racingLine'
import { bounds, flatStrip, type Pt } from './trackGeometry'
import { TrackScenery } from './TrackScenery'

export interface CarPose {
  x: number
  y: number
  heading: number
  speed?: number
  drsOpen?: boolean
  t?: number // server time: enables jitter-free interpolation
}

export type SceneView = 'cockpit' | 'follow' | 'overview'

// Driver's eye in car-local coordinates (x forward, y up): just above the
// helmet, under the halo, so the halo and nose frame the view like an onboard.
// Raised camera behind the helmet (like a sim's halo/roll-hoop cam) so the nose,
// front wheels, suspension, halo and steering wheel are all visible.
const EYE = { x: -0.55, y: 1.42 }
const EYE_LOOK_AHEAD = 9 // metres
const EYE_LOOK_HEIGHT = -0.75

const SKY_HORIZON = '#bcd3e6'

type ShownPose = { x: number; y: number; heading: number; speed: number; drsOpen: boolean }

// Telemetry arrives at 20 Hz; the car and camera are drawn at display rate,
// easing toward the latest server pose (a few tens of ms behind it).
function useSmoothedPose(pose: CarPose) {
  const target = useRef(pose)
  target.current = pose
  const shown = useRef<ShownPose>({ x: pose.x, y: pose.y, heading: pose.heading, speed: pose.speed ?? 0, drsOpen: false })
  const buffer = useMemo(() => new PoseBuffer(), [])
  const first = useRef(true)
  useEffect(() => {
    if (pose.t !== undefined) buffer.push({ t: pose.t, x: pose.x, y: pose.y, heading: pose.heading })
  }, [pose.t, pose.x, pose.y, pose.heading, buffer])
  useFrame((_, dt) => {
    const t = target.current
    const s = shown.current
    s.speed = t.speed ?? 0
    s.drsOpen = t.drsOpen ?? false
    const p = t.t !== undefined ? buffer.sample(Math.min(dt, 0.1)) : null
    if (p) {
      s.x = p.x
      s.y = p.y
      s.heading = p.heading
      return
    }
    // no server timestamps (replays, idle): exponential follow
    const jump = Math.hypot(t.x - s.x, t.y - s.y) > 60
    const k = first.current || jump ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 18)
    first.current = false
    s.x += (t.x - s.x) * k
    s.y += (t.y - s.y) * k
    const dh = ((((t.heading - s.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    s.heading += dh * k
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
    if (view !== 'cockpit') return
    // Rigidly attached to the car: any lag would make the cockpit swim.
    const cam = camera as PerspectiveCamera
    const p = shown.current
    const fx = Math.cos(p.heading)
    const fz = Math.sin(p.heading)
    cam.position.set(p.x + fx * EYE.x, EYE.y, p.y + fz * EYE.x)
    scratch.look.set(p.x + fx * EYE_LOOK_AHEAD, EYE_LOOK_HEIGHT, p.y + fz * EYE_LOOK_AHEAD)
    cam.lookAt(scratch.look)
    const fov = 74 + Math.min(p.speed, 88) * 0.1 // widen a little with speed
    if (Math.abs(cam.fov - fov) > 0.05 || cam.near !== 0.25 || cam.far !== 7000) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3)
      // The halo is ~0.34 m from the eye. Going much nearer than this costs the
      // depth precision that separates the asphalt (2 cm) from the grass below.
      cam.near = 0.25
      cam.far = 7000
      cam.updateProjectionMatrix()
    }
  })

  useFrame((_, dt) => {
    if (view !== 'follow') return
    const cam = camera as PerspectiveCamera
    const p = shown.current
    const fx = Math.cos(p.heading)
    const fz = Math.sin(p.heading)
    const back = 8.5 + p.speed * 0.02
    scratch.target.set(p.x - fx * back, 2.6 + p.speed * 0.006, p.y - fz * back)
    if (cam.position.distanceTo(scratch.target) > 150) cam.position.copy(scratch.target) // coming from overview: snap
    else cam.position.lerp(scratch.target, 1 - Math.exp(-Math.min(dt, 0.1) * 12))
    scratch.look.set(p.x + fx * 10, 0.9, p.y + fz * 10)
    cam.lookAt(scratch.look)
    const fov = 58 + Math.min(p.speed, 88) * 0.14 // widen with speed
    if (Math.abs(cam.fov - fov) > 0.05 || cam.far !== 7000) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3)
      cam.near = 0.3
      cam.far = 7000
      cam.updateProjectionMatrix()
    }
  })

  return <OrbitControls ref={controls} makeDefault enabled={view === 'overview'} enableDamping={false} />
}

const GHOST_LIVERY = { primary: '#9aa3ad', secondary: '#3a3f47', accent: '#cbd5e1' }

function Car({ shown, steering, scale, ghost = false }: { shown: React.MutableRefObject<ShownPose>; steering?: React.MutableRefObject<number>; scale: number; cockpit?: boolean; ghost?: boolean }) {
  const group = useRef<Group>(null)
  const speed = useRef(0)
  const aeroOpen = useRef(false)
  useFrame(() => {
    const p = shown.current
    speed.current = p.speed
    aeroOpen.current = p.drsOpen
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
          <meshBasicMaterial color={ghost ? '#cbd5e1' : '#ff7a00'} transparent opacity={0.9} depthWrite={false} />
        </mesh>
      )}
      {/* soft contact shadow */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.1, 0.01, 0]}>
        <planeGeometry args={[5.6, 2.3]} />
        <meshBasicMaterial color="#000" transparent opacity={0.35} depthWrite={false} />
      </mesh>
      <F1Car speed={speed} steering={steering} aeroOpen={aeroOpen} hideDriver={false} livery={ghost ? GHOST_LIVERY : undefined} />
    </group>
  )
}

const RACING_LINE_WIDTH = 0.6 // metres
const RACING_LINE_Y = 0.035 // above the asphalt (0.02), below the white edge lines (0.045)
// Color() converts the sRGB hex to the renderer's linear working space, so
// the stripe stays saturated instead of washing out.
const THROTTLE_RGB = new Color('#22c55e').toArray() as [number, number, number]
const BRAKE_RGB = new Color('#ef4444').toArray() as [number, number, number]

// Painted guide line: green where the car model can accelerate, red where it
// has to brake for the next corner (see racingLine.ts).
function RacingLine({ profile }: { profile: TrackProfile }) {
  const geometry = useMemo(() => {
    const { points, phase } = computeRacingLine(profile)
    const half = RACING_LINE_WIDTH / 2
    const side = (sign: 1 | -1): Pt[] =>
      points.map(([x, y], i) => {
        const [ax, ay] = points[Math.max(0, i - 1)]
        const [bx, by] = points[Math.min(points.length - 1, i + 1)]
        const len = Math.hypot(bx - ax, by - ay) || 1
        return [x - ((by - ay) / len) * half * sign, y + ((bx - ax) / len) * half * sign]
      })
    const strip = flatStrip(side(1), side(-1), RACING_LINE_Y, (i) => (phase[i] === 'brake' ? BRAKE_RGB : THROTTLE_RGB))
    const g = new BufferGeometry()
    g.setAttribute('position', new BufferAttribute(strip.positions, 3))
    g.setAttribute('color', new BufferAttribute(strip.colors, 3))
    g.setIndex(strip.indices)
    return g
  }, [profile])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors transparent opacity={0.95} depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}

function Trail({ points, color, opacity }: { points: [number, number][]; color: string; opacity: number }) {
  if (points.length < 2) return null
  return <Line points={points.map(([x, z]) => [x, 0.15, z] as [number, number, number])} color={color} lineWidth={2} transparent opacity={opacity} />
}

// Distant ridge line: a ring of low-poly hills fading into the fog, so the
// horizon has depth instead of ending at a flat plane.
function Hills({ profile }: { profile: TrackProfile }) {
  const hills = useMemo(() => {
    let cx = 0
    let cz = 0
    for (const [x, z] of profile.centerline) {
      cx += x
      cz += z
    }
    cx /= profile.centerline.length
    cz /= profile.centerline.length
    let reach = 0
    for (const [x, z] of profile.centerline) reach = Math.max(reach, Math.hypot(x - cx, z - cz))
    let seed = 11
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647)
    return Array.from({ length: 46 }, (_, i) => {
      const a = (i / 46) * Math.PI * 2 + rnd() * 0.08
      const r = reach + 1500 + rnd() * 500
      const h = 90 + rnd() * 240
      return { x: cx + Math.cos(a) * r, z: cz + Math.sin(a) * r, h, w: h * (2.4 + rnd() * 1.6), tone: rnd() }
    })
  }, [profile])
  return (
    <group>
      {hills.map((hill, i) => (
        <mesh key={i} position={[hill.x, hill.h / 2 - 6, hill.z]} scale={[hill.w, hill.h, hill.w]}>
          <coneGeometry args={[0.5, 1, 7]} />
          <meshLambertMaterial color={hill.tone > 0.5 ? '#5b7d68' : '#6b8a73'} />
        </mesh>
      ))}
    </group>
  )
}

interface SceneProps {
  trackProfile: TrackProfile | null
  vehicleState: CarPose | null
  trail: [number, number][]
  previousLapTrail: [number, number][]
  view?: SceneView
  steering?: React.MutableRefObject<number>
  showRacingLine?: boolean
  effects?: boolean
  // a second car drawn in grey (e.g. the no-upgrades run in a replay)
  ghost?: CarPose | null
}

export function Scene({ trackProfile, vehicleState, trail, previousLapTrail, view = 'overview', steering, showRacingLine = false, effects = true, ghost = null }: SceneProps) {
  const start = useMemo<CarPose>(() => {
    if (!trackProfile) return { x: 0, y: 0, heading: 0 }
    const [x0, y0] = trackProfile.centerline[0]
    const [x1, y1] = trackProfile.centerline[1]
    return { x: x0, y: y0, heading: Math.atan2(y1 - y0, x1 - x0) }
  }, [trackProfile])
  const shown = useSmoothedPose(vehicleState ?? start)
  const ghostShown = useSmoothedPose(ghost ?? start)
  const overview = view === 'overview'

  return (
    <>
      <color attach="background" args={[SKY_HORIZON]} />
      {!overview && <fog attach="fog" args={[SKY_HORIZON, 350, 2900]} />}
      <Sky distance={4500} sunPosition={[500, 150, 280]} turbidity={5} rayleigh={1.6} mieCoefficient={0.006} mieDirectionalG={0.85} />
      {/* offline studio-style reflections (no HDRI download): sky dome, sun strip and ground bounce */}
      <Environment resolution={128} frames={1}>
        <Lightformer form="rect" intensity={0.9} color="#dfeeff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={1.8} color="#fff1dc" position={[12, 5, 6]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#9fb4c8" position={[-12, 3, -4]} scale={[14, 5, 1]} />
        <Lightformer form="rect" intensity={0.25} color="#5d6a45" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
      </Environment>
      <hemisphereLight args={['#cfe2f5', '#55613f', 0.45]} />
      <directionalLight position={[500, 300, 280]} intensity={1.6} color="#fff1dc" />
      {trackProfile && !overview && <Hills profile={trackProfile} />}
      {trackProfile && <TrackScenery profile={trackProfile} />}
      {trackProfile && showRacingLine && <RacingLine profile={trackProfile} />}
      <Trail points={previousLapTrail} color="#9ca3af" opacity={0.5} />
      {overview && <Trail points={trail} color="#ff7a00" opacity={0.95} />}
      {ghost && <Car shown={ghostShown} scale={overview ? 8 : 1} ghost />}
      <Car shown={shown} steering={steering} scale={overview ? 8 : 1} cockpit={view === 'cockpit'} />
      <CameraRig view={view} profile={trackProfile} shown={shown} />
      {!overview && effects && (
        // Film-style finish: soft glow on bright highlights (lights, sun glints), darker
        // corners, and edge anti-aliasing (the composer bypasses the canvas MSAA).
        <EffectComposer multisampling={0}>
          <SMAA />
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          <Vignette offset={0.3} darkness={0.55} />
        </EffectComposer>
      )}
    </>
  )
}
