import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, type MutableRefObject } from 'react'
import {
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  DoubleSide,
  BackSide,
  Object3D,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type DirectionalLight,
  type Texture,
} from 'three'
import type { TrackProfile } from '../types/schemas'
import { computeRacingLine } from './racingLine'
import { bounds, rng, type Pt } from './trackGeometry'

// Light, sky and the finishing touches on the track surface. Everything here
// is either drawn once (canvas textures, static geometry) or a single shadow
// map that only covers the few metres around the car, so it stays cheap on
// an integrated GPU.

// Afternoon sun: high enough for short, crisp shadows; off to one side, so the
// car and barriers get a lit face and a shaded one instead of flat light.
export const SUN_DIRECTION = new Vector3(0.55, 0.62, -0.56).normalize()
export const SUN_COLOUR = '#ffe7c4'
export const SKY_HORIZON = '#c8dcee' // also the fog colour, so distant scenery melts into the haze
const SKY_ZENITH = '#2f6fc4'
const SKY_MID = '#7fb0e2'

// ---------------------------------------------------------------- sky

const skyVertex = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize((modelMatrix * vec4(position, 1.0)).xyz - cameraPosition);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position.z = gl_Position.w; // always at the far plane
  }
`
const skyFragment = /* glsl */ `
  uniform vec3 uZenith;
  uniform vec3 uMid;
  uniform vec3 uHorizon;
  uniform vec3 uSunDir;
  uniform vec3 uSunColour;
  varying vec3 vDir;
  void main() {
    vec3 dir = normalize(vDir);
    float h = dir.y;
    vec3 col = mix(uHorizon, uMid, smoothstep(0.0, 0.18, h));
    col = mix(col, uZenith, smoothstep(0.12, 0.75, h));
    col = mix(col, uHorizon, smoothstep(0.0, -0.08, h)); // below the horizon: haze
    float d = max(dot(dir, uSunDir), 0.0);
    col += uSunColour * (pow(d, 1400.0) * 8.0 + pow(d, 60.0) * 0.35 + pow(d, 6.0) * 0.12);
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`

// A gradient sky dome that follows the camera: deep blue overhead, pale haze
// at the horizon (matching the fog), and a sun disc with a warm glow. Unlike a
// physical scattering sky it can't blow out to white under tone mapping.
export function SkyDome() {
  const material = useMemo(
    () =>
      new ShaderMaterial({
        uniforms: {
          uZenith: { value: new Color(SKY_ZENITH) },
          uMid: { value: new Color(SKY_MID) },
          uHorizon: { value: new Color(SKY_HORIZON) },
          uSunDir: { value: SUN_DIRECTION },
          uSunColour: { value: new Color(SUN_COLOUR) },
        },
        vertexShader: skyVertex,
        fragmentShader: skyFragment,
        side: BackSide,
        depthWrite: false,
        fog: false,
      }),
    [],
  )
  useEffect(() => () => material.dispose(), [material])
  const dome = useRef<Object3D>(null)
  useFrame(({ camera }) => dome.current?.position.copy(camera.position))
  return (
    <mesh ref={dome} material={material} renderOrder={-1} frustumCulled={false}>
      <sphereGeometry args={[3000, 32, 16]} />
    </mesh>
  )
}

// ---------------------------------------------------------------- sun + shadow

const SHADOW_SPAN_M = 14 // half-size of the shadow camera around the car

// The sun, with a shadow map that follows the car: a small frustum means a
// sharp shadow from a 1024 map instead of a blurry one stretched over the
// whole circuit.
export function Sun({ follow, shadows }: { follow: MutableRefObject<{ x: number; y: number }>; shadows: boolean }) {
  const light = useRef<DirectionalLight>(null)
  const target = useMemo(() => new Object3D(), [])
  useEffect(() => {
    const l = light.current
    if (!l) return
    l.target = target
    const cam = l.shadow.camera
    cam.left = cam.bottom = -SHADOW_SPAN_M
    cam.right = cam.top = SHADOW_SPAN_M
    cam.near = 1
    cam.far = 160
    cam.updateProjectionMatrix()
    l.shadow.mapSize.set(1024, 1024)
    l.shadow.bias = -0.0004
    l.shadow.normalBias = 0.03
  }, [target])
  useFrame(() => {
    const l = light.current
    if (!l) return
    const { x, y } = follow.current
    target.position.set(x, 0, y)
    target.updateMatrixWorld()
    l.position.set(x + SUN_DIRECTION.x * 80, SUN_DIRECTION.y * 80, y + SUN_DIRECTION.z * 80)
  })
  return (
    <>
      <primitive object={target} />
      <directionalLight ref={light} intensity={2.1} color={SUN_COLOUR} castShadow={shadows} />
    </>
  )
}

// ---------------------------------------------------------------- contact shadow

let contactTexture: Texture | null = null
// A soft dark ellipse: the ambient-occlusion "footprint" under the car that
// grounds it even where the sun's shadow doesn't reach (and in Performance
// mode, which has no shadow map).
export function contactShadow(): Texture {
  if (contactTexture) return contactTexture
  const c = document.createElement('canvas')
  c.width = 256
  c.height = 128
  const g = c.getContext('2d')!
  g.translate(128, 64)
  g.scale(1, 0.5)
  const grad = g.createRadialGradient(0, 0, 10, 0, 0, 124)
  grad.addColorStop(0, 'rgba(0,0,0,0.62)')
  grad.addColorStop(0.55, 'rgba(0,0,0,0.38)')
  grad.addColorStop(1, 'rgba(0,0,0,0)')
  g.fillStyle = grad
  g.fillRect(-128, -128, 256, 256)
  contactTexture = new CanvasTexture(c)
  return contactTexture
}

// ---------------------------------------------------------------- clouds

let cloudTexture: Texture | null = null
function cloud(): Texture {
  if (cloudTexture) return cloudTexture
  const c = document.createElement('canvas')
  c.width = 512
  c.height = 256
  const g = c.getContext('2d')!
  const random = rng(21)
  // a cumulus: many soft white puffs, flatter and greyer along the base
  for (let i = 0; i < 46; i++) {
    const x = 90 + random() * 332
    const y = 150 - Math.sin(((x - 90) / 332) * Math.PI) * (40 + random() * 60) + random() * 30
    const r = 30 + random() * 46
    const puff = g.createRadialGradient(x, y, 0, x, y, r)
    const shade = y > 150 ? 228 : 255
    puff.addColorStop(0, `rgba(${shade},${shade},${shade + 2},0.5)`)
    puff.addColorStop(1, `rgba(${shade},${shade},${shade + 2},0)`)
    g.fillStyle = puff
    g.fillRect(x - r, y - r, r * 2, r * 2)
  }
  cloudTexture = new CanvasTexture(c)
  cloudTexture.colorSpace = SRGBColorSpace
  return cloudTexture
}

// A ring of billboard cumulus far outside the circuit, well above the hills:
// the sky stops being an empty gradient for the cost of ~20 sprites.
export function Clouds({ profile }: { profile: TrackProfile }) {
  const items = useMemo(() => {
    const b = bounds(profile.centerline as Pt[])
    const reach = Math.max(b.maxX - b.minX, b.maxZ - b.minZ) / 2
    const random = rng(profile.id === 'baku' ? 5 : 3)
    return Array.from({ length: 22 }, (_, i) => {
      const a = (i / 22) * Math.PI * 2 + random() * 0.25
      const r = reach + 1400 + random() * 1600
      const w = 500 + random() * 700
      return { x: b.cx + Math.cos(a) * r, z: b.cz + Math.sin(a) * r, y: 380 + random() * 420, w, h: w * (0.42 + random() * 0.15), o: 0.75 + random() * 0.25 }
    })
  }, [profile])
  const map = cloud()
  return (
    <group>
      {items.map((c, i) => (
        <sprite key={i} position={[c.x, c.y, c.z]} scale={[c.w, c.h, 1]}>
          <spriteMaterial map={map} transparent opacity={c.o} depthWrite={false} fog={false} />
        </sprite>
      ))}
    </group>
  )
}

// ---------------------------------------------------------------- soft strips on the road

// A ribbon along `points`, `width` wide, fully opaque in the middle and fading
// to nothing at both edges (three vertices across, RGBA vertex colours), so a
// painted line reads like paint or rubber rather than a strip of plastic.
function softStrip(points: Pt[], width: number, y: number, colourAt: (i: number) => [number, number, number, number]): BufferGeometry {
  const positions: number[] = []
  const colours: number[] = []
  const indices: number[] = []
  const half = width / 2
  for (let i = 0; i < points.length; i++) {
    const [x, z] = points[i]
    const [ax, az] = points[Math.max(0, i - 1)]
    const [bx, bz] = points[Math.min(points.length - 1, i + 1)]
    const len = Math.hypot(bx - ax, bz - az) || 1
    const nx = -(bz - az) / len
    const nz = (bx - ax) / len
    const [r, g, b, a] = colourAt(i)
    positions.push(x + nx * half, y, z + nz * half, x, y, z, x - nx * half, y, z - nz * half)
    colours.push(r, g, b, 0, r, g, b, a, r, g, b, 0)
    if (i > 0) {
      const p = (i - 1) * 3
      const q = i * 3
      indices.push(p, q, p + 1, q, q + 1, p + 1, p + 1, q + 1, p + 2, q + 1, q + 2, p + 2)
    }
  }
  const geometry = new BufferGeometry()
  geometry.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  geometry.setAttribute('color', new BufferAttribute(new Float32Array(colours), 4))
  geometry.setIndex(indices)
  return geometry
}

const linear = (hex: string) => new Color(hex).toArray() as [number, number, number]
const THROTTLE = linear('#34e07a')
const BRAKE = linear('#ff3326')
const RACING_LINE_Y = 0.035 // above the asphalt (0.02), below the white edge lines (0.045)
const RUBBER_Y = 0.026

// Painted guide line: green where the car model can accelerate, red where it
// has to brake for the next corner (see racingLine.ts). Translucent with soft
// edges, so it guides without covering the road.
export function RacingLine({ profile }: { profile: TrackProfile }) {
  const geometry = useMemo(() => {
    const { points, phase } = computeRacingLine(profile)
    return softStrip(points as Pt[], 0.9, RACING_LINE_Y, (i) => (phase[i] === 'brake' ? [...BRAKE, 0.8] : [...THROTTLE, 0.62]))
  }, [profile])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry}>
      <meshBasicMaterial vertexColors transparent depthWrite={false} side={DoubleSide} toneMapped={false} />
    </mesh>
  )
}

// The rubbered-in line: on a real circuit the cars' tyres darken a wide band
// of asphalt along the racing line, heaviest where they brake and turn. Always
// drawn (it is part of the track, not a driving aid).
export function RubberLine({ profile }: { profile: TrackProfile }) {
  const geometry = useMemo(() => {
    const { points, phase } = computeRacingLine(profile)
    return softStrip(points as Pt[], 2.6, RUBBER_Y, (i) => [0.02, 0.02, 0.025, phase[i] === 'brake' ? 0.34 : 0.22])
  }, [profile])
  useEffect(() => () => geometry.dispose(), [geometry])
  return (
    <mesh geometry={geometry} receiveShadow>
      <meshBasicMaterial vertexColors transparent depthWrite={false} side={DoubleSide} />
    </mesh>
  )
}
