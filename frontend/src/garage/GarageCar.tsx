import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { COLORS } from '../styles/tokens'
import type { UpgradeConfig } from '../types/schemas'

function Car({ selection }: { selection: UpgradeConfig }) {
  const group = useRef<Group>(null)
  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.4
  })
  const wheel = selection.brake_servicing ? COLORS.orange : '#555555'
  return (
    <group ref={group}>
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[4, 0.6, 1.4]} />
        <meshStandardMaterial color="#888888" />
      </mesh>
      <mesh position={[-0.6, 0.95, 0]}>
        <boxGeometry args={[1.4, 0.4, 0.8]} />
        <meshStandardMaterial color="#aaaaaa" />
      </mesh>
      {[
        [1.3, 0.35, 0.85],
        [1.3, 0.35, -0.85],
        [-1.3, 0.35, 0.85],
        [-1.3, 0.35, -0.85],
      ].map((p, i) => (
        <mesh key={i} position={p as [number, number, number]} rotation={[Math.PI / 2, 0, 0]}>
          <cylinderGeometry args={[0.4, 0.4, 0.35, 16]} />
          <meshStandardMaterial color={wheel} emissive={selection.brake_servicing ? COLORS.orange : '#000000'} emissiveIntensity={0.3} />
        </mesh>
      ))}
      <mesh position={[-1.4, 1.4, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.9, 8]} />
        <meshStandardMaterial color={selection.comms_improvement ? COLORS.teal : '#555555'} emissive={selection.comms_improvement ? COLORS.teal : '#000000'} emissiveIntensity={0.4} />
      </mesh>
      <mesh position={[0.4, 0.95, 0]}>
        <boxGeometry args={[0.5, 0.25, 0.5]} />
        <meshStandardMaterial color={selection.local_fallback ? COLORS.amber : '#555555'} emissive={selection.local_fallback ? COLORS.amber : '#000000'} emissiveIntensity={0.4} />
      </mesh>
    </group>
  )
}

// Selected upgrades light up on the car: wheels (brakes), antenna (comms),
// roof module (local fallback). Purely illustrative — no physics here.
export function GarageCar({ selection }: { selection: UpgradeConfig }) {
  return (
    <Canvas camera={{ position: [5, 3, 5], fov: 40 }}>
      <ambientLight intensity={0.7} />
      <directionalLight position={[5, 8, 5]} intensity={1.1} />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[4, 48]} />
        <meshStandardMaterial color="#2a2a2a" />
      </mesh>
      <Car selection={selection} />
    </Canvas>
  )
}
