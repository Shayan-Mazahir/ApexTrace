import { faultWindows } from '../stream/faultTimeline'
import type { FaultEventMessage, TrackProfile } from '../types/schemas'
import './FaultTimeline.css'

const TARGET_COLOR: Record<string, string> = {
  world: '#2dd4bf',
  vehicle: '#60a5fa',
  sensor: '#c084fc',
  uplink: '#f59e0b',
  downlink: '#fb923c',
  warning_service: '#f472b6',
  driver: '#a3a3a3',
}

interface FaultTimelineProps {
  profile: TrackProfile | null
  events: FaultEventMessage[]
  carDistance: number
}

const pct = (d: number, total: number) => `${Math.min(100, Math.max(0, (d / total) * 100))}%`

// One lap, left to right: corners, every fault activation window (coloured by
// the layer it hits), and the car.
export function FaultTimeline({ profile, events, carDistance }: FaultTimelineProps) {
  if (!profile) return <div className="fault-timeline__empty">Join a session to see the timeline.</div>
  const total = profile.total_length
  const windows = faultWindows(events, total)
  return (
    <div className="fault-timeline">
      <div className="fault-timeline__bar" role="img" aria-label="Fault activity over one lap">
        {profile.hazard_zones.map((hz) => (
          <div key={hz.id} className="fault-timeline__hazard" style={{ left: pct(hz.start_distance, total) }} title={hz.label} />
        ))}
        {windows.map((w, i) => {
          const end = w.end ?? carDistance % total
          const width = end >= w.start ? end - w.start : total - w.start
          return (
            <div key={i} className="fault-timeline__window" title={`${w.id} [${w.target}]`}
              style={{ left: pct(w.start, total), width: pct(Math.max(width, total * 0.004), total), background: TARGET_COLOR[w.target] }} />
          )
        })}
        <div className="fault-timeline__car" style={{ left: pct(carDistance % total, total) }} />
      </div>
      <div className="fault-timeline__legend">
        {Object.entries(TARGET_COLOR).map(([t, c]) => (
          <span key={t}>
            <i style={{ background: c }} /> {t}
          </span>
        ))}
        <span>▲ corner · ┃ car</span>
      </div>
    </div>
  )
}
