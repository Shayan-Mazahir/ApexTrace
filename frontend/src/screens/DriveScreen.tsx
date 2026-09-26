import { Canvas } from '@react-three/fiber'
import { CalibrationPanel } from '../components/CalibrationPanel'
import { Scene } from '../scene/Scene'

export function DriveScreen() {
  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <Canvas shadows camera={{ position: [6, 6, 6], fov: 50 }}>
        <Scene />
      </Canvas>
      <CalibrationPanel />
    </div>
  )
}
