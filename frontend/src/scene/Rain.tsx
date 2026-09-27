import { useFrame } from '@react-three/fiber'
import { useMemo, useRef, type MutableRefObject } from 'react'
import * as THREE from 'three'

const COUNT = 5000
const BOX = 90 // metres around the camera
const HEIGHT = 50
const STREAK = 0.9 // metres per drop
const FALL = 28 // m/s

// Falling rain: short streaks in a box that follows the camera, so it always
// surrounds the viewer without filling the whole track with particles.
export function Rain({ intensity }: { intensity: number }) {
  const group = useRef<THREE.Group>(null)
  const { geometry, drops } = useMemo(() => {
    const drops = new Float32Array(COUNT * 3)
    for (let i = 0; i < COUNT; i++) {
      drops[i * 3] = (Math.random() - 0.5) * BOX
      drops[i * 3 + 1] = Math.random() * HEIGHT - 10
      drops[i * 3 + 2] = (Math.random() - 0.5) * BOX
    }
    const g = new THREE.BufferGeometry()
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(COUNT * 6), 3))
    return { geometry: g, drops }
  }, [])

  useFrame(({ camera }, dt) => {
    if (!group.current) return
    group.current.position.copy(camera.position)
    const pos = geometry.attributes.position.array as Float32Array
    const step = FALL * Math.min(dt, 0.05)
    const shown = Math.floor(COUNT * intensity)
    for (let i = 0; i < COUNT; i++) {
      let y = drops[i * 3 + 1] - step
      if (y < -12) y += HEIGHT
      drops[i * 3 + 1] = y
      const x = drops[i * 3]
      const z = drops[i * 3 + 2]
      const o = i * 6
      // hidden drops collapse to a point (zero length) instead of re-allocating
      const len = i < shown ? STREAK : 0
      pos[o] = x
      pos[o + 1] = y
      pos[o + 2] = z
      pos[o + 3] = x + 0.08
      pos[o + 4] = y + len
      pos[o + 5] = z
    }
    geometry.attributes.position.needsUpdate = true
  })

  return (
    <group ref={group}>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial color="#d6dee8" transparent opacity={0.6} depthWrite={false} fog={false} />
      </lineSegments>
    </group>
  )
}

// soft round puff instead of a hard square point
let puff: THREE.Texture | null = null
function puffTexture(): THREE.Texture {
  if (puff) return puff
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.4, 'rgba(255,255,255,0.45)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  puff = new THREE.CanvasTexture(c)
  return puff
}

const SPRAY = 900
const LIFE = 0.9 // s

// Spray kicked up by the tyres: particles emitted behind the rear wheels in
// proportion to speed, thrown back and up, then fading out.
export function Spray({ pose }: { pose: MutableRefObject<{ x: number; y: number; heading: number; speed: number }> }) {
  const { geometry, vel, age } = useMemo(() => {
    const g = new THREE.BufferGeometry()
    const pos = new Float32Array(SPRAY * 3).fill(-1000)
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    return { geometry: g, vel: new Float32Array(SPRAY * 3), age: new Float32Array(SPRAY).fill(LIFE) }
  }, [])
  const next = useRef(0)
  const debt = useRef(0)

  useFrame((_, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const pos = geometry.attributes.position.array as Float32Array
    const p = pose.current
    const speed = Math.abs(p.speed)
    const c = Math.cos(p.heading)
    const s = Math.sin(p.heading)
    debt.current += speed > 8 ? speed * 9 * dt : 0
    while (debt.current >= 1) {
      debt.current -= 1
      const i = next.current
      next.current = (i + 1) % SPRAY
      const side = Math.random() < 0.5 ? -0.8 : 0.8
      const back = 2.2 + Math.random() * 0.4
      pos[i * 3] = p.x - c * back - s * side
      pos[i * 3 + 1] = 0.25
      pos[i * 3 + 2] = p.y - s * back + c * side
      const carry = speed * (0.55 + Math.random() * 0.25) // trails the car: slower than it
      vel[i * 3] = c * carry + (Math.random() - 0.5) * 3
      vel[i * 3 + 1] = 1.5 + Math.random() * 2.5
      vel[i * 3 + 2] = s * carry + (Math.random() - 0.5) * 3
      age[i] = 0
    }
    for (let i = 0; i < SPRAY; i++) {
      if (age[i] >= LIFE) continue
      age[i] += dt
      if (age[i] >= LIFE) {
        pos[i * 3 + 1] = -1000
        continue
      }
      vel[i * 3 + 1] -= 6 * dt
      pos[i * 3] += vel[i * 3] * dt
      pos[i * 3 + 1] = Math.max(0.05, pos[i * 3 + 1] + vel[i * 3 + 1] * dt)
      pos[i * 3 + 2] += vel[i * 3 + 2] * dt
    }
    geometry.attributes.position.needsUpdate = true
  })

  return (
    <points geometry={geometry} frustumCulled={false}>
      <pointsMaterial map={puffTexture()} color="#e3e8ee" size={0.5} sizeAttenuation transparent opacity={0.28} depthWrite={false} />
    </points>
  )
}
