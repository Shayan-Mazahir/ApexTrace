import { Canvas, useFrame } from '@react-three/fiber'
import { useRef } from 'react'
import type { Group } from 'three'
import { F1Car } from '../scene/F1Car'
import type { UpgradeConfig } from '../types/schemas'

function Turntable({ selection }: { selection: UpgradeConfig }) {
  const group = useRef<Group>(null)
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.35
  })
  return (
    <group ref={group}>
      <F1Car
        marks={{
          brakes: selection.brake_servicing,
          comms: selection.comms_improvement,
          fallback: selection.local_fallback,
        }}
      />
    </group>
  )
}

// The same car model the driver races, on a turntable. Fitted upgrades glow:
// brake discs (brake servicing), antenna (comms), sidepod module (fallback).
export function GarageCar({ selection }: { selection: UpgradeConfig }) {
  return (
    <Canvas camera={{ position: [5.2, 2.6, 5.2], fov: 38 }} dpr={[1, 2]}>
      <color attach="background" args={['#1b1c20']} />
      <hemisphereLight args={['#e8eef5', '#2a2a2e', 1.0]} />
      <directionalLight position={[4, 6, 3]} intensity={1.8} />
      <directionalLight position={[-5, 3, -4]} intensity={0.6} color="#9ec5ff" />
      <mesh rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[4.2, 64]} />
        <meshStandardMaterial color="#26272c" metalness={0.2} roughness={0.6} />
      </mesh>
      <group position={[0, 0, 0]} scale={0.9}>
        <Turntable selection={selection} />
      </group>
    </Canvas>
  )
}
