import { useMemo } from 'react'
import type { TrackProfile } from '../types/schemas'
import './Minimap.css'

interface MinimapProps {
  profile: TrackProfile
  car: { x: number; y: number } | null
  nextHazardLabel?: string | null
}

const SIZE = 200
const PAD = 12

export function Minimap({ profile, car, nextHazardLabel }: MinimapProps) {
  const { path, project } = useMemo(() => {
    const xs = profile.centerline.map((p) => p[0])
    const ys = profile.centerline.map((p) => p[1])
    const minX = Math.min(...xs)
    const minY = Math.min(...ys)
    const span = Math.max(Math.max(...xs) - minX, Math.max(...ys) - minY) || 1
    const k = (SIZE - 2 * PAD) / span
    const offX = (SIZE - (Math.max(...xs) - minX) * k) / 2
    const offY = (SIZE - (Math.max(...ys) - minY) * k) / 2
    const project = (x: number, y: number): [number, number] => [offX + (x - minX) * k, offY + (y - minY) * k]
    const path = profile.centerline
      .filter((_, i) => i % 3 === 0)
      .map(([x, y], i) => `${i ? 'L' : 'M'}${project(x, y).map((v) => v.toFixed(1)).join(',')}`)
      .join(' ')
    return { path: `${path} Z`, project }
  }, [profile])

  const [sx, sy] = project(...profile.start_finish)
  const carXY = car ? project(car.x, car.y) : null

  return (
    <div className="minimap">
      <svg viewBox={`0 0 ${SIZE} ${SIZE}`} role="img" aria-label={`${profile.name} map with car position`}>
        <path d={path} className="minimap__track-outer" />
        <path d={path} className="minimap__track" />
        {profile.sectors.map((s) => {
          const [x, y] = project(...s.start_position)
          return <circle key={s.index} cx={x} cy={y} r={2.5} className="minimap__sector" />
        })}
        <rect x={sx - 3} y={sy - 3} width={6} height={6} className="minimap__start" />
        {carXY && <circle cx={carXY[0]} cy={carXY[1]} r={5.5} className="minimap__car" />}
      </svg>
      <div className="minimap__caption">
        <strong>{profile.name}</strong>
        <span>{(profile.total_length / 1000).toFixed(3)} km{nextHazardLabel ? ` · next: ${nextHazardLabel}` : ''}</span>
      </div>
    </div>
  )
}
