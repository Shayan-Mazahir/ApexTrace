import { describeFaults, type FaultEvent } from '../stream/faultTimeline'
import type { ScenarioConfig, TrackProfile } from '../types/schemas'
import './FaultTimeline.css'

interface FaultTimelineProps {
  profile: TrackProfile | null
  scenario: ScenarioConfig | null
  events: FaultEvent[]
  carDistance: number
}

const pct = (distance: number, total: number) => `${Math.min(100, Math.max(0, (distance / total) * 100))}%`

// Lap distance laid out left to right: hazard zones, the scenario's active
// window, every change in effective faults, and the car's live position.
export function FaultTimeline({ profile, scenario, events, carDistance }: FaultTimelineProps) {
  if (!profile) return <div className="fault-timeline__empty">Join a session to see the timeline.</div>
  const total = profile.total_length
  const lapDistance = carDistance % total
  const recent = events.slice(-4).reverse()

  return (
    <div className="fault-timeline">
      <div className="fault-timeline__bar" role="img" aria-label="Fault timeline over one lap">
        {profile.hazard_zones.map((hz) => (
          <div
            key={hz.id}
            className="fault-timeline__hazard"
            style={{ left: pct(hz.start_distance, total) }}
            title={hz.label}
          />
        ))}
        {scenario && (
          <div
            className="fault-timeline__window"
            style={{
              left: pct(scenario.onset_distance, total),
              width: pct(scenario.end_distance - scenario.onset_distance, total),
            }}
            title={`${scenario.name}: ${describeFaults(scenario.faults)}`}
          >
            <span>scenario window</span>
          </div>
        )}
        {events.map((event, i) => (
          <div
            key={i}
            className="fault-timeline__event"
            style={{ left: pct(event.distance, total) }}
            title={`${event.distance.toFixed(0)} m: ${describeFaults(event.effective)}`}
          />
        ))}
        <div className="fault-timeline__car" style={{ left: pct(lapDistance, total) }} />
      </div>
      <div className="fault-timeline__legend">
        <span>┃ car</span>
        <span>▮ scenario window</span>
        <span>● fault change</span>
        <span>▲ hazard zone</span>
      </div>
      <ol className="fault-timeline__log">
        {recent.length === 0 && <li>No fault changes yet.</li>}
        {recent.map((event, i) => (
          <li key={i}>
            @ {event.distance.toFixed(0)} m — {describeFaults(event.effective)}
            {event.scenarioActive ? ' (scenario active)' : ''}
          </li>
        ))}
      </ol>
    </div>
  )
}
