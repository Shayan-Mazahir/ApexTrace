import type { LogEntry } from '../stream/useSessionStream'
import './EventLog.css'

function describe(e: LogEntry): { kind: string; text: string; tone: string } {
  if (e.type === 'fault_event') {
    const layer = `${e.target} layer`
    if (e.event === 'fault_activated') return { kind: 'FAULT STARTED', text: `${e.fault_id} (${layer}) at ${e.distance.toFixed(0)} m into the lap`, tone: 'danger' }
    if (e.event === 'fault_deactivated') return { kind: 'fault ended', text: `${e.fault_id} (${layer}) at ${e.distance.toFixed(0)} m`, tone: 'neutral' }
    return { kind: 'fault cancelled', text: `${e.fault_id} removed by the engineer`, tone: 'neutral' }
  }
  if (e.type === 'warning_event') {
    const who = e.source === 'local' ? "the car's own fallback" : 'the remote warning service'
    const age = e.data_age_ms !== null ? ` (its data is ${e.data_age_ms.toFixed(0)} ms old)` : ''
    if (e.active) return { kind: 'BRAKE WARNING', text: `driver told to brake for ${e.hazard_zone} by ${who}${age}`, tone: 'warn' }
    if (e.state === 'stale' || e.state === 'no_data') return { kind: 'DATA STALE', text: `${who} has no fresh data, so the driver sees a stale warning${age}`, tone: 'warn' }
    return { kind: 'warning cleared', text: `nothing to brake for right now${age}`, tone: 'neutral' }
  }
  return { kind: e.event.replace(/_/g, ' '), text: `${e.location ?? ''} at ${e.t.toFixed(1)} s`, tone: 'danger' }
}

export function EventLog({ entries }: { entries: LogEntry[] }) {
  if (entries.length === 0) return <p className="event-log__empty">No events yet. Faults starting or ending and warnings sent to the driver will appear here, newest first.</p>
  return (
    <ol className="event-log" aria-live="polite">
      {[...entries].reverse().slice(0, 40).map((e, i) => {
        const d = describe(e)
        const t = 't' in e ? e.t : (e as { displayed_t: number }).displayed_t
        return (
          <li key={i} className={`event-log__row event-log__row--${d.tone}`}>
            <span className="event-log__t">{typeof t === 'number' ? t.toFixed(1) : ''}s</span>
            <span className="event-log__kind">{d.kind}</span>
            <span>{d.text}</span>
          </li>
        )
      })}
    </ol>
  )
}
