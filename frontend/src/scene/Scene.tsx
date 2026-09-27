import { Environment, Lightformer, Line, OrbitControls } from '@react-three/drei'
import { Bloom, BrightnessContrast, EffectComposer, HueSaturation, SMAA, Vignette } from '@react-three/postprocessing'
import { useFrame, useThree } from '@react-three/fiber'
import { Suspense, useEffect, useMemo, useRef, type ElementRef } from 'react'
import { Vector3, type Group, type PerspectiveCamera } from 'three'
import type { HapticSignal } from '../haptics/signal'
import type { HazardZone, TrackProfile } from '../types/schemas'
import { applyCameraShake, DriveEffects } from './DriveEffects'
import { PoseBuffer } from './poseBuffer'
import { CarModel, useCarModelAvailable } from './CarModel'
import { ModelBoundary } from './ModelBoundary'
import { F1Car } from './F1Car'
import { useGraphicsMode } from '../app/graphics'
import { Clouds, contactShadow, RacingLine, RubberLine, SKY_HORIZON, SkyDome, Sun } from './Atmosphere'
import { bounds, type Pt } from './trackGeometry'
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

type ShownPose = { x: number; y: number; heading: number; speed: number; drsOpen: boolean }

// Telemetry arrives at 20 Hz; the car and camera are drawn at display rate,
// easing toward the latest server pose (a few tens of ms behind it).
function useSmoothedPose(pose: CarPose, exact = false) {
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
    const k = exact || first.current || jump ? 1 : 1 - Math.exp(-Math.min(dt, 0.1) * 18)
    first.current = false
    s.x += (t.x - s.x) * k
    s.y += (t.y - s.y) * k
    const dh = ((((t.heading - s.heading + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    s.heading += dh * k
  })
  return shown
}

function CameraRig({ view, profile, shown, haptics }: { view: SceneView; profile: TrackProfile | null; shown: React.MutableRefObject<ShownPose>; haptics?: React.MutableRefObject<HapticSignal> }) {
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

  useFrame((state, dt) => {
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
    if (haptics) applyCameraShake(cam, haptics.current, state.clock.elapsedTime, true)
  })

  const camHeading = useRef<number | null>(null)
  useFrame((state, dt) => {
    if (view !== 'follow') {
      camHeading.current = null
      return
    }
    const cam = camera as PerspectiveCamera
    const p = shown.current
    // Rigidly behind the car (no positional lag, so the car never drifts on
    // screen); only the camera's heading eases after the car's, so it swings
    // smoothly through corners instead of snapping.
    if (camHeading.current === null) camHeading.current = p.heading
    const dh = ((((p.heading - camHeading.current + Math.PI) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI)) - Math.PI
    camHeading.current += dh * (1 - Math.exp(-Math.min(dt, 0.1) * 6))
    const fx = Math.cos(camHeading.current)
    const fz = Math.sin(camHeading.current)
    const back = 8.5 + p.speed * 0.02
    cam.position.set(p.x - fx * back, 2.6 + p.speed * 0.006, p.y - fz * back)
    scratch.look.set(p.x + fx * 10, 0.9, p.y + fz * 10)
    cam.lookAt(scratch.look)
    const fov = 58 + Math.min(p.speed, 88) * 0.14 // widen with speed
    if (Math.abs(cam.fov - fov) > 0.05 || cam.far !== 7000) {
      cam.fov += (fov - cam.fov) * Math.min(1, dt * 3)
      cam.near = 0.3
      cam.far = 7000
      cam.updateProjectionMatrix()
    }
    if (haptics) applyCameraShake(cam, haptics.current, state.clock.elapsedTime, false)
  })

  return <OrbitControls ref={controls} makeDefault enabled={view === 'overview'} enableDamping={false} />
}

const GHOST_LIVERY = { primary: '#9aa3ad', secondary: '#3a3f47', accent: '#cbd5e1' }

function Car({ shown, steering, scale, ghost = false }: { shown: React.MutableRefObject<ShownPose>; steering?: React.MutableRefObject<number>; scale: number; cockpit?: boolean; ghost?: boolean }) {
  const group = useRef<Group>(null)
  const speed = useRef(0)
  const aeroOpen = useRef(false)
  // detailed model when public/models/car.glb exists, else the built-in car
  const hasModel = useCarModelAvailable()
  const builtIn = <F1Car speed={speed} steering={steering} aeroOpen={aeroOpen} hideDriver={false} livery={ghost ? GHOST_LIVERY : undefined} />
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
      {/* soft contact shadow: grounds the car, with or without the sun's shadow map */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[-0.1, 0.012, 0]}>
        <planeGeometry args={[6.6, 3.1]} />
        <meshBasicMaterial map={contactShadow()} transparent depthWrite={false} opacity={ghost ? 0.4 : 1} />
      </mesh>
      {hasModel ? (
        <ModelBoundary fallback={builtIn}>
          <Suspense fallback={builtIn}>
            <CarModel speed={speed} steering={steering} ghost={ghost} />
          </Suspense>
        </ModelBoundary>
      ) : (
        builtIn
      )}
    </group>
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
  // replays: poses are already interpolated exactly; don't add smoothing lag
  exactPose?: boolean
  // live driving: force feedback drives camera shake, sparks, smoke and skid marks
  haptics?: React.MutableRefObject<HapticSignal>
  // BRAKE shown: the corner it is for gets its braking zone painted on the road
  brakeHazard?: HazardZone | null
}

export function Scene({ trackProfile, vehicleState, trail, previousLapTrail, view = 'overview', steering, showRacingLine = false, effects = true, ghost = null, exactPose = false, haptics, brakeHazard = null }: SceneProps) {
  const start = useMemo<CarPose>(() => {
    if (!trackProfile) return { x: 0, y: 0, heading: 0 }
    const [x0, y0] = trackProfile.centerline[0]
    const [x1, y1] = trackProfile.centerline[1]
    return { x: x0, y: y0, heading: Math.atan2(y1 - y0, x1 - x0) }
  }, [trackProfile])
  const shown = useSmoothedPose(vehicleState ?? start, exactPose)
  const shadows = useGraphicsMode() === 'quality'
  const ghostShown = useSmoothedPose(ghost ?? start, exactPose)
  const overview = view === 'overview'

  return (
    <>
      <color attach="background" args={[SKY_HORIZON]} />
      {!overview && <fog attach="fog" args={[SKY_HORIZON, 450, 3400]} />}
      <SkyDome />
      {trackProfile && !overview && <Clouds profile={trackProfile} />}
      {/* offline studio-style reflections (no HDRI download): sky dome, sun strip and ground bounce */}
      {/* reflections and fill light only: too strong and every colour washes out to pastel */}
      <Environment resolution={128} frames={1} environmentIntensity={0.55}>
        <Lightformer form="rect" intensity={0.9} color="#dfeeff" position={[0, 8, 0]} rotation-x={Math.PI / 2} scale={[30, 30, 1]} />
        <Lightformer form="rect" intensity={1.8} color="#fff1dc" position={[12, 5, 6]} scale={[10, 4, 1]} />
        <Lightformer form="rect" intensity={0.5} color="#9fb4c8" position={[-12, 3, -4]} scale={[14, 5, 1]} />
        <Lightformer form="rect" intensity={0.25} color="#5d6a45" position={[0, -6, 0]} rotation-x={-Math.PI / 2} scale={[30, 30, 1]} />
      </Environment>
      <hemisphereLight args={['#bcd6f2', '#4d5a36', 0.55]} />
      <Sun follow={shown} shadows={shadows && !overview} />
      {trackProfile && !overview && <Hills profile={trackProfile} />}
      {trackProfile && <TrackScenery profile={trackProfile} />}
      {trackProfile && <RubberLine profile={trackProfile} />}
      {trackProfile && showRacingLine && <RacingLine profile={trackProfile} />}
      <Trail points={previousLapTrail} color="#9ca3af" opacity={0.5} />
      {overview && <Trail points={trail} color="#ff7a00" opacity={0.95} />}
      {ghost && <Car shown={ghostShown} scale={overview ? 8 : 1} ghost />}
      <Car shown={shown} steering={steering} scale={overview ? 8 : 1} cockpit={view === 'cockpit'} />
      {haptics && !overview && <DriveEffects pose={shown} signal={haptics} profile={trackProfile} brakeHazard={brakeHazard} />}
      <CameraRig view={view} profile={trackProfile} shown={shown} haptics={haptics} />
      {!overview && effects && (
        // Film-style finish: soft glow on bright highlights (lights, sun glints), darker
        // corners, and edge anti-aliasing (the composer bypasses the canvas MSAA).
        <EffectComposer multisampling={0}>
          <SMAA />
          <Bloom intensity={0.35} luminanceThreshold={0.85} luminanceSmoothing={0.2} mipmapBlur />
          {/* a light grade: a touch more contrast and colour, like broadcast footage */}
          <BrightnessContrast contrast={0.07} />
          <HueSaturation saturation={0.14} />
          <Vignette offset={0.3} darkness={0.55} />
        </EffectComposer>
      )}
    </>
  )
}
