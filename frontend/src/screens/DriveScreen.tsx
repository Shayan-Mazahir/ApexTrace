import { Canvas } from '@react-three/fiber'
import { Scene } from '../scene/Scene'

export function DriveScreen() {
  return (
    <Canvas shadows camera={{ position: [6, 6, 6], fov: 50 }}>
      <Scene />
    </Canvas>
  )
}
