import { useFrame } from '@react-three/fiber'
import { useMemo, useRef } from 'react'
import { DoubleSide, Shape, type Group } from 'three'

export interface Livery {
  primary: string
  secondary: string
  accent: string
}

export const DEFAULT_LIVERY: Livery = { primary: '#ff7a00', secondary: '#161616', accent: '#2dd4bf' }

const CARBON = '#1b1b1d'
const TYRE = '#141414'
const RIM = '#8a8f96'

// Top-view outline of the chassis (x forward, y = half-width in metres),
// extruded into the tub + sidepods + engine cover silhouette.
function bodyShape(): Shape {
  const s = new Shape()
  const pts: [number, number][] = [
    [2.45, 0.09],
    [1.6, 0.15],
    [1.0, 0.3],
    [0.5, 0.42],
    [-0.1, 0.72],
    [-0.9, 0.7],
    [-1.5, 0.42],
    [-2.05, 0.25],
    [-2.25, 0.2],
  ]
  s.moveTo(pts[0][0], -pts[0][1])
  for (const [x, y] of pts) s.lineTo(x, y)
  for (const [x, y] of [...pts].reverse()) s.lineTo(x, -y)
  s.closePath()
  return s
}

function Wheel({ x, z, radius, width, front, spin, steer }: {
  x: number
  z: number
  radius: number
  width: number
  front: boolean
  spin: React.MutableRefObject<number>
  steer: React.MutableRefObject<number>
}) {
  const steerGroup = useRef<Group>(null)
  const spinGroup = useRef<Group>(null)
  useFrame(() => {
    if (spinGroup.current) spinGroup.current.rotation.z = -spin.current / radius
    if (steerGroup.current && front) steerGroup.current.rotation.y = -steer.current * 0.35
  })
  const outer = Math.sign(z)
  return (
    <group position={[x, radius, z]} ref={steerGroup}>
      <group ref={spinGroup}>
        <mesh rotation={[Math.PI / 2, 0, 0]} castShadow>
          <cylinderGeometry args={[radius, radius, width, 28]} />
          <meshStandardMaterial color={TYRE} roughness={0.9} />
        </mesh>
        <mesh rotation={[Math.PI / 2, 0, 0]} position={[0, 0, outer * (width / 2 + 0.002)]}>
          <cylinderGeometry args={[radius * 0.62, radius * 0.62, 0.01, 24]} />
          <meshStandardMaterial color={RIM} metalness={0.8} roughness={0.35} />
        </mesh>
        <mesh position={[0, 0, outer * (width / 2 + 0.004)]}>
          <torusGeometry args={[radius * 0.8, 0.018, 8, 32]} />
          <meshStandardMaterial color="#ffd400" />
        </mesh>
        {/* a spoke so the rotation is visible */}
        <mesh position={[0, 0, outer * (width / 2 + 0.008)]}>
          <boxGeometry args={[radius * 1.1, 0.05, 0.01]} />
          <meshStandardMaterial color="#444" />
        </mesh>
      </group>
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
}

// A recognisably F1-shaped car from primitives: long nose, front and rear
// wings, sidepods, halo, driver's helmet, airbox, shark fin, exposed wheels.
// About 5.6 m long, 2 m wide. Local +x is forward.
export function F1Car({ livery = DEFAULT_LIVERY, speed, steering, marks }: F1CarProps) {
  const spin = useRef(0)
  const steer = useRef(0)
  const shape = useMemo(bodyShape, [])

  useFrame((_, dt) => {
    spin.current += (speed?.current ?? 0) * Math.min(dt, 0.1)
    const target = steering?.current ?? 0
    steer.current += (target - steer.current) * Math.min(1, dt * 10)
  })

  return (
    <group>
      {/* floor / plank */}
      <mesh position={[-0.1, 0.07, 0]} castShadow>
        <boxGeometry args={[4.0, 0.04, 1.7]} />
        <meshStandardMaterial color={CARBON} roughness={0.6} />
      </mesh>

      {/* chassis silhouette */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.12, 0]} castShadow>
        <extrudeGeometry args={[shape, { depth: 0.32, bevelEnabled: true, bevelSize: 0.05, bevelThickness: 0.05, bevelSegments: 2 }]} />
        <meshStandardMaterial color={livery.primary} metalness={0.3} roughness={0.35} />
      </mesh>

      {/* raised nose + tub */}
      <mesh position={[1.5, 0.42, 0]} rotation={[0, 0, -Math.PI / 2]} castShadow>
        <cylinderGeometry args={[0.1, 0.24, 1.9, 16]} />
        <meshStandardMaterial color={livery.primary} metalness={0.3} roughness={0.35} />
      </mesh>
      <mesh position={[0.15, 0.55, 0]} castShadow>
        <boxGeometry args={[1.3, 0.34, 0.62]} />
        <meshStandardMaterial color={livery.primary} metalness={0.3} roughness={0.35} />
      </mesh>

      {/* engine cover, stripe, airbox, shark fin */}
      <mesh position={[-0.95, 0.62, 0]} castShadow>
        <boxGeometry args={[1.5, 0.36, 0.52]} />
        <meshStandardMaterial color={livery.primary} metalness={0.3} roughness={0.35} />
      </mesh>
      <mesh position={[-0.95, 0.805, 0]}>
        <boxGeometry args={[1.5, 0.01, 0.16]} />
        <meshStandardMaterial color={livery.accent} />
      </mesh>
      <mesh position={[-0.25, 0.9, 0]} castShadow>
        <boxGeometry args={[0.45, 0.36, 0.3]} />
        <meshStandardMaterial color={livery.secondary} />
      </mesh>
      <mesh position={[-1.25, 0.98, 0]} castShadow>
        <boxGeometry args={[1.3, 0.34, 0.025]} />
        <meshStandardMaterial color={livery.primary} side={DoubleSide} />
      </mesh>

      {/* cockpit: helmet + halo */}
      <mesh position={[0.28, 0.8, 0]}>
        <sphereGeometry args={[0.16, 20, 16]} />
        <meshStandardMaterial color="#f5d000" metalness={0.2} roughness={0.3} />
      </mesh>
      <mesh position={[0.32, 0.8, 0]}>
        <boxGeometry args={[0.05, 0.08, 0.34]} />
        <meshStandardMaterial color="#111" />
      </mesh>
      <mesh position={[0.3, 0.98, 0]} rotation={[Math.PI / 2, 0, Math.PI / 2]}>
        <torusGeometry args={[0.34, 0.03, 10, 32, Math.PI]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>
      <mesh position={[0.66, 0.86, 0]} rotation={[0, 0, -0.6]}>
        <boxGeometry args={[0.04, 0.3, 0.05]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>

      {/* front wing: two elements + endplates */}
      <mesh position={[2.55, 0.12, 0]} castShadow>
        <boxGeometry args={[0.5, 0.035, 1.95]} />
        <meshStandardMaterial color={livery.secondary} />
      </mesh>
      <mesh position={[2.45, 0.2, 0]} rotation={[0, 0, 0.35]}>
        <boxGeometry args={[0.3, 0.03, 1.85]} />
        <meshStandardMaterial color={livery.primary} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[2.5, 0.2, side * 0.975]}>
          <boxGeometry args={[0.6, 0.24, 0.03]} />
          <meshStandardMaterial color={livery.secondary} />
        </mesh>
      ))}

      {/* rear wing: main plane, flap, endplates, pillar */}
      <mesh position={[-2.45, 0.95, 0]} castShadow>
        <boxGeometry args={[0.42, 0.05, 1.0]} />
        <meshStandardMaterial color={livery.secondary} />
      </mesh>
      <mesh position={[-2.38, 1.07, 0]} rotation={[0, 0, 0.3]}>
        <boxGeometry args={[0.26, 0.04, 1.0]} />
        <meshStandardMaterial color={livery.primary} />
      </mesh>
      {[1, -1].map((side) => (
        <mesh key={side} position={[-2.42, 0.8, side * 0.51]} castShadow>
          <boxGeometry args={[0.62, 0.62, 0.03]} />
          <meshStandardMaterial color={livery.primary} side={DoubleSide} />
        </mesh>
      ))}
      <mesh position={[-2.3, 0.62, 0]}>
        <boxGeometry args={[0.1, 0.5, 0.06]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>
      <mesh position={[-2.25, 0.2, 0]}>
        <boxGeometry args={[0.45, 0.22, 1.1]} />
        <meshStandardMaterial color={CARBON} />
      </mesh>

      {/* suspension arms */}
      {[
        [1.55, 0.8],
        [1.55, -0.8],
        [-1.55, 0.78],
        [-1.55, -0.78],
      ].map(([x, z], i) => (
        <mesh key={i} position={[x, 0.4, z / 2]} rotation={[0, 0, 0]}>
          <boxGeometry args={[0.05, 0.03, Math.abs(z)]} />
          <meshStandardMaterial color={CARBON} />
        </mesh>
      ))}

      {marks?.brakes &&
        [
          [1.6, 0.6],
          [1.6, -0.6],
          [-1.55, 0.56],
          [-1.55, -0.56],
        ].map(([x, z], i) => (
          <mesh key={`disc${i}`} position={[x, 0.36, z]} rotation={[Math.PI / 2, 0, 0]}>
            <cylinderGeometry args={[0.2, 0.2, 0.06, 20]} />
            <meshStandardMaterial color="#ff7a00" emissive="#ff5a00" emissiveIntensity={1.4} />
          </mesh>
        ))}
      {marks?.comms && (
        <mesh position={[-0.25, 1.35, 0]}>
          <cylinderGeometry args={[0.02, 0.02, 0.6, 8]} />
          <meshStandardMaterial color="#2dd4bf" emissive="#2dd4bf" emissiveIntensity={1.5} />
        </mesh>
      )}
      {marks?.fallback && (
        <mesh position={[-0.2, 0.6, 0.72]}>
          <boxGeometry args={[0.5, 0.18, 0.08]} />
          <meshStandardMaterial color="#f59e0b" emissive="#f59e0b" emissiveIntensity={1.4} />
        </mesh>
      )}

      <Wheel x={1.6} z={0.82} radius={0.36} width={0.3} front spin={spin} steer={steer} />
      <Wheel x={1.6} z={-0.82} radius={0.36} width={0.3} front spin={spin} steer={steer} />
      <Wheel x={-1.55} z={0.78} radius={0.36} width={0.38} front={false} spin={spin} steer={steer} />
      <Wheel x={-1.55} z={-0.78} radius={0.36} width={0.38} front={false} spin={spin} steer={steer} />
    </group>
  )
}
