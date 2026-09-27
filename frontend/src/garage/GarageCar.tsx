import { Environment, Lightformer } from '@react-three/drei'
import { Canvas, useFrame } from '@react-three/fiber'
import { Suspense, useRef } from 'react'
import type { Group } from 'three'
import { CarModel, useCarModelAvailable } from '../scene/CarModel'
import { F1Car } from '../scene/F1Car'
import { ModelBoundary } from '../scene/ModelBoundary'
import type { UpgradeConfig } from '../types/schemas'
import './GarageCar.css'
import { useGraphicsMode } from '../app/graphics'

function Turntable({ selection, detailed }: { selection: UpgradeConfig; detailed: boolean }) {
  const group = useRef<Group>(null)
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.35
  })
  const builtIn = (
    <F1Car marks={{ brakes: selection.brake_servicing, comms: selection.comms_improvement, fallback: selection.local_fallback }} />
  )
  return (
    <group ref={group}>
      {detailed ? (
        <ModelBoundary fallback={builtIn}>
          <Suspense fallback={builtIn}>
            <CarModel />
          </Suspense>
        </ModelBoundary>
      ) : (
        builtIn
      )}
    </group>
  )
}

const FITTED: { id: keyof UpgradeConfig; label: string }[] = [
  { id: 'brake_servicing', label: 'Serviced brakes' },
  { id: 'comms_improvement', label: 'Improved comms' },
  { id: 'local_fallback', label: 'Local warning fallback' },
]

// The same car the driver races (the detailed model when present), on a
// turntable, with the fitted upgrades listed underneath.
export function GarageCar({ selection }: { selection: UpgradeConfig }) {
  const lowGraphics = useGraphicsMode() === 'performance'
  const detailed = useCarModelAvailable()
  const fitted = FITTED.filter((f) => selection[f.id])
  return (
    <div className="garage-car">
      <Canvas camera={{ position: [5.2, 2.4, 5.2], fov: 36 }} dpr={lowGraphics ? 1 : [1, 1.5]}>
        <color attach="background" args={['#15171c']} />
        <hemisphereLight args={['#e8eef5', '#2a2a2e', 0.7]} />
        <directionalLight position={[4, 6, 3]} intensity={1.6} />
        <directionalLight position={[-5, 3, -4]} intensity={0.6} color="#9ec5ff" />
        <Environment resolution={128} frames={1}>
          <Lightformer form="rect" intensity={1.2} color="#e8f1ff" position={[0, 6, 0]} rotation-x={Math.PI / 2} scale={[12, 12, 1]} />
          <Lightformer form="rect" intensity={1.6} color="#ffb066" position={[6, 2, 4]} scale={[6, 2, 1]} />
          <Lightformer form="rect" intensity={0.8} color="#7dd3fc" position={[-6, 2, -3]} scale={[6, 2, 1]} />
        </Environment>
        <mesh rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[4.2, 64]} />
          <meshStandardMaterial color="#23252b" metalness={0.3} roughness={0.5} />
        </mesh>
        <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0.005, 0]}>
          <ringGeometry args={[4.05, 4.2, 64]} />
          <meshBasicMaterial color="#ff8a1a" />
        </mesh>
        <group scale={0.9}>
          <Turntable selection={selection} detailed={detailed} />
        </group>
      </Canvas>
      <div className="garage-car__fitted">
        {fitted.length ? fitted.map((f) => <span key={f.id}>✓ {f.label}</span>) : <span className="is-none">No upgrades fitted</span>}
      </div>
    </div>
  )
}
