import { OrbitControls } from '@react-three/drei'

function Floor() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
      <planeGeometry args={[40, 40]} />
      <meshStandardMaterial color="#2a2a2a" />
    </mesh>
  )
}

function PlaceholderCar() {
  return (
    <mesh position={[0, 0.4, 0]} castShadow>
      <boxGeometry args={[1, 0.8, 2]} />
      <meshStandardMaterial color="#ff8c00" />
    </mesh>
  )
}

export function Scene() {
  return (
    <>
      <ambientLight intensity={0.5} />
      <directionalLight position={[5, 10, 5]} intensity={1} castShadow />
      <Floor />
      <PlaceholderCar />
      <OrbitControls />
    </>
  )
}
