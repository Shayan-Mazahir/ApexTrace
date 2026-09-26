import { Canvas } from '@react-three/fiber'
import { useEffect, useState } from 'react'
import './App.css'
import { fetchHealth } from './api/health'
import { Scene } from './scene/Scene'

function App() {
  const [backendStatus, setBackendStatus] = useState<'checking' | 'connected' | 'unreachable'>(
    'checking',
  )

  useEffect(() => {
    fetchHealth()
      .then(() => setBackendStatus('connected'))
      .catch(() => setBackendStatus('unreachable'))
  }, [])

  return (
    <div id="app-root">
      <div id="status-bar">
        LimitLab scaffold — backend: <strong>{backendStatus}</strong>
      </div>
      <Canvas shadows camera={{ position: [6, 6, 6], fov: 50 }}>
        <Scene />
      </Canvas>
    </div>
  )
}

export default App
