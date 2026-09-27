import { useGLTF } from '@react-three/drei'
import { useFrame } from '@react-three/fiber'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Box3, Group, Material, Mesh, MeshStandardMaterial, Object3D, Vector3 } from 'three'

// Detailed car model (public/models/car.glb, optimised from the model dropped in
// public/). Wheels, brake discs and the steering wheel are found by material
// name and re-pivoted at load time so they spin and steer like the primitive car.
export const CAR_MODEL_URL = '/models/car.glb'
const WHEEL_MATERIAL = /tire|tyre|wheel_hub|disc/i
const STEERING_MATERIAL = /rtt_sw|sw_plastic|gp21_lcd/i
const WHEEL_RADIUS = 0.36

interface Rig {
  root: Group
  wheels: { pivot: Group; spin: Group; front: boolean }[]
  steeringWheel: Group | null
  noseSign: number
}

function meshesOf(o: Object3D, test: RegExp): Mesh[] {
  const out: Mesh[] = []
  o.traverse((c) => {
    const m = c as Mesh
    if (!m.isMesh) return
    const mats = (Array.isArray(m.material) ? m.material : [m.material]) as Material[]
    if (mats.some((x) => test.test(x.name))) out.push(m)
  })
  return out
}

// Re-parent meshes under a new group whose origin is `center`, keeping their world pose.
function pivotAt(parent: Object3D, meshes: Mesh[], center: Vector3): Group {
  const g = new Group()
  g.position.copy(center)
  parent.add(g)
  g.updateMatrixWorld(true)
  for (const m of meshes) g.attach(m)
  return g
}

function buildRig(source: Object3D, ghost: boolean): Rig {
  const model = source.clone(true)
  model.updateMatrixWorld(true)
  // centre the car on the origin, wheels on the ground
  const box = new Box3().setFromObject(model)
  const c = box.getCenter(new Vector3())
  model.position.sub(new Vector3(c.x, box.min.y, c.z))
  const inner = new Group()
  inner.add(model)
  inner.updateMatrixWorld(true)

  // which end is the nose? the rear wing stands much taller than the front wing
  const b2 = new Box3().setFromObject(inner)
  const endHeight = (sign: number) => {
    let h = 0
    inner.traverse((o) => {
      const m = o as Mesh
      if (!m.isMesh) return
      const bb = new Box3().setFromObject(m)
      const zc = (bb.min.z + bb.max.z) / 2
      if (sign * zc > (b2.max.z - b2.min.z) * 0.3) h = Math.max(h, bb.max.y)
    })
    return h
  }
  const noseSign = endHeight(1) < endHeight(-1) ? 1 : -1

  // wheels: cluster wheel meshes into 4 corners, pivot each at its axle centre
  const wheelMeshes = meshesOf(inner, WHEEL_MATERIAL)
  const corners = new Map<string, Mesh[]>()
  for (const m of wheelMeshes) {
    const bb = new Box3().setFromObject(m)
    const cc = bb.getCenter(new Vector3())
    const key = `${cc.x > 0 ? 'L' : 'R'}${cc.z * noseSign > 0 ? 'F' : 'B'}`
    corners.set(key, [...(corners.get(key) ?? []), m])
  }
  const wheels: Rig['wheels'] = []
  for (const [key, ms] of corners) {
    const bb = new Box3()
    for (const m of ms) bb.expandByObject(m)
    const center = bb.getCenter(new Vector3())
    const pivot = pivotAt(inner, [], center) // steering (yaw) pivot
    const spin = pivotAt(pivot, ms, new Vector3()) // spin pivot, same centre
    wheels.push({ pivot, spin, front: key.endsWith('F') })
  }

  const sw = meshesOf(inner, STEERING_MATERIAL)
  let steeringWheel: Group | null = null
  if (sw.length) {
    const bb = new Box3()
    for (const m of sw) bb.expandByObject(m)
    steeringWheel = pivotAt(inner, sw, bb.getCenter(new Vector3()))
  }

  if (ghost) {
    const grey = new MeshStandardMaterial({ color: '#9aa3ad', roughness: 0.5, metalness: 0.3, transparent: true, opacity: 0.75 })
    inner.traverse((o) => {
      const m = o as Mesh
      if (m.isMesh) m.material = grey
    })
  }

  // model forward (nose) -> scene +x
  const root = new Group()
  inner.rotation.y = noseSign > 0 ? Math.PI / 2 : -Math.PI / 2
  root.add(inner)
  return { root, wheels, steeringWheel, noseSign }
}

// Is the optional model present? (A dev server answers a missing file with
// index.html, so check the content type, not just the status.)
let available: Promise<boolean> | null = null
export function carModelAvailable(): Promise<boolean> {
  available ??= fetch(CAR_MODEL_URL, { method: 'HEAD' })
    .then((r) => r.ok && !(r.headers.get('content-type') ?? '').includes('text/html'))
    .catch(() => false)
  return available
}

export function useCarModelAvailable(): boolean {
  const [ok, setOk] = useState(false)
  useEffect(() => {
    let live = true
    void carModelAvailable().then((v) => live && setOk(v))
    return () => {
      live = false
    }
  }, [])
  return ok
}

export function CarModel({ speed, steering, ghost = false }: {
  speed?: React.MutableRefObject<number>
  steering?: React.MutableRefObject<number>
  ghost?: boolean
}) {
  const gltf = useGLTF(CAR_MODEL_URL)
  const rig = useMemo(() => buildRig(gltf.scene, ghost), [gltf.scene, ghost])
  const spin = useRef(0)
  const steer = useRef(0)
  useFrame((_, dt) => {
    const d = Math.min(dt, 0.1)
    spin.current += ((speed?.current ?? 0) * d) / WHEEL_RADIUS
    steer.current += ((steering?.current ?? 0) - steer.current) * Math.min(1, d * 10)
    for (const w of rig.wheels) {
      w.spin.rotation.x = spin.current * rig.noseSign // roll forward toward the nose
      if (w.front) w.pivot.rotation.y = -steer.current * 0.35
    }
    // about the car's forward axis: steering right turns the rim clockwise as the driver sees it
    if (rig.steeringWheel) rig.steeringWheel.rotation.z = steer.current * 2.4 * rig.noseSign
  })
  return <primitive object={rig.root} />
}

