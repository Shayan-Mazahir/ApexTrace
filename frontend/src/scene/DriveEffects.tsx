import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState, type MutableRefObject } from 'react'
import {
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  DoubleSide,
  DynamicDrawUsage,
  Matrix4,
  PlaneGeometry,
  Quaternion,
  RepeatWrapping,
  ShaderMaterial,
  SRGBColorSpace,
  Vector3,
  type InstancedMesh,
  type Mesh,
  type MeshBasicMaterial,
  type PerspectiveCamera,
} from 'three'
import type { HapticSignal } from '../haptics/signal'
import type { HazardZone, TrackProfile } from '../types/schemas'

// What you feel, drawn: sparks, tyre smoke, dust, skid marks, camera shake,
// and the BRAKE zone painted on the track. All driven by the same haptic
// signal as the wheel's servos and the gamepad's motors. Everything here uses
// fixed pools written in place each frame, so it costs next to nothing on an
// integrated GPU: no allocation, no React re-render.

export interface EffectPose {
  x: number
  y: number
  heading: number
  speed: number
}
type PoseRef = MutableRefObject<EffectPose>
type SignalRef = MutableRefObject<HapticSignal>

const TAU = Math.PI * 2
const rand = Math.random

// car-local (x forward, z sideways) -> world XZ
function toWorld(p: EffectPose, lx: number, lz: number): [number, number] {
  const c = Math.cos(p.heading)
  const s = Math.sin(p.heading)
  return [p.x + lx * c - lz * s, p.y + lx * s + lz * c]
}

// Contact patches (F1Car: axles at +1.72 / -1.68 m, tyre centres ~0.8 m out).
const FRONT_WHEELS: [number, number][] = [[1.72, 0.81], [1.72, -0.81]]
const REAR_WHEELS: [number, number][] = [[-1.68, 0.76], [-1.68, -0.76]]

// ---------------------------------------------------------------- camera shake

// Applied by the camera rig right after it places the camera (so it never
// accumulates): kerb stripes drum at their own rate, run-off shakes, a
// barrier hit jolts and dies away, and very high speed adds a faint buzz.
export function applyCameraShake(cam: PerspectiveCamera, s: HapticSignal, t: number, cockpit: boolean) {
  const k = cockpit ? 1 : 1.8 // the chase cam is further away: needs more to read
  const r = s.rumble
  let lift = 0
  let side = 0
  let roll = 0
  if (r.effect === 'kerb') {
    lift += Math.sin(t * TAU * r.rateHz) * 0.014 * r.strength * k
    roll += Math.sin(t * TAU * r.rateHz * 0.5 + 1.3) * 0.006 * r.strength
  } else if (r.effect === 'rough') {
    // sum of unrelated sines: irregular, but smooth frame to frame
    const n = Math.sin(t * 37.1) * 0.6 + Math.sin(t * 23.3 + 2) * 0.4 + Math.sin(t * 61.7 + 4) * 0.25
    lift += n * 0.02 * r.strength * k
    roll += Math.sin(t * 17.9) * 0.008 * r.strength
  } else if (r.effect === 'slip') {
    lift += Math.sin(t * TAU * 22) * 0.003 * r.strength * k
  }
  if (s.speed > 70) lift += Math.sin(t * TAU * 27) * 0.0016 * Math.min(1, (s.speed - 70) / 20) * k
  const since = (performance.now() - s.impactAt) / 1000
  if (since >= 0 && since < 0.7) {
    const e = s.impactStrength * (1 - since / 0.7) ** 2
    side += (rand() - 0.5) * 0.3 * e * k
    lift += (rand() - 0.5) * 0.24 * e * k
    roll += (rand() - 0.5) * 0.07 * e
  }
  // cockpit: the head leans into the corner a touch, like a driver's under load
  if (cockpit) roll += Math.max(-4, Math.min(4, s.gLat)) * 0.006
  cam.position.y += lift
  if (side) cam.translateX(side)
  if (roll) cam.rotateZ(roll)
}

// ---------------------------------------------------------------- sparks

const SPARKS = 480

let glowTexture: CanvasTexture | null = null
// A soft white dot, for the glowing head of each spark.
function glow(): CanvasTexture {
  if (glowTexture) return glowTexture
  const c = document.createElement('canvas')
  c.width = c.height = 64
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.25, 'rgba(255,255,255,0.55)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, 64, 64)
  glowTexture = new CanvasTexture(c)
  return glowTexture
}

// Titanium skid-block sparks: streaks thrown out behind the car when the floor
// scrapes a kerb, bottoms out over bumps at top speed, or the nose dives under
// heavy braking, and a burst off the front when it hits a barrier. Drawn as
// additive lines brighter than white (the bloom pass makes them glow) with a
// soft dot on each head, so they still glow in Performance mode, which has no bloom.
function Sparks({ pose, signal }: { pose: PoseRef; signal: SignalRef }) {
  const sim = useMemo(
    () => ({
      p: new Float32Array(SPARKS * 3),
      v: new Float32Array(SPARKS * 3),
      life: new Float32Array(SPARKS),
      max: new Float32Array(SPARKS).fill(1),
      next: 0,
      carry: 0,
      alive: 0,
      lastImpact: Number.NEGATIVE_INFINITY,
    }),
    [],
  )
  const { geometry, heads } = useMemo(() => {
    const make = (count: number) => {
      const g = new BufferGeometry()
      for (const name of ['position', 'color']) {
        const a = new BufferAttribute(new Float32Array(count * 3), 3)
        a.setUsage(DynamicDrawUsage)
        g.setAttribute(name, a)
      }
      return g
    }
    return { geometry: make(SPARKS * 2), heads: make(SPARKS) }
  }, [])
  useEffect(
    () => () => {
      geometry.dispose()
      heads.dispose()
    },
    [geometry, heads],
  )

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const car = pose.current
    const s = signal.current
    const hx = Math.cos(car.heading)
    const hz = Math.sin(car.heading)
    const t = state.clock.elapsedTime
    const spawn = (x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number) => {
      const i = sim.next
      sim.next = (i + 1) % SPARKS
      sim.p.set([x, y, z], i * 3)
      sim.v.set([vx, vy, vz], i * 3)
      sim.life[i] = sim.max[i] = life
    }

    let rate = 0 // sparks per second
    if (s.surface === 'kerb' && s.speed > 30) rate += 240 * s.rumble.strength
    if (s.speed > 72 && Math.sin(t * 1.9) + Math.sin(t * 3.7 + 1) > 1.1) rate += 170
    if (s.gLong < -2.5 && s.speed > 55) rate += 90
    sim.carry += rate * dt
    while (sim.carry >= 1) {
      sim.carry -= 1
      const [x, z] = toWorld(car, -1.4 + rand() * 1.9, (rand() - 0.5) * 0.6)
      const k = 0.25 + rand() * 0.4 // scraped off the floor: they lose speed and stream out behind
      spawn(x, 0.05, z, hx * car.speed * k + (rand() - 0.5) * 4, 0.6 + rand() * 2.6, hz * car.speed * k + (rand() - 0.5) * 4, 0.22 + rand() * 0.35)
    }
    if (s.impactAt !== sim.lastImpact) {
      sim.lastImpact = s.impactAt
      if (performance.now() - s.impactAt < 250) {
        for (let n = Math.round(200 * s.impactStrength); n > 0; n--) {
          const [x, z] = toWorld(car, 2.4, (rand() - 0.5) * 1.8)
          const a = rand() * TAU
          const sp = 3 + rand() * 13
          spawn(x, 0.3, z, Math.cos(a) * sp + hx * car.speed * 0.3, 1 + rand() * 6, Math.sin(a) * sp + hz * car.speed * 0.3, 0.35 + rand() * 0.55)
        }
      }
    }

    if (sim.alive === 0 && sim.carry === 0 && rate === 0 && sim.life.every((l) => l <= 0)) return
    const pos = geometry.attributes.position.array as Float32Array
    const col = geometry.attributes.color.array as Float32Array
    const headPos = heads.attributes.position.array as Float32Array
    const headCol = heads.attributes.color.array as Float32Array
    const cvx = hx * car.speed
    const cvz = hz * car.speed
    let alive = 0
    for (let i = 0; i < SPARKS; i++) {
      const o = i * 6
      if (sim.life[i] <= 0) {
        col.fill(0, o, o + 6) // additive: black is invisible
        headCol.fill(0, i * 3, i * 3 + 3)
        continue
      }
      alive++
      sim.life[i] -= dt
      const j = i * 3
      const v = sim.v
      const p = sim.p
      v[j + 1] -= 9.8 * dt
      p[j] += v[j] * dt
      p[j + 1] += v[j + 1] * dt
      p[j + 2] += v[j + 2] * dt
      if (p[j + 1] < 0.03) {
        p[j + 1] = 0.03
        v[j + 1] = -v[j + 1] * 0.35
        v[j] *= 0.7
        v[j + 2] *= 0.7
      }
      // the streak follows the spark's motion as the (moving) camera sees it
      const tail = 0.03
      pos[o] = p[j]
      pos[o + 1] = p[j + 1]
      pos[o + 2] = p[j + 2]
      pos[o + 3] = p[j] - (v[j] - cvx) * tail
      pos[o + 4] = p[j + 1] - v[j + 1] * tail
      pos[o + 5] = p[j + 2] - (v[j + 2] - cvz) * tail
      const f = Math.max(0, sim.life[i] / sim.max[i])
      col[o] = 3.2 * f
      col[o + 1] = 2.3 * f * f
      col[o + 2] = 1.1 * f * f * f
      col[o + 3] = 1.4 * f
      col[o + 4] = 0.35 * f
      col[o + 5] = 0.05 * f
      headPos[j] = p[j]
      headPos[j + 1] = p[j + 1]
      headPos[j + 2] = p[j + 2]
      headCol[j] = 1.0 * f
      headCol[j + 1] = 0.62 * f * f
      headCol[j + 2] = 0.22 * f * f * f
    }
    sim.alive = alive
    for (const g of [geometry, heads]) {
      g.attributes.position.needsUpdate = true
      g.attributes.color.needsUpdate = true
    }
  })

  return (
    <>
      <lineSegments geometry={geometry} frustumCulled={false}>
        <lineBasicMaterial vertexColors blending={AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
      </lineSegments>
      <points geometry={heads} frustumCulled={false}>
        <pointsMaterial map={glow()} size={0.32} sizeAttenuation vertexColors blending={AdditiveBlending} transparent depthWrite={false} toneMapped={false} />
      </points>
    </>
  )
}

// ---------------------------------------------------------------- smoke and dust

const PUFFS = 200
const SMOKE_RGB: [number, number, number] = [0.86, 0.86, 0.88]
const DUST_RGB: [number, number, number] = [0.64, 0.56, 0.42]

const puffVertex = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  attribute vec3 aColor;
  uniform float uScale;
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
    vAlpha = aAlpha;
    vColor = aColor;
  }
`
const puffFragment = /* glsl */ `
  varying float vAlpha;
  varying vec3 vColor;
  void main() {
    float r = length(gl_PointCoord - 0.5) * 2.0;
    if (r > 1.0) discard;
    gl_FragColor = vec4(vColor, vAlpha * smoothstep(1.0, 0.15, r));
  }
`

// Soft round billboards that grow and fade: white tyre smoke from locked
// fronts or spinning rears, brown dust thrown up off the track.
function Puffs({ pose, signal }: { pose: PoseRef; signal: SignalRef }) {
  const sim = useMemo(
    () => ({
      v: new Float32Array(PUFFS * 3),
      age: new Float32Array(PUFFS).fill(1),
      life: new Float32Array(PUFFS).fill(1),
      grow: new Float32Array(PUFFS),
      next: 0,
      carry: 0,
      alive: 0,
    }),
    [],
  )
  const { geometry, material } = useMemo(() => {
    const g = new BufferGeometry()
    const attr = (name: string, size: number) => {
      const a = new BufferAttribute(new Float32Array(PUFFS * size), size)
      a.setUsage(DynamicDrawUsage)
      g.setAttribute(name, a)
    }
    attr('position', 3)
    attr('aSize', 1)
    attr('aAlpha', 1)
    attr('aColor', 3)
    const m = new ShaderMaterial({
      uniforms: { uScale: { value: 500 } },
      vertexShader: puffVertex,
      fragmentShader: puffFragment,
      transparent: true,
      depthWrite: false,
    })
    return { geometry: g, material: m }
  }, [])
  useEffect(
    () => () => {
      geometry.dispose()
      material.dispose()
    },
    [geometry, material],
  )

  useFrame((state, rawDt) => {
    const dt = Math.min(rawDt, 0.05)
    const cam = state.camera as PerspectiveCamera
    material.uniforms.uScale.value = state.gl.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360))
    const car = pose.current
    const s = signal.current
    const pos = geometry.attributes.position.array as Float32Array
    const size = geometry.attributes.aSize.array as Float32Array
    const alpha = geometry.attributes.aAlpha.array as Float32Array
    const color = geometry.attributes.aColor.array as Float32Array
    const hx = Math.cos(car.heading)
    const hz = Math.sin(car.heading)

    const emitters: { wheels: [number, number][]; rate: number; rgb: [number, number, number]; grow: number }[] = []
    if (s.lockup && s.speed > 3) emitters.push({ wheels: FRONT_WHEELS, rate: 55, rgb: SMOKE_RGB, grow: 3.2 })
    if (s.wheelspin && s.speed > 0.5) emitters.push({ wheels: REAR_WHEELS, rate: 60, rgb: SMOKE_RGB, grow: 3.6 })
    if (s.surface === 'rough' && s.speed > 8) emitters.push({ wheels: REAR_WHEELS, rate: 45 * s.rumble.strength, rgb: DUST_RGB, grow: 5 })
    for (const e of emitters) {
      sim.carry += e.rate * e.wheels.length * dt
      while (sim.carry >= 1) {
        sim.carry -= 1
        const [lx, lz] = e.wheels[Math.floor(rand() * e.wheels.length)]
        const [x, z] = toWorld(car, lx, lz)
        const i = sim.next
        sim.next = (i + 1) % PUFFS
        pos.set([x, 0.35, z], i * 3)
        sim.v.set([hx * car.speed * 0.12 + (rand() - 0.5) * 1.2, 0.4 + rand() * 0.7, hz * car.speed * 0.12 + (rand() - 0.5) * 1.2], i * 3)
        sim.age[i] = 0
        sim.life[i] = 1.1 + rand() * 0.8
        sim.grow[i] = e.grow * (0.8 + rand() * 0.4)
        color.set(e.rgb, i * 3)
      }
    }
    if (emitters.length === 0) sim.carry = 0
    if (sim.alive === 0 && emitters.length === 0) return

    let alive = 0
    const drag = Math.max(0, 1 - 1.6 * dt)
    for (let i = 0; i < PUFFS; i++) {
      if (sim.age[i] >= sim.life[i]) {
        alpha[i] = 0
        continue
      }
      alive++
      sim.age[i] += dt
      const j = i * 3
      for (let a = 0; a < 3; a++) {
        sim.v[j + a] *= drag
        pos[j + a] += sim.v[j + a] * dt
      }
      const f = Math.min(1, sim.age[i] / sim.life[i])
      size[i] = 0.5 + sim.grow[i] * Math.sqrt(f)
      alpha[i] = 0.42 * Math.min(1, f * 8) * (1 - f) ** 1.6
    }
    sim.alive = alive
    for (const name of ['position', 'aSize', 'aAlpha', 'aColor']) geometry.attributes[name].needsUpdate = true
  })

  return <points geometry={geometry} material={material} frustumCulled={false} />
}

// ---------------------------------------------------------------- skid marks

const SKID_SEGMENTS = 1400
const SKID_MIN_STEP = 0.4 // metres between segments
const SKID_MAX_STEP = 6 // longer than this is a reset/teleport, not a slide
const SKID_Y = 0.03 // above the asphalt (0.02), under the racing line (0.035)

// Rubber laid down by locked fronts or spinning rears. A ring buffer of flat
// quads, oldest overwritten first, so a long session never grows the scene.
function SkidMarks({ pose, signal }: { pose: PoseRef; signal: SignalRef }) {
  const mesh = useRef<InstancedMesh>(null)
  const geometry = useMemo(() => new PlaneGeometry(1, 1).rotateX(-Math.PI / 2), [])
  useEffect(() => () => geometry.dispose(), [geometry])
  const state = useMemo(
    () => ({
      last: new Map<string, [number, number] | null>(),
      next: 0,
      count: 0,
      m: new Matrix4(),
      q: new Quaternion(),
      up: new Vector3(0, 1, 0),
      at: new Vector3(),
      scale: new Vector3(),
    }),
    [],
  )

  useFrame(() => {
    const im = mesh.current
    if (!im) return
    const car = pose.current
    const s = signal.current
    const marking = [
      ...FRONT_WHEELS.map((w) => [w, s.lockup && s.speed > 3] as const),
      ...REAR_WHEELS.map((w) => [w, s.wheelspin && s.speed > 0.5] as const),
    ]
    let dirty = false
    for (const [[lx, lz], on] of marking) {
      const key = `${lx},${lz}`
      if (!on) {
        state.last.set(key, null)
        continue
      }
      const [x, z] = toWorld(car, lx, lz)
      const prev = state.last.get(key)
      if (!prev) {
        state.last.set(key, [x, z])
        continue
      }
      const dx = x - prev[0]
      const dz = z - prev[1]
      const len = Math.hypot(dx, dz)
      if (len < SKID_MIN_STEP) continue
      state.last.set(key, [x, z])
      if (len > SKID_MAX_STEP) continue
      state.at.set((x + prev[0]) / 2, SKID_Y, (z + prev[1]) / 2)
      state.q.setFromAxisAngle(state.up, Math.atan2(-dz, dx))
      state.scale.set(len + 0.06, 1, lx > 0 ? 0.26 : 0.34) // rears are wider
      state.m.compose(state.at, state.q, state.scale)
      im.setMatrixAt(state.next, state.m)
      state.next = (state.next + 1) % SKID_SEGMENTS
      state.count = Math.min(SKID_SEGMENTS, state.count + 1)
      dirty = true
    }
    if (dirty) {
      im.count = state.count
      im.instanceMatrix.needsUpdate = true
    }
  })

  return (
    <instancedMesh ref={mesh} args={[geometry, undefined, SKID_SEGMENTS]} count={0} frustumCulled={false}>
      <meshBasicMaterial color="#0a0a0b" transparent opacity={0.5} depthWrite={false} />
    </instancedMesh>
  )
}

// ---------------------------------------------------------------- BRAKE zone

const ZONE_LENGTH_M = 150 // painted before the corner's braking point
const CHEVRON_EVERY_M = 7
const ZONE_Y = 0.041 // over the racing line (0.035), under the edge lines (0.045)
const ZONE_INSET_M = 0.8 // stays clear of the white edge lines

let chevronTexture: CanvasTexture | null = null
function chevrons(): CanvasTexture {
  if (chevronTexture) return chevronTexture
  const c = document.createElement('canvas')
  c.width = 128
  c.height = 128
  const g = c.getContext('2d')!
  g.strokeStyle = '#fff'
  g.lineWidth = 20
  g.lineJoin = 'miter'
  g.beginPath() // one chevron pointing along +u, i.e. toward the corner
  g.moveTo(22, 10)
  g.lineTo(84, 64)
  g.lineTo(22, 118)
  g.stroke()
  chevronTexture = new CanvasTexture(c)
  chevronTexture.wrapS = RepeatWrapping
  chevronTexture.colorSpace = SRGBColorSpace
  chevronTexture.anisotropy = 4
  return chevronTexture
}

// The road surface for [from, to] metres along the lap (wrapping past the
// line), inset from the edges, with u in metres/CHEVRON_EVERY_M along it and
// a vertex fade in over the first 40 m.
function zoneGeometry(profile: TrackProfile, from: number, to: number): BufferGeometry {
  const line = profile.centerline
  const [fx, fy] = line[0]
  const [lx, ly] = line[line.length - 1]
  const closed = Math.hypot(fx - lx, fy - ly) < 1e-6
  const n = closed ? line.length - 1 : line.length
  const step = profile.total_length / Math.max(line.length - 1, 1)
  const positions: number[] = []
  const uvs: number[] = []
  const colors: number[] = []
  const indices: number[] = []
  for (let k = Math.ceil(from / step); k * step <= to; k++) {
    const i = ((k % n) + n) % n
    const [ax, ay] = profile.left_edge[i]
    const [bx, by] = profile.right_edge[i]
    const w = Math.hypot(bx - ax, by - ay) || 1
    const f = Math.min(ZONE_INSET_M / w, 0.3)
    const d = k * step - from
    const fade = Math.min(1, d / 40)
    positions.push(ax + (bx - ax) * f, ZONE_Y, ay + (by - ay) * f, bx + (ax - bx) * f, ZONE_Y, by + (ay - by) * f)
    uvs.push(d / CHEVRON_EVERY_M, 0, d / CHEVRON_EVERY_M, 1)
    colors.push(fade, fade, fade, fade, fade, fade)
    const v = positions.length / 3 - 2
    if (v > 0) indices.push(v - 2, v - 1, v, v - 1, v + 1, v)
  }
  const g = new BufferGeometry()
  g.setAttribute('position', new BufferAttribute(new Float32Array(positions), 3))
  g.setAttribute('uv', new BufferAttribute(new Float32Array(uvs), 2))
  g.setAttribute('color', new BufferAttribute(new Float32Array(colors), 3))
  g.setIndex(indices)
  return g
}

// While BRAKE is shown: glowing red chevrons flowing down the road into the
// corner, ending in a solid bar at the braking point. Fades in and out rather
// than popping, and stays on the last hazard while it fades.
function BrakeZone({ profile, hazard }: { profile: TrackProfile; hazard: HazardZone | null }) {
  // the last hazard warned about: kept after the warning clears, so it can fade
  const [target, setTarget] = useState<HazardZone | null>(hazard)
  if (hazard && hazard.id !== target?.id) setTarget(hazard)
  const zone = useMemo(() => {
    if (!target) return null
    const end = target.start_distance
    const map = chevrons().clone()
    map.needsUpdate = true
    return { road: zoneGeometry(profile, end - ZONE_LENGTH_M, end), bar: zoneGeometry(profile, end - 2.5, end + 0.01), map }
  }, [profile, target])
  useEffect(
    () => () => {
      zone?.road.dispose()
      zone?.bar.dispose()
      zone?.map.dispose()
    },
    [zone],
  )
  const road = useRef<Mesh>(null)
  const bar = useRef<Mesh>(null)
  const level = useRef(0)

  useFrame((state, dt) => {
    if (!zone) return
    const goal = hazard ? 1 : 0
    level.current += (goal - level.current) * Math.min(1, dt * (hazard ? 10 : 4))
    const t = state.clock.elapsedTime
    const pulse = 0.72 + 0.28 * Math.sin(t * TAU * 2.2)
    zone.map.offset.x = -t * 1.6 // chevrons stream toward the corner
    const on = level.current > 0.01
    for (const [ref, gain] of [[road, 0.85], [bar, 1]] as const) {
      if (!ref.current) continue
      ref.current.visible = on
      ;(ref.current.material as MeshBasicMaterial).opacity = level.current * pulse * gain
    }
  })

  if (!zone) return null
  return (
    <group>
      <mesh ref={road} geometry={zone.road} visible={false}>
        {/* >1 colour: brighter than the tone-mapped scene, so the bloom picks it up.
            DoubleSide like the track strips: the sim's (x, y) -> three's (x, z) mirrors the winding */}
        <meshBasicMaterial map={zone.map} color={[2.4, 0.18, 0.12]} vertexColors transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
      </mesh>
      <mesh ref={bar} geometry={zone.bar} visible={false}>
        <meshBasicMaterial color={[2.8, 0.2, 0.14]} transparent depthWrite={false} blending={AdditiveBlending} toneMapped={false} side={DoubleSide} />
      </mesh>
    </group>
  )
}

// ---------------------------------------------------------------- all together

export function DriveEffects({ pose, signal, profile, brakeHazard }: { pose: PoseRef; signal: SignalRef; profile: TrackProfile | null; brakeHazard: HazardZone | null }) {
  return (
    <>
      <SkidMarks pose={pose} signal={signal} />
      <Puffs pose={pose} signal={signal} />
      <Sparks pose={pose} signal={signal} />
      {profile && <BrakeZone profile={profile} hazard={brakeHazard} />}
    </>
  )
}
