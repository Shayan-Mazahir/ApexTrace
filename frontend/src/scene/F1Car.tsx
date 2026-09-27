import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { DoubleSide, Quaternion, Shape, Vector2, Vector3, type Group } from 'three'
import { wordmark } from './textures'

export interface Livery {
  primary: string
  secondary: string
  accent: string
}

export const DEFAULT_LIVERY: Livery = { primary: '#ff8000', secondary: '#121214', accent: '#2dd4bf' }

const CARBON = '#1b1b1d'
const TYRE = '#141414'
const RIM = '#8a8f96'

// 2026-regulation proportions (metres, local +x forward, +z left):
// 3.4 m wheelbase, 1.9 m overall width, 18" wheels on 705 mm tyres,
// fronts 280 mm wide and rears 375 mm.
const FRONT_AXLE = 1.72
const REAR_AXLE = -1.68
const WHEEL_R = 0.3525
const FRONT_TYRE_W = 0.28
const REAR_TYRE_W = 0.375
const FRONT_TRACK = 0.95 - FRONT_TYRE_W / 2 // wheel centre from the car's centreline
const REAR_TRACK = 0.95 - REAR_TYRE_W / 2
// X-mode (active aero) flap rotation, radians
const FLAP_OPEN = 0.55

// Top-view outline of the survival cell + sidepods + engine cover (x forward,
// y = half-width), extruded upward. 2026 sidepods are slimmer with a deep undercut.
function bodyShape(): Shape {
  const s = new Shape()
  const pts: [number, number][] = [
    [2.35, 0.08],
    [1.55, 0.13],
    [0.9, 0.26],
    [0.45, 0.34],
    [0.1, 0.6],
    [-0.55, 0.62],
    [-1.2, 0.4],
    [-1.75, 0.22],
    [-2.1, 0.16],
  ]
  s.moveTo(pts[0][0], -pts[0][1])
  for (const [x, y] of pts) s.lineTo(x, y)
  for (const [x, y] of [...pts].reverse()) s.lineTo(x, -y)
  s.closePath()
  return s
}

// Tyre cross-section revolved about the axle: rounded shoulders and a
// slightly bulging sidewall instead of a plain cylinder.
function tyreProfile(radius: number, width: number, rim: number): Vector2[] {
  const h = width / 2
  const pts: [number, number][] = [
    [rim, -h * 0.9], [radius - 0.05, -h * 1.02], [radius - 0.018, -h * 0.98], [radius - 0.004, -h * 0.82],
    [radius, -h * 0.55], [radius, h * 0.55], [radius - 0.004, h * 0.82], [radius - 0.018, h * 0.98],
    [radius - 0.05, h * 1.02], [rim, h * 0.9],
  ]
  return pts.map(([r, y]) => new Vector2(r, y))
}

// Push-rod/wishbone: a thin carbon strut between two points.
function Strut({ from, to, r = 0.012 }: { from: [number, number, number]; to: [number, number, number]; r?: number }) {
  const { pos, quat, len } = useMemo(() => {
    const a = new Vector3(...from)
    const b = new Vector3(...to)
    const dir = b.clone().sub(a)
    const len = dir.length()
    const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), dir.normalize())
    return { pos: a.add(b).multiplyScalar(0.5), quat, len }
  }, [from, to])
  return (
    <mesh position={pos} quaternion={quat}>
      <cylinderGeometry args={[r, r, len, 8]} />
      <meshStandardMaterial color={CARBON} roughness={0.5} metalness={0.3} />
    </mesh>
  )
}

function Wheel({ x, z, width, front, spin, steer }: {
  x: number
  z: number
  width: number
  front: boolean
  spin: React.MutableRefObject<number>
  steer: React.MutableRefObject<number>
}) {
  const steerGroup = useRef<Group>(null)
  const spinGroup = useRef<Group>(null)
  useFrame(() => {
    if (spinGroup.current) spinGroup.current.rotation.z = -spin.current / WHEEL_R
    if (steerGroup.current && front) steerGroup.current.rotation.y = -steer.current * 0.35
  })
  const outer = Math.sign(z)
  const rim = WHEEL_R * 0.65 // 18" rim inside a 705 mm tyre: low sidewall
  return (
    <group position={[x, WHEEL_R, z]} ref={steerGroup}>
      <group ref={spinGroup}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <latheGeometry args={[tyreProfile(WHEEL_R, width, rim * 0.98), 48]} />
          <meshStandardMaterial color={TYRE} roughness={0.85} envMapIntensity={0.4} />
        </mesh>
        {/* tread contact patch: darker band so the tyre reads as rubber */}
        <mesh rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[WHEEL_R + 0.001, WHEEL_R + 0.001, width * 0.62, 48, 1, true]} />
          <meshStandardMaterial color="#0b0b0c" roughness={1} />
        </mesh>
        {/* tyre sidewall marking and rim */}
        <mesh position={[0, 0, outer * (width / 2 + 0.002)]}>
          <torusGeometry args={[WHEEL_R * 0.84, 0.014, 8, 40]} />
          <meshStandardMaterial color="#ffd400" />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, outer * (width / 2 + 0.003)]}>
          <cylinderGeometry args={[rim, rim, 0.01, 28]} />
          <meshStandardMaterial color={RIM} metalness={0.85} roughness={0.3} />
        </mesh>
        {/* 2026: wheel covers are gone, spokes are visible */}
        {[0, 1, 2].map((k) => (
          <mesh key={k} position={[0, 0, outer * (width / 2 + 0.008)]} rotation={[0, 0, (k * Math.PI) / 3]}>
            <boxGeometry args={[rim * 1.9, 0.04, 0.012]} />
            <meshStandardMaterial color="#3a3d42" metalness={0.6} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

function SteeringWheel({ steer }: { steer: React.MutableRefObject<number> }) {
  const wheel = useRef<Group>(null)
  useFrame(() => {
    // driver input -1..1 maps to about +/-140 degrees of hand-wheel rotation
    if (wheel.current) wheel.current.rotation.x = -steer.current * 2.4
  })
  return (
    <group position={[0.5, 0.7, 0]} rotation={[0, 0, -0.95]}>
      <group ref={wheel}>
        <mesh>
          <boxGeometry args={[0.03, 0.12, 0.3]} />
          <meshStandardMaterial color="#141416" roughness={0.45} metalness={0.4} />
        </mesh>
        <mesh position={[0.018, 0.005, 0]}>
          <boxGeometry args={[0.008, 0.055, 0.1]} />
          <meshStandardMaterial color="#071018" emissive="#4be1ff" emissiveIntensity={0.9} />
        </mesh>
        {[1, -1].map((side) => (
          <mesh key={side} position={[0, -0.005, side * 0.16]}>
            <boxGeometry args={[0.05, 0.13, 0.05]} />
            <meshStandardMaterial color="#2b2b2f" roughness={0.9} />
          </mesh>
        ))}
        {[-1, 1].map((k) => (
          <mesh key={`b${k}`} position={[0.02, 0.03 * k, k * 0.09]}>
            <cylinderGeometry args={[0.013, 0.013, 0.01, 12]} />
            <meshStandardMaterial color={k > 0 ? '#22c55e' : '#ef4444'} />
          </mesh>
        ))}
      </group>
    </group>
  )
}

// A two-element wing whose upper flap rotates open in X-mode.
function ActiveFlap({ position, width, chord, open, openDir, color }: {
  position: [number, number, number]
  width: number
  chord: number
  open: React.MutableRefObject<number>
  openDir: 1 | -1
  color: string
}) {
  const ref = useRef<Group>(null)
  useFrame(() => {
    if (ref.current) ref.current.rotation.z = 0.32 * openDir - open.current * FLAP_OPEN * openDir
  })
  return (
    <group position={position} ref={ref}>
      <mesh position={[-chord / 2, 0, 0]}>
        <boxGeometry args={[chord, 0.028, width]} />
        <meshStandardMaterial color={color} />
      </mesh>
    </group>
  )
}

export interface UpgradeMarks {
  brakes?: boolean
  comms?: boolean
  fallback?: boolean
}

interface F1CarProps {
  livery?: Livery
  // light up fitted upgrades (garage view)
  marks?: UpgradeMarks
  // live values read every frame (refs so the car can animate at 60 fps
  // without re-rendering React at 60 fps)
  speed?: React.MutableRefObject<number>
  steering?: React.MutableRefObject<number>
  // active aero: true in X-mode (wings open)
  aeroOpen?: React.MutableRefObject<boolean>
  // cockpit camera sits where the helmet is; hide the helmet and the halo's
  // centre pillar (which would sit right across the driver's line of sight)
  hideDriver?: boolean
}

// A 2026-regulation F1 car from primitives: narrower two-flap front wing,
// exposed 18" wheels, slim undercut sidepods with wheel-wake boards, halo,
// airbox and fin, a partly flat floor with a small diffuser, and a
// three-element rear wing without a beam wing. Both wings' flaps open in X-mode.
// About 5.3 m long and 1.9 m wide. Local +x is forward.
export function F1Car({ livery = DEFAULT_LIVERY, speed, steering, aeroOpen, marks, hideDriver = false }: F1CarProps) {
  const spin = useRef(0)
  const steer = useRef(0)
  const open = useRef(0)
  const shape = useMemo(bodyShape, [])

  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1)
    spin.current += (speed?.current ?? 0) * d
    const target = steering?.current ?? 0
    steer.current += (target - steer.current) * Math.min(1, d * 10)
    const aero = aeroOpen?.current ? 1 : 0
    open.current += (aero - open.current) * Math.min(1, d * 8) // flaps actuate in ~0.3 s
  })

  const body = { color: livery.primary, metalness: 0.45, roughness: 0.22, envMapIntensity: 1.3 }

  return (
    <group>
      {/* floor: partly flat 2026 floor, plank, edge wings and a smaller diffuser */}
      <mesh position={[-0.1, 0.06, 0]} castShadow>
        <boxGeometry args={[3.7, 0.035, 1.45]} />
        <meshStandardMaterial color={CARBON} roughness={0.6} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={`fe${side}`} position={[-0.3, 0.08, side * 0.74]} rotation={[0, 0, 0.04]}>
          <boxGeometry args={[2.4, 0.02, 0.06]} />
          <meshStandardMaterial color={CARBON} />
        </mesh>
      ))}
      <mesh position={[-2.02, 0.16, 0]} rotation={[0, 0, -0.28]}>
        <boxGeometry args={[0.45, 0.025, 1.0]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>

      {/* chassis silhouette */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.1, 0]} castShadow>
        <extrudeGeometry args={[shape, { depth: 0.3, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }]} />
        <meshStandardMaterial {...body} />
      </mesh>

      {/* raised nose + survival cell */}
      <mesh position={[1.6, 0.36, 0]} rotation={[0, 0, -Math.PI / 2 - 0.06]} scale={[0.6, 1, 1.0]} castShadow>
        <cylinderGeometry args={[0.07, 0.24, 1.9, 20]} />
        <meshStandardMaterial {...body} />
      </mesh>
      <mesh position={[0.2, 0.52, 0]} castShadow>
        <boxGeometry args={[1.25, 0.34, 0.58]} />
        <meshStandardMaterial {...body} />
      </mesh>

      {/* sidepods (black flanks), inlets, and the in-wash wheel wake boards ahead of them */}
      {[1, -1].map((side) => (
        <group key={side}>
          <mesh position={[-0.35, 0.36, side * 0.55]} castShadow>
            <boxGeometry args={[1.3, 0.28, 0.18]} />
            <meshStandardMaterial color={livery.secondary} metalness={0.4} roughness={0.35} />
          </mesh>
          <mesh position={[0.28, 0.46, side * 0.5]}>
            <boxGeometry args={[0.06, 0.16, 0.2]} />
            <meshStandardMaterial color="#050505" />
          </mesh>
          <mesh position={[-0.35, 0.38, side * 0.645]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
            <planeGeometry args={[1.05, 0.24]} />
            <meshStandardMaterial map={wordmark('tangerine', '#ff8000')} transparent depthWrite={false} />
          </mesh>
          <mesh position={[0.72, 0.28, side * 0.64]} rotation={[0, side * 0.18, 0]}>
            <boxGeometry args={[0.34, 0.3, 0.02]} />
            <meshStandardMaterial color={CARBON} side={DoubleSide} />
          </mesh>
          {/* mirror on the halo-side pod */}
          <mesh position={[0.52, 0.8, side * 0.43]}>
            <boxGeometry args={[0.07, 0.07, 0.15]} />
            <meshStandardMaterial color={livery.secondary} />
          </mesh>
        </group>
      ))}

      {/* engine cover, stripe, airbox, fin */}
      <mesh position={[-0.9, 0.6, 0]} castShadow>
        <boxGeometry args={[1.45, 0.34, 0.48]} />
        <meshStandardMaterial color={livery.secondary} metalness={0.4} roughness={0.35} />
      </mesh>
      <mesh position={[-0.9, 0.775, 0]}>
        <boxGeometry args={[1.45, 0.01, 0.14]} />
        <meshStandardMaterial color={livery.accent} />
      </mesh>
      <mesh position={[-0.22, 0.88, 0]} castShadow>
        <boxGeometry args={[0.42, 0.34, 0.28]} />
        <meshStandardMaterial color={livery.secondary} />
      </mesh>
      <mesh position={[-0.2, 0.9, 0]}>
        <boxGeometry args={[0.02, 0.16, 0.2]} />
        <meshStandardMaterial color="#050505" />
      </mesh>
      <mesh position={[-1.2, 0.94, 0]} castShadow>
        <boxGeometry args={[1.15, 0.3, 0.022]} />
        <meshStandardMaterial {...body} side={DoubleSide} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={`fin${side}`} position={[-1.2, 0.94, side * 0.013]} rotation={[0, side > 0 ? 0 : Math.PI, 0]}>
          <planeGeometry args={[1.0, 0.22]} />
          <meshStandardMaterial map={wordmark('LIMITLAB', '#121214')} transparent depthWrite={false} />
        </mesh>
      ))}

      {/* steering wheel: turns with the input, on a raked column */}
      <SteeringWheel steer={steer} />

      {/* front suspension: upper and lower wishbones + push-rod on each side */}
      {[1, -1].map((side) => (
        <group key={`susp${side}`}>
          <Strut from={[1.55, 0.36, side * 0.2]} to={[FRONT_AXLE, 0.4, side * (FRONT_TRACK - 0.12)]} />
          <Strut from={[1.9, 0.34, side * 0.2]} to={[FRONT_AXLE, 0.4, side * (FRONT_TRACK - 0.12)]} />
          <Strut from={[1.55, 0.2, side * 0.25]} to={[FRONT_AXLE, 0.22, side * (FRONT_TRACK - 0.12)]} />
          <Strut from={[1.9, 0.2, side * 0.25]} to={[FRONT_AXLE, 0.22, side * (FRONT_TRACK - 0.12)]} />
          <Strut from={[1.72, 0.22, side * (FRONT_TRACK - 0.12)]} to={[1.25, 0.5, side * 0.12]} r={0.016} />
        </group>
      ))}

      {/* cockpit: helmet + halo */}
      {!hideDriver && (
        <>
          <mesh position={[0.24, 0.78, 0]}>
            <sphereGeometry args={[0.155, 20, 16]} />
            <meshStandardMaterial color="#f5d000" metalness={0.2} roughness={0.3} />
          </mesh>
          <mesh position={[0.28, 0.78, 0]}>
            <boxGeometry args={[0.05, 0.08, 0.32]} />
            <meshStandardMaterial color="#111" />
          </mesh>
        </>
      )}
      <mesh position={[0.26, 0.96, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]}>
        <torusGeometry args={[0.33, 0.028, 10, 32, Math.PI]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>
      {!hideDriver && (
        <mesh position={[0.62, 0.84, 0]} rotation={[0, 0, -0.6]}>
          <boxGeometry args={[0.04, 0.3, 0.05]} />
          <meshStandardMaterial color={CARBON} />
        </mesh>
      )}

      {/* front wing: 100 mm narrower for 2026, main plane + two active flaps, simple endplates */}
      <mesh position={[2.45, 0.1, 0]} castShadow>
        <boxGeometry args={[0.46, 0.03, 1.72]} />
        <meshStandardMaterial color={livery.secondary} />
      </mesh>
      <ActiveFlap position={[2.46, 0.16, 0]} width={1.6} chord={0.2} open={open} openDir={1} color={livery.primary} />
      <ActiveFlap position={[2.36, 0.22, 0]} width={1.5} chord={0.16} open={open} openDir={1} color={livery.primary} />
      {[1, -1].map((side) => (
        <mesh key={side} position={[2.42, 0.18, side * 0.86]}>
          <boxGeometry args={[0.55, 0.22, 0.025]} />
          <meshStandardMaterial color={livery.secondary} />
        </mesh>
      ))}

      {/* rear wing: main plane and two active flaps, no beam wing, endplates, pillar */}
      <mesh position={[-2.38, 0.9, 0]} castShadow>
        <boxGeometry args={[0.36, 0.045, 0.95]} />
        <meshStandardMaterial color={livery.secondary} />
      </mesh>
      <ActiveFlap position={[-2.22, 0.98, 0]} width={0.95} chord={0.2} open={open} openDir={1} color={livery.primary} />
      <ActiveFlap position={[-2.3, 1.06, 0]} width={0.95} chord={0.14} open={open} openDir={1} color={livery.secondary} />
      <mesh position={[-2.38, 0.925, 0]} rotation={[-Math.PI / 2, 0, -Math.PI / 2]}>
        <planeGeometry args={[0.9, 0.26]} />
        <meshStandardMaterial map={wordmark('tangerine', '#ffffff')} transparent depthWrite={false} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[-2.36, 0.78, side * 0.485]} castShadow>
          <boxGeometry args={[0.55, 0.56, 0.025]} />
          <meshStandardMaterial color={livery.primary} side={DoubleSide} />
        </mesh>
      ))}
      <mesh position={[-2.2, 0.58, 0]}>
        <boxGeometry args={[0.09, 0.5, 0.05]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>
      {/* rain light */}
      <mesh position={[-2.26, 0.3, 0]}>
        <boxGeometry args={[0.03, 0.08, 0.14]} />
        <meshStandardMaterial color="#ff2020" emissive="#ff1010" emissiveIntensity={0.8} />
      </mesh>

      {/* suspension: upper and lower wishbones to each wheel */}
      {[
        [FRONT_AXLE, FRONT_TRACK],
        [FRONT_AXLE, -FRONT_TRACK],
        [REAR_AXLE, REAR_TRACK],
        [REAR_AXLE, -REAR_TRACK],
      ].map(([x, z], i) =>
        [0.26, 0.44].map((y) => (
          <mesh key={`${i}-${y}`} position={[x, y, z / 2]}>
            <boxGeometry args={[0.05, 0.025, Math.abs(z) - 0.1]} />
            <meshStandardMaterial color={CARBON} />
          </mesh>
        )),
      )}

      {marks?.brakes &&
        [
          [FRONT_AXLE, FRONT_TRACK - 0.2],
          [FRONT_AXLE, -FRONT_TRACK + 0.2],
          [REAR_AXLE, REAR_TRACK - 0.24],
          [REAR_AXLE, -REAR_TRACK + 0.24],
        ].map(([x, z], i) => (
          <mesh key={`disc${i}`} position={[x, WHEEL_R, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.18, 0.18, 0.05, 20]} />
            <meshStandardMaterial color="#ff7a00" emissive="#ff5a00" emissiveIntensity={1.4} />
          </mesh>
        ))}
      {marks?.comms && (
        <mesh position={[-0.22, 1.32, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.6, 8]} />
          <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={1.5} />
        </mesh>
      )}
      {marks?.fallback && (
        <mesh position={[-0.2, 0.58, 0.64]}>
          <boxGeometry args={[0.5, 0.16, 0.08]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={1.4} />
        </mesh>
      )}

      <Wheel x={FRONT_AXLE} z={FRONT_TRACK} width={FRONT_TYRE_W} front spin={spin} steer={steer} />
      <Wheel x={FRONT_AXLE} z={-FRONT_TRACK} width={FRONT_TYRE_W} front spin={spin} steer={steer} />
      <Wheel x={REAR_AXLE} z={REAR_TRACK} width={REAR_TYRE_W} front={false} spin={spin} steer={steer} />
      <Wheel x={REAR_AXLE} z={-REAR_TRACK} width={REAR_TYRE_W} front={false} spin={spin} steer={steer} />
    </group>
  )
}
